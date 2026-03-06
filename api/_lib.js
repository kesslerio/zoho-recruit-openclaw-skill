const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const TOKEN_KEY = process.env.ZOHO_TOKEN_KEY || "zoho:tokens";

export const json = (res, status, data) => {
  res.status(status).setHeader("content-type", "application/json");
  res.send(JSON.stringify(data));
};

export const getBaseUrl = (req) => {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
};

export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;

  if (typeof req.body === "string") {
    const trimmed = req.body.trim();
    if (!trimmed) return {};

    try {
      return JSON.parse(trimmed);
    } catch (error) {
      error.status = 400;
      error.type = "validation";
      error.message = "Invalid JSON request body";
      throw error;
    }
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (error) {
    error.status = 400;
    error.type = "validation";
    error.message = "Invalid JSON request body";
    throw error;
  }
}

export const methodNotAllowed = (res, allowed) => {
  res.setHeader("allow", allowed.join(", "));
  return json(res, 405, {
    ok: false,
    error: {
      type: "method_not_allowed",
      message: `Method not allowed. Use ${allowed.join(", ")}`
    }
  });
};

export const firstQueryValue = (value, fallback = null) => {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
};

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function kvFetch(url, method = "GET") {
  if (!KV_URL || !KV_TOKEN) throw new Error("KV not configured");
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`
    }
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`KV error ${resp.status}: ${text}`);
  }

  return resp.json();
}

async function kvSet(key, value) {
  const encodedKey = encodeURIComponent(key);
  const encodedValue = encodeURIComponent(value);
  return kvFetch(`${KV_URL}/set/${encodedKey}/${encodedValue}`);
}

async function kvGet(key) {
  const encodedKey = encodeURIComponent(key);
  return kvFetch(`${KV_URL}/get/${encodedKey}`);
}

export async function saveKvJson(key, value) {
  return kvSet(key, JSON.stringify(value));
}

export async function loadKvJson(key) {
  const out = await kvGet(key);
  if (!out?.result) return null;
  return JSON.parse(out.result);
}

export async function saveTokens(tokenPayload) {
  return saveKvJson(TOKEN_KEY, tokenPayload);
}

export async function loadTokens() {
  return loadKvJson(TOKEN_KEY);
}

export const requireSecret = (req) => {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return true;
  const presented = req.headers["x-internal-secret"] || req.query.secret;
  return presented === expected;
};

export const zohoAccountsHost = () => {
  const region = process.env.ZOHO_REGION || "com";
  return `https://accounts.zoho.${region}`;
};

export const zohoRecruitBase = () => {
  if (process.env.ZOHO_RECRUIT_BASE) return trimTrailingSlash(process.env.ZOHO_RECRUIT_BASE);
  const region = process.env.ZOHO_REGION || "com";
  return `https://recruit.zoho.${region}`;
};
