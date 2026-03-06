import { json, loadTokens, saveTokens, zohoAccountsHost, zohoRecruitBase } from "../_lib.js";
import { normalizeAttachmentRecord, selectPrimaryResume } from "./_normalize.js";

export const RECRUIT_MODULES = {
  applications: "Applications",
  candidates: "Candidates",
  jobOpenings: "JobOpenings"
};

const SEARCH_FIELDS = {
  jobTitle: ["Posting_Title", "Potential_Name"]
};

const AUTH_ERROR_CODES = new Set([
  "AUTHENTICATION_FAILURE",
  "INVALID_OAUTHTOKEN",
  "INVALID_TOKEN",
  "INVALID_AUTHORIZATION",
  "UNAUTHORIZED"
]);

const SCOPE_ERROR_CODES = new Set([
  "OAUTH_SCOPE_MISMATCH",
  "NO_PERMISSION",
  "NOT_SUPPORTED"
]);

function parseJson(text) {
  if (!text || !text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 1000) };
  }
}

export function clampPositiveInt(value, fallback, { min = 1, max = 200 } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function escapeRecruitCriteriaValue(value) {
  return String(value).replace(/([(),\\])/g, "\\$1");
}

function buildRecruitError({
  status,
  type,
  message,
  code = null,
  details = null,
  recruitBase = null,
  path = null,
  payload = null
}) {
  const error = new Error(message);
  error.status = status;
  error.type = type;
  error.code = code;
  error.details = details;
  error.recruitBase = recruitBase;
  error.path = path;
  error.payload = payload;
  return error;
}

function unwrapRecruitError(payload) {
  if (!payload) return null;
  if (payload.code || payload.message) return payload;
  if (Array.isArray(payload.data) && payload.data[0]?.code) return payload.data[0];
  if (payload.data?.code) return payload.data;
  return null;
}

function classifyRecruitError(status, payload, recruitBase, path) {
  const unwrapped = unwrapRecruitError(payload);
  const code = unwrapped?.code || null;
  const details = unwrapped?.details || payload?.details || null;
  const message = String(unwrapped?.message || payload?.message || `Recruit API request failed (${status})`);

  if (status === 404 || /record.*not found|no data/i.test(message)) {
    return buildRecruitError({ status: 404, type: "not_found", message, code, details, recruitBase, path, payload });
  }

  if (status === 401 || AUTH_ERROR_CODES.has(code)) {
    return buildRecruitError({ status: 401, type: "auth", message, code, details, recruitBase, path, payload });
  }

  if (status === 403 || SCOPE_ERROR_CODES.has(code) || /scope/i.test(message)) {
    return buildRecruitError({ status: 403, type: "scope", message, code, details, recruitBase, path, payload });
  }

  if (code === "INVALID_MODULE" || /module/i.test(message)) {
    return buildRecruitError({ status: 400, type: "missing_module", message, code, details, recruitBase, path, payload });
  }

  return buildRecruitError({
    status: status >= 400 ? status : 502,
    type: "recruit_api",
    message,
    code,
    details,
    recruitBase,
    path,
    payload
  });
}

async function requestAccessTokenRefresh(stored) {
  if (!stored?.refresh_token) {
    throw buildRecruitError({ status: 401, type: "auth", message: "No refresh token stored" });
  }

  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET) {
    throw buildRecruitError({ status: 500, type: "config", message: "Missing ZOHO_CLIENT_ID/ZOHO_CLIENT_SECRET" });
  }

  const form = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: stored.refresh_token
  });

  const resp = await fetch(`${zohoAccountsHost()}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });

  const text = await resp.text();
  const payload = parseJson(text);
  if (!resp.ok || payload?.error) {
    throw classifyRecruitError(resp.status || 400, payload?.error ? { code: payload.error, message: text } : payload, zohoRecruitBase(), "/oauth/v2/token");
  }

  const now = Date.now();
  const merged = {
    ...stored,
    ...payload,
    refresh_token: stored.refresh_token,
    obtained_at: now,
    expires_at: now + (Number(payload?.expires_in || 0) * 1000)
  };

  await saveTokens(merged);
  return merged;
}

export async function refreshStoredToken() {
  const stored = await loadTokens();
  if (!stored?.refresh_token) {
    throw buildRecruitError({ status: 404, type: "not_found", message: "No refresh token stored" });
  }
  return requestAccessTokenRefresh(stored);
}

async function getValidToken() {
  const stored = await loadTokens();
  if (!stored?.access_token && !stored?.refresh_token) {
    throw buildRecruitError({ status: 401, type: "auth", message: "No token stored" });
  }

  const expiresAt = Number(stored?.expires_at || 0);
  const needsRefresh = !stored?.access_token || !expiresAt || (expiresAt - Date.now() < 60_000);
  if (!needsRefresh) return stored;

  return requestAccessTokenRefresh(stored);
}

async function recruitRequestOnce(path, { method = "GET", query = {}, token, headers = {} } = {}) {
  const base = zohoRecruitBase();
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token.access_token}`,
      ...headers
    }
  });

  if (resp.status === 204) {
    return { payload: { data: [], info: { count: 0, more_records: false } }, response: resp, url: url.toString(), recruitBase: base };
  }

  const text = await resp.text();
  const payload = parseJson(text);
  if (!resp.ok) {
    throw classifyRecruitError(resp.status, payload, base, path);
  }

  const embeddedError = unwrapRecruitError(payload);
  if (embeddedError?.status === "error") {
    throw classifyRecruitError(resp.status >= 400 ? resp.status : 400, payload, base, path);
  }

  return { payload, response: resp, url: url.toString(), recruitBase: base };
}

export async function recruitRequest(path, options = {}) {
  let token = options.token || await getValidToken();

  try {
    return await recruitRequestOnce(path, { ...options, token });
  } catch (error) {
    const shouldRetry = error?.type === "auth" && token?.refresh_token;
    if (!shouldRetry) throw error;

    token = await requestAccessTokenRefresh(token);
    return recruitRequestOnce(path, { ...options, token });
  }
}

export async function getRecruitRecord(moduleApiName, recordId) {
  const { payload, recruitBase } = await recruitRequest(`/recruit/v2/${moduleApiName}/${encodeURIComponent(recordId)}`);
  const record = Array.isArray(payload?.data) ? payload.data[0] : payload?.data || null;
  if (!record) {
    throw buildRecruitError({
      status: 404,
      type: "not_found",
      message: `${moduleApiName} record not found`,
      recruitBase,
      path: `/recruit/v2/${moduleApiName}/${recordId}`,
      payload
    });
  }

  return { record, recruitBase, payload };
}

export async function searchJobOpeningsByTitle(title) {
  const criteriaValue = escapeRecruitCriteriaValue(title);
  let lastResult = null;

  for (const field of SEARCH_FIELDS.jobTitle) {
    try {
      const result = await recruitRequest(`/recruit/v2/${RECRUIT_MODULES.jobOpenings}/search`, {
        query: { criteria: `(${field}:equals:${criteriaValue})` }
      });
      lastResult = result;
      if (Array.isArray(result.payload?.data) && result.payload.data.length > 0) {
        return result;
      }
    } catch (error) {
      const canFallback = error?.type === "not_found" || error?.code === "INVALID_DATA" || error?.code === "INVALID_QUERY";
      if (!canFallback) throw error;
    }
  }

  return lastResult || { payload: { data: [], info: { count: 0, more_records: false } }, recruitBase: zohoRecruitBase() };
}

export async function listJobApplicants(jobId, query = {}) {
  const candidatePath = `/recruit/v2/${RECRUIT_MODULES.jobOpenings}/${encodeURIComponent(jobId)}/Candidates`;
  const associatePath = `/recruit/v2/${RECRUIT_MODULES.jobOpenings}/${encodeURIComponent(jobId)}/associate`;

  try {
    return await recruitRequest(candidatePath, { query });
  } catch (error) {
    const shouldFallback = error?.type === "not_found" || error?.type === "missing_module" || error?.code === "INVALID_URL_PATTERN";
    if (!shouldFallback) throw error;
    return recruitRequest(associatePath, { query });
  }
}

async function listAttachments(moduleApiName, recordId) {
  const { payload, recruitBase } = await recruitRequest(`/recruit/v2/${moduleApiName}/${encodeURIComponent(recordId)}/Attachments`);
  return {
    attachments: Array.isArray(payload?.data) ? payload.data : [],
    info: payload?.info || null,
    recruitBase
  };
}

export async function getCandidateResumeArtifacts(candidateId, applicationId = null) {
  const sources = [{ moduleApiName: RECRUIT_MODULES.candidates, recordId: candidateId, label: "candidate" }];
  if (applicationId) {
    sources.push({ moduleApiName: RECRUIT_MODULES.applications, recordId: applicationId, label: "application" });
  }

  const collected = [];
  let recruitBase = zohoRecruitBase();

  for (const source of sources) {
    try {
      const { attachments, info, recruitBase: resolvedBase } = await listAttachments(source.moduleApiName, source.recordId);
      recruitBase = resolvedBase;
      collected.push({
        ...source,
        info,
        attachments: attachments.map((record) =>
          normalizeAttachmentRecord(record, {
            moduleApiName: source.moduleApiName,
            recordId: source.recordId,
            recruitBase: resolvedBase
          })
        )
      });
    } catch (error) {
      const isOptionalApplicationSource = source.label === "application";
      const canSkipOptionalSource = error?.type === "missing_module" || error?.code === "INVALID_URL_PATTERN";
      if (!isOptionalApplicationSource || !canSkipOptionalSource) throw error;
    }
  }

  const attachments = collected.flatMap((item) => item.attachments.map((attachment) => ({ ...attachment, source: item.label })));
  return {
    recruitBase,
    sources: collected,
    attachments,
    primaryResume: selectPrimaryResume(attachments)
  };
}

export function sendApiError(res, error) {
  const status = Number(error?.status) || 500;
  return json(res, status, {
    ok: false,
    error: {
      type: error?.type || "internal",
      code: error?.code || null,
      message: String(error?.message || error || "Unexpected error"),
      details: error?.details || null
    },
    recruitBase: error?.recruitBase || null,
    path: error?.path || null
  });
}
