import { json, methodNotAllowed, readJsonBody, requireSecret } from "../../../_lib.js";
import { RECRUIT_MODULES, sendApiError } from "../../_shared.js";
import { executeRecruitDecision } from "../../_write.js";

export default async function handler(req, res) {
  if (!requireSecret(req)) return json(res, 401, { ok: false, error: "Unauthorized" });
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const candidateId = req.query.candidateId;
    if (!candidateId) {
      return json(res, 400, { ok: false, error: { type: "validation", message: "Missing candidateId" } });
    }

    const body = await readJsonBody(req);
    return json(res, 200, await executeRecruitDecision(RECRUIT_MODULES.candidates, candidateId, body));
  } catch (error) {
    return sendApiError(res, error);
  }
}
