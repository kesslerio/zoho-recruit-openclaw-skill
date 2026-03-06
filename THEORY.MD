# Theory: Recruit Write-Side Triage API Surface

## Problem

PR #2 made Zoho Recruit readable enough for screening, but it still left OpenClaw stuck at the last mile: humans or browser automation had to translate a review outcome into Recruit state. That is the structural gap for issue #3. A triage system is only useful when it can turn a scored recommendation into durable Recruit-side actions with enough audit context for recruiters, CRM sync, and retries.

The difficulty is not the mechanics of one `PUT` request. The hard part is making write-side behavior predictable across reruns, token expiry, tenant-specific Recruit fields, and slightly different caller payload shapes. A naive implementation would update some status field, append duplicate notes on every retry, and then return raw Zoho payloads that downstream systems still have to interpret. That does not operationalize anything; it just moves the ambiguity from the UI into the API.

## Operating Theory

The correct leverage point remains the shared Recruit client layer. Read-side work already proved that KV-backed OAuth tokens, host selection, and error normalization belong in one place. Write-side workflows should build on that same base rather than inventing a second client. If the shared Recruit request helper can send JSON request bodies with the same auth/refresh/error guarantees as reads, then write routes can stay thin and deterministic.

The write model has two distinct responsibilities. First, it must mutate Recruit records in tenant-safe ways: explicit stage/status updates, optional mapped field writes, and notes as the fallback audit channel when fields are not standardized. Second, it must normalize the result back into a stable OpenClaw response that tells downstream systems what changed, what note ids were created, and what current Recruit state now exists. Those are separate concerns, and treating them separately keeps the API small.

Idempotency is the real design constraint. Recruit itself is not going to give this bridge exactly-once semantics for compound actions like “update record and add note.” The practical solution is bridge-level idempotency keyed by caller-provided `idempotencyKey` or `sourceRunId`, backed by KV. That prevents ordinary repeated agent runs from replaying the same action. For note creation specifically, a second guard helps: embed an OpenClaw idempotency marker in the note content and scan recent notes before creating another one. That does not make cross-system retries magically transactional, but it meaningfully reduces duplicate side effects in the failure mode that matters here.

A newer part of the theory is that the transport boundary also needs normalization. Even if the contract is documented as JSON, real callers will mix camelCase and snake_case fields or pass booleans and triggers in slightly different shapes. The write helper should therefore be strict about the semantics it owns (`decision` enum, idempotency conflicts, required fields) but tolerant about superficial input encoding where that reduces avoidable retries.

## Strategy

The smallest robust implementation is a narrow write helper module plus five routes. The helper owns decision payload validation, configured field mapping, note formatting, idempotency caching, and response normalization for applications and candidates. The routes should do almost nothing beyond secret enforcement, method checks, body parsing, and selecting the right Recruit module.

The API contract should stay opinionated where OpenClaw needs stability and conservative where Zoho tenants differ. The decision enum is normalized and fixed: `approve`, `reject`, `disqualify`, `advance`, `hold`. But the bridge should not pretend those values map cleanly onto every tenant’s status pipeline. Actual Recruit stage/status changes therefore come only from explicit targets or configured field mappings. When field names differ, the operator can supply `ZOHO_RECRUIT_DECISION_FIELD_MAP`; when they do not, standard Recruit fields still work.

Notes are the default audit trail because they survive tenant variance better than custom fields. A decision write should therefore create a note unless the caller explicitly disables it. The note content should be human-readable first and machine-traceable second: decision, target state, reviewer, score, summary, sync metadata, and embedded idempotency/source-run markers.

## Key Discoveries

The read-side shared client was already close to what write-side needed; the actual missing primitive was JSON request-body support in `recruitRequest`. Once that exists, record updates and note creation can reuse the same auth refresh and Zoho error handling instead of opening another code path with different failure behavior.

A more important discovery is that idempotency cannot be solved only by “cache the final response.” That handles successful retries, but it does not help if a note was created and the request failed before the bridge persisted the cached result. Embedding the idempotency key into the note body and checking recent notes before writing another one is the right defensive compromise for this repo’s size and constraints.

Another pivot is around semantics: initially it is tempting to make `approve` or `advance` automatically choose a Recruit stage. That is brittle and wrong for a configurable ATS. The stronger theory is that the bridge should normalize the decision vocabulary while refusing to guess tenant-specific pipeline values. That keeps the API portable and forces the only unstable part—the tenant mapping—into configuration or explicit request fields.

The latest discovery is smaller but real: write-side breakage is just as likely to come from payload-shape drift as from Zoho itself. Supporting `snake_case` aliases, string booleans such as `"false"`, and comma-delimited trigger lists costs little and avoids turning harmless caller variance into extra writes or duplicate retries.

## Open Questions

Zoho Recruit tenant variance is still the biggest uncertainty. Some orgs may not expose notes on `Applications` the same way others do, and some may require custom field API names for stage-like concepts. The current design handles that by keeping note support explicit, by allowing mapped fields, and by returning normalized state plus raw Recruit-derived identifiers rather than pretending the schema is uniform.

The remaining unanswered question is whether downstream systems will eventually want stronger workflow primitives than “update fields + write note,” such as interview scheduling, ownership reassignment, or Recruit-native review records. If that happens, this issue’s helper layer is still the right starting point because it centralizes the only hard parts: auth, idempotency, and normalization.
