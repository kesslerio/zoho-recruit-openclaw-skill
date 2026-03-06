import {
  firstQueryValue,
  json,
  requireSecret
} from "../../_lib.js";
import {
  RECRUIT_MODULES,
  clampPositiveInt,
  getRecruitRecord,
  recruitRequest,
  searchJobOpeningsByTitle,
  sendApiError
} from "../_shared.js";
import { normalizeJobRecord } from "../_normalize.js";

export default async function handler(req, res) {
  if (!requireSecret(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  try {
    const id = firstQueryValue(req.query.id ?? req.query.jobId, null);
    const title = firstQueryValue(req.query.title, null);
    const page = clampPositiveInt(req.query.page, 1);
    const perPage = clampPositiveInt(req.query.perPage || req.query.per_page, 50, { max: 200 });

    let payload;
    let recruitBase;
    let records = [];
    let mode = "list";

    if (id) {
      mode = "id";
      const result = await getRecruitRecord(RECRUIT_MODULES.jobOpenings, id);
      payload = result.payload;
      recruitBase = result.recruitBase;
      records = [result.record];
    } else if (title) {
      mode = "title";
      const result = await searchJobOpeningsByTitle(title);
      payload = result.payload;
      recruitBase = result.recruitBase;
      records = Array.isArray(result.payload?.data) ? result.payload.data : [];
    } else {
      const result = await recruitRequest(`/recruit/v2/${RECRUIT_MODULES.jobOpenings}`, {
        query: {
          page,
          per_page: perPage,
          sort_by: req.query.sortBy || "Modified_Time",
          sort_order: req.query.sortOrder || "desc"
        }
      });
      payload = result.payload;
      recruitBase = result.recruitBase;
      records = Array.isArray(result.payload?.data) ? result.payload.data : [];
    }

    const jobs = records.map(normalizeJobRecord);
    return json(res, 200, {
      ok: true,
      query: {
        mode,
        id,
        title,
        page: mode === "list" ? page : null,
        perPage: mode === "list" ? perPage : null
      },
      count: jobs.length,
      jobs,
      recruitBase,
      info: payload?.info || null
    });
  } catch (error) {
    return sendApiError(res, error);
  }
}
