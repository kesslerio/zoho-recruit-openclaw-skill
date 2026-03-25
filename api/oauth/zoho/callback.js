import { getBaseUrl, hasKvConfig, json, saveTokens, zohoAccountsHost } from "../../_lib.js";

const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache"
};

export default async function handler(req, res) {
  try {
    const code = req.query.code;
    if (!code) return json(res, 400, { ok: false, error: "Missing code" });

    if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET) {
      return json(res, 500, { ok: false, error: "Missing ZOHO_CLIENT_ID/ZOHO_CLIENT_SECRET" });
    }

    const redirectUri = process.env.ZOHO_REDIRECT_URI || `${getBaseUrl(req)}/api/oauth/zoho/callback`;

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code
    });

    const resp = await fetch(`${zohoAccountsHost()}/oauth/v2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });

    const data = await resp.json();
    if (!resp.ok || data.error) {
      return json(res, 400, { ok: false, error: data });
    }

    const now = Date.now();
    const tokenPayload = {
      ...data,
      obtained_at: now,
      expires_at: now + (Number(data.expires_in || 0) * 1000)
    };

    if (hasKvConfig()) {
      await saveTokens(tokenPayload);

      return json(res, 200, {
        ok: true,
        message: "Zoho OAuth connected and token stored",
        storage: "kv",
        expires_in: data.expires_in,
        api_domain: data.api_domain
      }, NO_STORE_HEADERS);
    }

    return json(res, 200, {
      ok: true,
      message: "Zoho OAuth connected. KV is not configured, so store the refresh token in ZOHO_REFRESH_TOKEN before using read-side Recruit endpoints.",
      storage: "manual_env",
      warning: "This response contains a refresh token. Treat it like a password and store it only in Vercel env.",
      manualEnv: {
        ZOHO_REFRESH_TOKEN: data.refresh_token,
        ZOHO_API_DOMAIN: data.api_domain || null
      },
      expires_in: data.expires_in,
      api_domain: data.api_domain,
      expires_at: tokenPayload.expires_at
    }, NO_STORE_HEADERS);
  } catch (err) {
    return json(res, 500, { ok: false, error: String(err?.message || err) });
  }
}
