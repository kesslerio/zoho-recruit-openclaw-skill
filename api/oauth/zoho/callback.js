import { getBaseUrl, json, saveTokens, zohoAccountsHost } from "../../_lib.js";

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
    await saveTokens({
      ...data,
      obtained_at: now,
      expires_at: now + (Number(data.expires_in || 0) * 1000)
    });

    return json(res, 200, {
      ok: true,
      message: "Zoho OAuth connected and token stored",
      expires_in: data.expires_in,
      api_domain: data.api_domain
    });
  } catch (err) {
    return json(res, 500, { ok: false, error: String(err?.message || err) });
  }
}
