import { json, loadTokens, saveTokens, requireSecret, zohoAccountsHost } from "./_lib.js";

export default async function handler(req, res) {
  if (!requireSecret(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  try {
    const stored = await loadTokens();
    if (!stored?.refresh_token) {
      return json(res, 404, { ok: false, error: "No refresh token stored" });
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
    if (!resp.ok || data.error) return json(res, 400, { ok: false, error: data });

    const now = Date.now();
    const merged = {
      ...stored,
      ...data,
      refresh_token: stored.refresh_token,
      obtained_at: now,
      expires_at: now + (Number(data.expires_in || 0) * 1000)
    };
    await saveTokens(merged);

    return json(res, 200, {
      ok: true,
      expires_in: merged.expires_in,
      expires_at: merged.expires_at,
      api_domain: merged.api_domain
    });
  } catch (err) {
    return json(res, 500, { ok: false, error: String(err.message || err) });
  }
}
