import { json, loadTokens, requireSecret } from "./_lib.js";

export default async function handler(req, res) {
  if (!requireSecret(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  try {
    const data = await loadTokens();
    if (!data) return json(res, 404, { ok: false, error: "No token stored" });

    return json(res, 200, {
      ok: true,
      access_token: data.access_token,
      api_domain: data.api_domain,
      expires_at: data.expires_at,
      expires_in_ms: data.expires_at ? (data.expires_at - Date.now()) : null
    });
  } catch (err) {
    return json(res, 500, { ok: false, error: String(err.message || err) });
  }
}
