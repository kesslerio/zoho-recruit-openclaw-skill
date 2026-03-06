import { createHash } from "node:crypto";
import { loadKvJson, saveKvJson } from "../_lib.js";
import { RECRUIT_MODULES, getRecruitRecord, recruitRequest } from "./_shared.js";
import {
  normalizeApplicationRecord,
  normalizeCandidateRecord,
  normalizeNoteRecord
} from "./_normalize.js";

const IDEMPOTENCY_PREFIX = process.env.ZOHO_IDEMPOTENCY_PREFIX || "zoho:idempotency";
const ALLOWED_DECISIONS = new Set(["approve", "reject", "disqualify", "advance", "hold"]);
const NOTE_MARKER_PREFIX = "OpenClaw Idempotency Key:";
const SOURCE_RUN_MARKER_PREFIX = "OpenClaw Source Run ID:";

const MODULE_CONFIG = {
  [RECRUIT_MODULES.applications]: {
    moduleKey: "applications",
    idKey: "applicationId",
    normalize: (record) => normalizeApplicationRecord(record),
    defaultFieldMap: {
      status: "Application_Status",
      stage: "Stage"
    }
  },
  [RECRUIT_MODULES.candidates]: {
    moduleKey: "candidates",
    idKey: "candidateId",
    normalize: (record) => normalizeCandidateRecord(record),
    defaultFieldMap: {
      status: "Candidate_Status",
      stage: "Stage"
    }
  }
};

let cachedDecisionFieldMap;

function buildError(status, type, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.type = type;
  error.details = details;
  return error;
}

function getModuleConfig(moduleApiName) {
  const config = MODULE_CONFIG[moduleApiName];
  if (!config) throw buildError(400, "validation", `Unsupported Recruit module: ${moduleApiName}`);
  return config;
}

function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeTrigger(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function stableSerialize(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function parseDecisionFieldMap() {
  if (cachedDecisionFieldMap !== undefined) return cachedDecisionFieldMap;

  const raw = process.env.ZOHO_RECRUIT_DECISION_FIELD_MAP;
  if (!raw) {
    cachedDecisionFieldMap = {};
    return cachedDecisionFieldMap;
  }

  try {
    cachedDecisionFieldMap = JSON.parse(raw);
  } catch {
    cachedDecisionFieldMap = {};
  }

  return cachedDecisionFieldMap;
}

function getModuleFieldMap(moduleApiName) {
  const config = getModuleConfig(moduleApiName);
  const parsed = parseDecisionFieldMap();
  const configured = parsed[config.moduleKey] || parsed[moduleApiName] || {};
  return {
    ...config.defaultFieldMap,
    ...asPlainObject(configured)
  };
}

function normalizeRecordState(moduleApiName, record) {
  return getModuleConfig(moduleApiName).normalize(record);
}

function buildIdentifiers(moduleApiName, state) {
  if (moduleApiName === RECRUIT_MODULES.applications) {
    return {
      applicationId: state.id,
      candidateId: state.candidate?.id || null,
      jobOpeningId: state.jobOpening?.id || null
    };
  }

  return {
    candidateId: state.id,
    jobOpeningId: state.jobOpening?.id || null
  };
}

function buildStateChange(previousState, currentState) {
  return {
    status: {
      from: previousState?.status ?? null,
      to: currentState?.status ?? null
    },
    stage: {
      from: previousState?.stage ?? null,
      to: currentState?.stage ?? null
    },
    modifiedTime: {
      from: previousState?.modifiedTime ?? previousState?.updatedTime ?? null,
      to: currentState?.modifiedTime ?? currentState?.updatedTime ?? null
    }
  };
}

function pickScore(scorecard) {
  if (scorecard === null || scorecard === undefined) return null;
  if (typeof scorecard === "number") return scorecard;
  if (typeof scorecard === "string") {
    const parsed = Number(scorecard);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return firstNonEmpty(
    scorecard.overallScore,
    scorecard.score,
    scorecard.totalScore,
    scorecard.normalizedScore,
    scorecard.value,
    null
  );
}

function summarizeScorecard(scorecard) {
  if (!scorecard) return null;
  if (typeof scorecard === "string") return scorecard;
  return firstNonEmpty(scorecard.summary, scorecard.rubricSummary, scorecard.notes, null);
}

function getExternalSyncId(externalSync) {
  if (!externalSync) return null;
  if (typeof externalSync === "string" || typeof externalSync === "number") return String(externalSync);
  return firstNonEmpty(
    externalSync.attioRecordId,
    externalSync.recordId,
    externalSync.externalId,
    externalSync.id,
    null
  );
}

function compactJson(value) {
  return JSON.stringify(value, null, 2);
}

function normalizeDecisionInput(body) {
  const target = asPlainObject(body.target);
  const reviewer = asPlainObject(body.reviewer);
  const scorecard = body.scorecard ?? null;
  const externalSync = body.externalSync ?? body.external_sync ?? null;
  const decision = String(firstNonEmpty(body.decision, "")).trim().toLowerCase();

  if (!ALLOWED_DECISIONS.has(decision)) {
    throw buildError(400, "validation", `Invalid decision. Expected one of: ${[...ALLOWED_DECISIONS].join(", ")}`);
  }

  return {
    decision,
    target: {
      status: firstNonEmpty(target.status, target.Status, target.target_status, body.targetStatus, body.target_status, body.status, null),
      stage: firstNonEmpty(target.stage, target.Stage, target.target_stage, body.targetStage, body.target_stage, body.stage, null)
    },
    reviewer: {
      id: firstNonEmpty(reviewer.id, reviewer.ID, reviewer.reviewerId, reviewer.reviewer_id, body.reviewerId, body.reviewer_id, null),
      name: firstNonEmpty(reviewer.name, reviewer.Name, reviewer.reviewerName, reviewer.reviewer_name, body.reviewerName, body.reviewer_name, null)
    },
    summary: firstNonEmpty(body.summary, body.decisionSummary, body.decision_summary, summarizeScorecard(scorecard), null),
    rationale: firstNonEmpty(body.rationale, body.notes, null),
    notes: firstNonEmpty(body.notes, body.comment, null),
    scorecard,
    score: pickScore(scorecard),
    fieldValues: asPlainObject(body.fieldValues || body.fields),
    externalSync,
    sourceRunId: firstNonEmpty(body.sourceRunId, body.source_run_id, null),
    idempotencyKey: firstNonEmpty(body.idempotencyKey, body.idempotency_key, null),
    noteTitle: firstNonEmpty(body.noteTitle, body.note_title, null),
    createNote: normalizeBoolean(firstNonEmpty(body.createNote, body.create_note), true),
    trigger: normalizeTrigger(body.trigger)
  };
}

function normalizeNoteInput(body) {
  const target = asPlainObject(body.target);
  const reviewer = asPlainObject(body.reviewer);
  const decisionPayload = body.decision ? normalizeDecisionInput(body) : null;

  return {
    title: firstNonEmpty(body.title, body.noteTitle, body.note_title, decisionPayload?.noteTitle, null),
    content: firstNonEmpty(body.content, body.noteContent, body.note_content, null),
    summary: firstNonEmpty(body.summary, decisionPayload?.summary, null),
    rationale: firstNonEmpty(body.rationale, decisionPayload?.rationale, null),
    notes: firstNonEmpty(body.notes, decisionPayload?.notes, null),
    reviewer: decisionPayload?.reviewer || {
      id: firstNonEmpty(reviewer.id, reviewer.ID, reviewer.reviewerId, reviewer.reviewer_id, body.reviewerId, body.reviewer_id, null),
      name: firstNonEmpty(reviewer.name, reviewer.Name, reviewer.reviewerName, reviewer.reviewer_name, body.reviewerName, body.reviewer_name, null)
    },
    scorecard: body.scorecard ?? decisionPayload?.scorecard ?? null,
    decision: decisionPayload?.decision || firstNonEmpty(body.decision, null),
    target: decisionPayload?.target || {
      status: firstNonEmpty(target.status, target.Status, target.target_status, body.targetStatus, body.target_status, body.status, null),
      stage: firstNonEmpty(target.stage, target.Stage, target.target_stage, body.targetStage, body.target_stage, body.stage, null)
    },
    externalSync: decisionPayload?.externalSync || body.externalSync || body.external_sync || null,
    sourceRunId: firstNonEmpty(body.sourceRunId, body.source_run_id, decisionPayload?.sourceRunId, null),
    idempotencyKey: firstNonEmpty(body.idempotencyKey, body.idempotency_key, decisionPayload?.idempotencyKey, null)
  };
}

function buildDecisionFieldUpdates(moduleApiName, input) {
  const fieldMap = getModuleFieldMap(moduleApiName);
  const updates = {
    ...input.fieldValues
  };

  if (input.target.status && fieldMap.status) updates[fieldMap.status] = input.target.status;
  if (input.target.stage && fieldMap.stage) updates[fieldMap.stage] = input.target.stage;
  if (fieldMap.decision) updates[fieldMap.decision] = input.decision;
  if (fieldMap.summary && input.summary) updates[fieldMap.summary] = input.summary;
  if (fieldMap.score && input.score !== null && input.score !== undefined) updates[fieldMap.score] = input.score;
  if (fieldMap.reviewerName && input.reviewer.name) updates[fieldMap.reviewerName] = input.reviewer.name;
  if (fieldMap.reviewerId && input.reviewer.id) updates[fieldMap.reviewerId] = input.reviewer.id;
  if (fieldMap.sourceRunId && input.sourceRunId) updates[fieldMap.sourceRunId] = input.sourceRunId;

  const externalSyncId = getExternalSyncId(input.externalSync);
  if (fieldMap.externalSyncId && externalSyncId) updates[fieldMap.externalSyncId] = externalSyncId;
  if (fieldMap.externalSyncJson && input.externalSync) updates[fieldMap.externalSyncJson] = compactJson(input.externalSync);
  if (fieldMap.scorecardJson && input.scorecard) updates[fieldMap.scorecardJson] = compactJson(input.scorecard);

  return Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined));
}

function buildDecisionSummary(input) {
  return {
    decision: input.decision,
    target: input.target,
    reviewer: input.reviewer,
    scorecard: {
      score: input.score,
      summary: summarizeScorecard(input.scorecard),
      raw: input.scorecard
    },
    summary: input.summary,
    rationale: input.rationale,
    notes: input.notes,
    externalSync: input.externalSync,
    sourceRunId: input.sourceRunId,
    idempotencyKey: input.idempotencyKey
  };
}

function buildNoteTitle(input, fallback) {
  return firstNonEmpty(
    input.noteTitle,
    input.title,
    input.decision ? `OpenClaw ${String(input.decision).charAt(0).toUpperCase()}${String(input.decision).slice(1)} Decision` : null,
    fallback
  );
}

function buildNoteContent(input, { includeDecisionHeader = true } = {}) {
  const lines = [];
  const score = firstNonEmpty(input.score, pickScore(input.scorecard), null);

  if (input.content) lines.push(String(input.content).trim());
  if (includeDecisionHeader && input.decision) lines.push(`Decision: ${input.decision}`);
  if (input.target?.stage) lines.push(`Target Stage: ${input.target.stage}`);
  if (input.target?.status) lines.push(`Target Status: ${input.target.status}`);
  if (input.reviewer?.name || input.reviewer?.id) {
    lines.push(`Reviewer: ${input.reviewer.name || "Unknown"}${input.reviewer.id ? ` (${input.reviewer.id})` : ""}`);
  }
  if (input.summary) lines.push(`Summary: ${input.summary}`);
  if (input.rationale) lines.push(`Rationale: ${input.rationale}`);
  if (input.notes && input.notes !== input.rationale) lines.push(`Notes: ${input.notes}`);
  if (score !== null && score !== undefined) lines.push(`Score: ${score}`);

  const scorecardSummary = summarizeScorecard(input.scorecard);
  if (scorecardSummary && scorecardSummary !== input.summary) lines.push(`Rubric Summary: ${scorecardSummary}`);
  if (input.scorecard && typeof input.scorecard === "object") lines.push(`Scorecard JSON:\n${compactJson(input.scorecard)}`);
  if (input.externalSync) lines.push(`External Sync:\n${compactJson(input.externalSync)}`);
  if (input.idempotencyKey) lines.push(`${NOTE_MARKER_PREFIX} ${input.idempotencyKey}`);
  if (input.sourceRunId) lines.push(`${SOURCE_RUN_MARKER_PREFIX} ${input.sourceRunId}`);

  return lines.map((line) => String(line).trim()).filter(Boolean).join("\n\n");
}

function buildIdempotencyContext(operation, moduleApiName, recordId, payload) {
  const idempotencyKey = firstNonEmpty(payload.idempotencyKey, payload.sourceRunId, null);
  if (!idempotencyKey) {
    return {
      cacheKey: null,
      requestHash: null,
      idempotencyKey: null,
      sourceRunId: payload.sourceRunId || null
    };
  }

  return {
    cacheKey: `${IDEMPOTENCY_PREFIX}:${operation}:${moduleApiName}:${recordId}:${idempotencyKey}`,
    requestHash: fingerprint({ operation, moduleApiName, recordId: String(recordId), payload }),
    idempotencyKey,
    sourceRunId: payload.sourceRunId || null
  };
}

async function loadCachedResponse(context) {
  if (!context.cacheKey) return null;

  const cached = await loadKvJson(context.cacheKey);
  if (!cached) return null;
  if (cached.requestHash !== context.requestHash) {
    throw buildError(409, "idempotency_conflict", "Idempotency key was already used with a different payload");
  }

  return {
    ...cached.response,
    idempotency: {
      ...cached.response.idempotency,
      replayed: true
    }
  };
}

async function saveCachedResponse(context, response) {
  if (!context.cacheKey) return;
  await saveKvJson(context.cacheKey, {
    createdAt: new Date().toISOString(),
    requestHash: context.requestHash,
    response
  });
}

function extractMutationDetails(payload) {
  const row = Array.isArray(payload?.data) ? payload.data[0] : payload?.data || null;
  return {
    row,
    id: firstNonEmpty(row?.details?.id, row?.id, null)?.toString() || null
  };
}

async function updateRecruitRecord(moduleApiName, recordId, fields, trigger = []) {
  const sanitizedFields = { ...fields };
  delete sanitizedFields.id;
  delete sanitizedFields.ID;

  const body = {
    data: [{
      ...sanitizedFields,
      id: String(recordId)
    }]
  };

  if (trigger.length > 0) body.trigger = trigger;

  const result = await recruitRequest(`/recruit/v2/${moduleApiName}`, {
    method: "PUT",
    body
  });

  return {
    recruitBase: result.recruitBase,
    ...extractMutationDetails(result.payload)
  };
}

async function createRecruitNote(moduleApiName, recordId, title, content) {
  const result = await recruitRequest("/recruit/v2/Notes", {
    method: "POST",
    body: {
      data: [{
        Note_Title: title,
        Note_Content: content,
        Parent_Id: String(recordId),
        se_module: moduleApiName
      }]
    }
  });

  const details = extractMutationDetails(result.payload);
  return {
    recruitBase: result.recruitBase,
    note: normalizeNoteRecord(details.row, {
      parentId: String(recordId),
      seModule: moduleApiName,
      title,
      content
    })
  };
}

async function findExistingIdempotentNote(moduleApiName, recordId, idempotencyKey, sourceRunId = null) {
  if (!idempotencyKey && !sourceRunId) return null;

  try {
    const result = await recruitRequest("/recruit/v2/Notes", {
      query: { page: 1, per_page: 200 }
    });

    const match = (Array.isArray(result.payload?.data) ? result.payload.data : []).find((record) => {
      const note = normalizeNoteRecord(record);
      const parentId = record?.Parent_Id?.id || record?.Parent_Id || note.parentId;
      const seModule = record?.$se_module || record?.se_module || note.module;
      const content = String(note.content || "");
      const matchesIdempotencyKey = idempotencyKey ? content.includes(`${NOTE_MARKER_PREFIX} ${idempotencyKey}`) : false;
      const matchesSourceRunId = sourceRunId ? content.includes(`${SOURCE_RUN_MARKER_PREFIX} ${sourceRunId}`) : false;
      return String(parentId || "") === String(recordId)
        && String(seModule || "") === String(moduleApiName)
        && (matchesIdempotencyKey || matchesSourceRunId);
    });

    return match ? {
      recruitBase: result.recruitBase,
      note: normalizeNoteRecord(match)
    } : null;
  } catch (error) {
    const canIgnore = error?.type === "scope" || error?.type === "missing_module" || error?.type === "not_found";
    if (canIgnore) return null;
    throw error;
  }
}

function buildResponse({
  action,
  moduleApiName,
  recordId,
  previousState,
  currentState,
  note = null,
  decision = null,
  recruitBase,
  idempotency,
  appliedFields = []
}) {
  return {
    ok: true,
    action,
    resource: {
      module: moduleApiName,
      recordId: String(recordId),
      ...buildIdentifiers(moduleApiName, currentState || previousState)
    },
    previousState,
    currentState,
    stateChange: buildStateChange(previousState, currentState || previousState),
    created: {
      noteIds: note?.id ? [note.id] : [],
      reviewIds: []
    },
    note,
    decision,
    appliedFields,
    idempotency: {
      key: idempotency.idempotencyKey,
      sourceRunId: idempotency.sourceRunId,
      replayed: false
    },
    recruitBase
  };
}

export async function executeRecruitDecision(moduleApiName, recordId, body) {
  const input = normalizeDecisionInput(body);
  const idempotency = buildIdempotencyContext("decision", moduleApiName, recordId, input);
  const cached = await loadCachedResponse(idempotency);
  if (cached) return cached;

  const previousRecordResult = await getRecruitRecord(moduleApiName, recordId);
  const previousState = normalizeRecordState(moduleApiName, previousRecordResult.record);
  const fieldUpdates = buildDecisionFieldUpdates(moduleApiName, input);
  const noteContent = buildNoteContent(input);

  if (Object.keys(fieldUpdates).length === 0 && !input.createNote) {
    throw buildError(400, "validation", "Decision request must update fields or create a note");
  }

  let recruitBase = previousRecordResult.recruitBase;
  if (Object.keys(fieldUpdates).length > 0) {
    const updateResult = await updateRecruitRecord(moduleApiName, recordId, fieldUpdates, input.trigger);
    recruitBase = updateResult.recruitBase;
  }

  let note = null;
  if (input.createNote) {
    const existingNote = await findExistingIdempotentNote(moduleApiName, recordId, idempotency.idempotencyKey, idempotency.sourceRunId);
    if (existingNote) {
      note = existingNote.note;
      recruitBase = existingNote.recruitBase;
    } else {
      const createdNote = await createRecruitNote(moduleApiName, recordId, buildNoteTitle(input, "OpenClaw Recruit Decision"), noteContent);
      note = createdNote.note;
      recruitBase = createdNote.recruitBase;
    }
  }

  const currentRecordResult = await getRecruitRecord(moduleApiName, recordId);
  const currentState = normalizeRecordState(moduleApiName, currentRecordResult.record);
  recruitBase = currentRecordResult.recruitBase;

  const response = buildResponse({
    action: "decision",
    moduleApiName,
    recordId,
    previousState,
    currentState,
    note,
    decision: buildDecisionSummary(input),
    appliedFields: Object.keys(fieldUpdates),
    recruitBase,
    idempotency
  });

  await saveCachedResponse(idempotency, response);
  return response;
}

export async function createRecruitRecordNote(moduleApiName, recordId, body) {
  const input = normalizeNoteInput(body);
  const idempotency = buildIdempotencyContext("note", moduleApiName, recordId, input);
  const cached = await loadCachedResponse(idempotency);
  if (cached) return cached;

  const recordResult = await getRecruitRecord(moduleApiName, recordId);
  const currentState = normalizeRecordState(moduleApiName, recordResult.record);
  let noteResult = await findExistingIdempotentNote(moduleApiName, recordId, idempotency.idempotencyKey, idempotency.sourceRunId);

  if (!noteResult) {
    const title = buildNoteTitle(input, "OpenClaw Recruit Note");
    const content = buildNoteContent(input, { includeDecisionHeader: Boolean(input.decision) });
    if (!content) throw buildError(400, "validation", "Missing note content");
    noteResult = await createRecruitNote(moduleApiName, recordId, title, content);
  }

  const response = buildResponse({
    action: "note",
    moduleApiName,
    recordId,
    previousState: currentState,
    currentState,
    note: noteResult.note,
    decision: input.decision ? buildDecisionSummary({
      decision: input.decision,
      target: input.target || {},
      reviewer: input.reviewer || {},
      summary: input.summary,
      rationale: input.rationale,
      notes: input.notes,
      scorecard: input.scorecard,
      score: pickScore(input.scorecard),
      externalSync: input.externalSync,
      sourceRunId: input.sourceRunId,
      idempotencyKey: input.idempotencyKey
    }) : null,
    recruitBase: noteResult.recruitBase || recordResult.recruitBase,
    idempotency
  });

  await saveCachedResponse(idempotency, response);
  return response;
}

export async function patchRecruitRecord(moduleApiName, recordId, body) {
  const fields = asPlainObject(body.fields);
  if (Object.keys(fields).length === 0) {
    throw buildError(400, "validation", "PATCH body requires a non-empty fields object");
  }

  const idempotency = buildIdempotencyContext("patch", moduleApiName, recordId, {
    fields,
    sourceRunId: firstNonEmpty(body.sourceRunId, body.source_run_id, null),
    idempotencyKey: firstNonEmpty(body.idempotencyKey, body.idempotency_key, null),
    trigger: normalizeTrigger(body.trigger)
  });
  const cached = await loadCachedResponse(idempotency);
  if (cached) return cached;

  const previousRecordResult = await getRecruitRecord(moduleApiName, recordId);
  const previousState = normalizeRecordState(moduleApiName, previousRecordResult.record);
  await updateRecruitRecord(moduleApiName, recordId, fields, normalizeTrigger(body.trigger));

  const currentRecordResult = await getRecruitRecord(moduleApiName, recordId);
  const currentState = normalizeRecordState(moduleApiName, currentRecordResult.record);
  const response = buildResponse({
    action: "patch",
    moduleApiName,
    recordId,
    previousState,
    currentState,
    recruitBase: currentRecordResult.recruitBase,
    appliedFields: Object.keys(fields),
    idempotency
  });

  await saveCachedResponse(idempotency, response);
  return response;
}
