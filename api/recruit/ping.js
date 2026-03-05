import { json, loadTokens, refreshStoredToken, requireSecret, zohoRecruitBase } from "../_lib.js";

async function getValidToken() {
  const stored = await loadTokens();
  if (!stored) throw new Error("No token stored");

  const expiresAt = Number(stored.expires_at || 0);
  const needsRefresh = !stored.access_token || !expiresAt || (expiresAt - Date.now() < 60_000);
  if (!needsRefresh) return stored;

  return refreshStoredToken();
}

export default async function handler(req, res) {
  if (!requireSecret(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  try {
    const token = await getValidToken();
    const base = zohoRecruitBase();
    const url = `${base}/recruit/v2/Candidates?per_page=1`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Zoho-oauthtoken ${token.access_token}`
      }
    });

    const text = await resp.text();
    let payload = null;
    if (text && text.trim().length > 0) {
      try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 300) }; }
    }

    if (!resp.ok) {
      return json(res, 400, { ok: false, error: payload, recruitBase: base, status: resp.status });
    }

    const count = Array.isArray(payload?.data) ? payload.data.length : 0;
    return json(res, 200, {
      ok: true,
      recruitBase: base,
      sampleCount: count,
      info: "Recruit API reachable"
    });
  } catch (err) {
    return json(res, 500, { ok: false, error: String(err?.message || err) });
  }
}
