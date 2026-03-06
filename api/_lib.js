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

export async function saveTokens(tokenPayload) {
  const key = encodeURIComponent(TOKEN_KEY);
  const val = encodeURIComponent(JSON.stringify(tokenPayload));
  return kvFetch(`${KV_URL}/set/${key}/${val}`);
}

export async function loadTokens() {
  const key = encodeURIComponent(TOKEN_KEY);
  const out = await kvFetch(`${KV_URL}/get/${key}`);
  if (!out?.result) return null;
  return JSON.parse(out.result);
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
