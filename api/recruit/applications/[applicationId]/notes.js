import { json, methodNotAllowed, readJsonBody, requireSecret } from "../../../_lib.js";
import { RECRUIT_MODULES, sendApiError } from "../../_shared.js";
import { createRecruitRecordNote } from "../../_write.js";

export default async function handler(req, res) {
  if (!requireSecret(req)) return json(res, 401, { ok: false, error: "Unauthorized" });
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const applicationId = req.query.applicationId;
    if (!applicationId) {
      return json(res, 400, { ok: false, error: { type: "validation", message: "Missing applicationId" } });
    }

    const body = await readJsonBody(req);
    return json(res, 200, await createRecruitRecordNote(RECRUIT_MODULES.applications, applicationId, body));
  } catch (error) {
    return sendApiError(res, error);
  }
}
