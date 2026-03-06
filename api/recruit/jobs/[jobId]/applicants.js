import { firstQueryValue, json, requireSecret } from "../../../_lib.js";
import {
  RECRUIT_MODULES,
  clampPositiveInt,
  getRecruitRecord,
  listJobApplicants,
  sendApiError
} from "../../_shared.js";
import { normalizeApplicantRecord, normalizeJobRecord } from "../../_normalize.js";

export default async function handler(req, res) {
  if (!requireSecret(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  try {
    const jobId = firstQueryValue(req.query.jobId, null);
    if (!jobId) {
      return json(res, 400, { ok: false, error: { type: "validation", message: "Missing jobId" } });
    }

    const page = clampPositiveInt(req.query.page, 1);
    const perPage = clampPositiveInt(req.query.perPage || req.query.per_page, 50, { max: 200 });
    const candidateStatuses = firstQueryValue(req.query.candidateStatuses ?? req.query.candidate_statuses, null);

    const [jobResult, applicantsResult] = await Promise.all([
      getRecruitRecord(RECRUIT_MODULES.jobOpenings, jobId),
      listJobApplicants(jobId, {
        page,
        per_page: perPage,
        candidate_statuses: candidateStatuses
      })
    ]);

    const job = normalizeJobRecord(jobResult.record);
    const applicants = (Array.isArray(applicantsResult.payload?.data) ? applicantsResult.payload.data : [])
      .map((record) => normalizeApplicantRecord(record, { job }));

    return json(res, 200, {
      ok: true,
      job,
      query: {
        page,
        perPage,
        candidateStatuses
      },
      count: applicants.length,
      applicants,
      reviewPayloads: applicants.map((applicant) => applicant.reviewPayload),
      recruitBase: applicantsResult.recruitBase,
      info: applicantsResult.payload?.info || null
    });
  } catch (error) {
    return sendApiError(res, error);
  }
}
