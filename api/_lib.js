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

async function kvFetch(url, method = "GET") {
  if (!KV_URL || !KV_TOKEN) throw new Error("KV not configured");
  const resp = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${KV_TOKEN}`
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
  if (process.env.ZOHO_RECRUIT_BASE) return process.env.ZOHO_RECRUIT_BASE;
  const region = process.env.ZOHO_REGION || "com";
  return `https://recruit.zoho.${region}`;
};

export async function refreshStoredToken() {
  const stored = await loadTokens();
  if (!stored?.refresh_token) throw new Error("No refresh token stored");
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET) {
    throw new Error("Missing ZOHO_CLIENT_ID/ZOHO_CLIENT_SECRET");
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

  const data = await resp.json();
  if (!resp.ok || data.error) {
    throw new Error(`Refresh failed: ${JSON.stringify(data)}`);
  }

  const now = Date.now();
  const merged = {
    ...stored,
    ...data,
    refresh_token: stored.refresh_token,
    obtained_at: now,
    expires_at: now + (Number(data.expires_in || 0) * 1000)
  };

  await saveTokens(merged);
  return merged;
}
