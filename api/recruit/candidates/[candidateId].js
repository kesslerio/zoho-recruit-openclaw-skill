import {
  firstQueryValue,
  json,
  requireSecret
} from "../../_lib.js";
import {
  RECRUIT_MODULES,
  getCandidateResumeArtifacts,
  getRecruitRecord,
  sendApiError
} from "../_shared.js";
import {
  normalizeApplicationRecord,
  normalizeCandidateRecord,
  normalizeJobRecord
} from "../_normalize.js";

export default async function handler(req, res) {
  if (!requireSecret(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  try {
    const candidateId = firstQueryValue(req.query.candidateId, null);
    const applicationId = firstQueryValue(req.query.applicationId, null);
    const jobId = firstQueryValue(req.query.jobId, null);
    const includeAttachments = firstQueryValue(req.query.includeAttachments, "1") !== "0";

    if (!candidateId) {
      return json(res, 400, { ok: false, error: { type: "validation", message: "Missing candidateId" } });
    }

    const candidatePromise = getRecruitRecord(RECRUIT_MODULES.candidates, candidateId);
    const applicationPromise = applicationId ? getRecruitRecord(RECRUIT_MODULES.applications, applicationId) : Promise.resolve(null);
    const jobPromise = jobId ? getRecruitRecord(RECRUIT_MODULES.jobOpenings, jobId) : Promise.resolve(null);
    const resumePromise = includeAttachments ? getCandidateResumeArtifacts(candidateId, applicationId) : Promise.resolve(null);

    const [candidateResult, applicationResult, jobResult, resumeResult] = await Promise.all([
      candidatePromise,
      applicationPromise,
      jobPromise,
      resumePromise
    ]);

    const application = applicationResult ? normalizeApplicationRecord(applicationResult.record) : null;
    const job = jobResult ? normalizeJobRecord(jobResult.record) : null;
    const attachments = resumeResult?.attachments || [];
    const candidate = normalizeCandidateRecord(candidateResult.record, { attachments, application, job });

    return json(res, 200, {
      ok: true,
      candidate,
      application,
      job,
      resume: resumeResult ? {
        primary: resumeResult.primaryResume,
        attachmentCount: resumeResult.attachments.length,
        attachments: resumeResult.attachments,
        sources: resumeResult.sources.map((source) => ({
          label: source.label,
          moduleApiName: source.moduleApiName,
          recordId: source.recordId,
          count: source.attachments.length,
          info: source.info
        }))
      } : null,
      reviewPayload: candidate.reviewPayload,
      recruitBase: candidateResult.recruitBase,
      raw: {
        candidate: candidateResult.record,
        application: applicationResult?.record || null,
        job: jobResult?.record || null
      }
    });
  } catch (error) {
    return sendApiError(res, error);
  }
}
