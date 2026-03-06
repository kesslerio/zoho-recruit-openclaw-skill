import { json, requireSecret } from "./_lib.js";
import { refreshStoredToken, sendApiError } from "./recruit/_shared.js";

export default async function handler(req, res) {
  if (!requireSecret(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  try {
    const merged = await refreshStoredToken();
    return json(res, 200, {
      ok: true,
      expires_in: merged.expires_in,
      expires_at: merged.expires_at,
      api_domain: merged.api_domain
    });
  } catch (error) {
    return sendApiError(res, error);
  }
}
