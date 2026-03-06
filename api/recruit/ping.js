import { json, requireSecret } from "../_lib.js";
import { recruitRequest, sendApiError } from "./_shared.js";

export default async function handler(req, res) {
  if (!requireSecret(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  try {
    const result = await recruitRequest("/recruit/v2/Candidates", {
      query: { per_page: 1 }
    });

    const count = Array.isArray(result.payload?.data) ? result.payload.data.length : 0;
    return json(res, 200, {
      ok: true,
      recruitBase: result.recruitBase,
      sampleCount: count,
      info: "Recruit API reachable"
    });
  } catch (error) {
    return sendApiError(res, error);
  }
}
