import {
  firstQueryValue,
  json,
  requireSecret
} from "../../../_lib.js";
import {
  getCandidateResumeArtifacts,
  sendApiError
} from "../../_shared.js";

export default async function handler(req, res) {
  if (!requireSecret(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  try {
    const candidateId = firstQueryValue(req.query.candidateId, null);
    const applicationId = firstQueryValue(req.query.applicationId, null);

    if (!candidateId) {
      return json(res, 400, { ok: false, error: { type: "validation", message: "Missing candidateId" } });
    }

    const result = await getCandidateResumeArtifacts(candidateId, applicationId);
    return json(res, 200, {
      ok: true,
      candidateId,
      applicationId,
      primaryResume: result.primaryResume,
      attachmentCount: result.attachments.length,
      attachments: result.attachments,
      sources: result.sources.map((source) => ({
        label: source.label,
        moduleApiName: source.moduleApiName,
        recordId: source.recordId,
        count: source.attachments.length,
        info: source.info,
        attachments: source.attachments
      })),
      recruitBase: result.recruitBase
    });
  } catch (error) {
    return sendApiError(res, error);
  }
}
