# zoho-recruit-openclaw-skill

Generic Zoho Recruit OAuth + API bridge for OpenClaw workflows.

## What this repo provides

- OAuth start + callback flow for Zoho Recruit
- Token persistence in Vercel KV (Upstash) or read-side fallback via `ZOHO_REFRESH_TOKEN`
- Protected token/refresh endpoints
- Recruit connectivity probe endpoint (`/api/recruit/ping`)
- Recruit read-side endpoints for jobs, applicants, candidate detail, and resume metadata
- Recruit write-side endpoints for triage decisions, recruiter notes, and application patching
- OpenClaw `SKILL.md` for skill-level usage

## Endpoints

- `GET /api/health`
- `GET /api/oauth/zoho/start`
- `GET /api/oauth/zoho/callback`
- `GET /api/token` (protected)
- `GET /api/refresh` (protected)
- `GET /api/recruit/ping` (protected)
- `GET /api/recruit/jobs` (protected)
- `GET /api/recruit/jobs/:jobId/applicants` (protected)
- `GET /api/recruit/candidates/:candidateId` (protected)
- `GET /api/recruit/candidates/:candidateId/resume` (protected)
- `POST /api/recruit/applications/:applicationId/decision` (protected)
- `POST /api/recruit/candidates/:candidateId/decision` (protected)
- `POST /api/recruit/applications/:applicationId/notes` (protected)
- `POST /api/recruit/candidates/:candidateId/notes` (protected)
- `PATCH /api/recruit/applications/:applicationId` (protected)

Query and payload notes:

- `GET /api/recruit/jobs?id=<jobId>` fetches one job opening by id.
- `GET /api/recruit/jobs?title=<exact title>` looks up job openings by exact title.
- `GET /api/recruit/jobs/:jobId/applicants?page=1&perPage=50` lists associated candidates/applicants.
- `GET /api/recruit/candidates/:candidateId?applicationId=<applicationId>&jobId=<jobId>` adds optional application/job context.
- `GET /api/recruit/candidates/:candidateId/resume?applicationId=<applicationId>` returns candidate attachments plus optional application attachments.
- Decision endpoints accept `decision`, optional `target.stage` / `target.status`, reviewer metadata, scorecards, rationale, external sync metadata, and `idempotencyKey` / `sourceRunId`.
- Note endpoints accept plain `content` or the same structured review metadata used by decision writes.
- The application patch endpoint accepts `{ "fields": { ... } }` plus optional `trigger`, `idempotencyKey`, and `sourceRunId`.

Protected endpoints require:
- query: `?secret=<INTERNAL_API_SECRET>`
- or header: `x-internal-secret: <INTERNAL_API_SECRET>`

## Required environment variables

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REGION` (`com`, `eu`, `in`, ...)
- `ZOHO_SCOPE` (recommended: `ZohoRecruit.modules.ALL,ZohoRecruit.modules.notes.ALL,ZohoRecruit.settings.ALL,ZohoRecruit.search.READ,ZohoRecruit.modules.attachments.READ`)
- `INTERNAL_API_SECRET`
- `ZOHO_REFRESH_TOKEN` or both `KV_REST_API_URL` and `KV_REST_API_TOKEN`

Optional:
- `ZOHO_API_DOMAIN`
- `ZOHO_RECRUIT_BASE`
- `ZOHO_REDIRECT_URI`
- `ZOHO_TOKEN_KEY` (default: `zoho:tokens`)
- `ZOHO_RECRUIT_DECISION_FIELD_MAP` (JSON object mapping normalized decision metadata into tenant-specific Recruit fields)

Notes:
- Read-only endpoints (`/api/recruit/ping`, jobs, applicants, candidate detail, resume metadata) work with `ZOHO_REFRESH_TOKEN` even if KV is absent.
- Write-side endpoints still require KV because durable idempotency state is part of the safety contract.
- `/api/health` now reports `readReady`, `writeReady`, `hasRefreshToken`, and `tokenStorage` to make setup gaps explicit.

## Deploy (Vercel)

```bash
vercel link
vercel deploy --prod
```

Set Zoho API Console redirect URI to:

`https://<your-domain>/api/oauth/zoho/callback`

If KV is not configured, the OAuth callback returns `manualEnv.ZOHO_REFRESH_TOKEN`. Store that value in Vercel as `ZOHO_REFRESH_TOKEN`, redeploy, and the read-side endpoints can run without KV.

## Security notes

- Do not commit secrets.
- Keep `INTERNAL_API_SECRET` in a proper secret manager (1Password/Vercel env).
- Rotate secrets if ever shared in plaintext.
- If the OAuth callback returns a refresh token in `manualEnv`, treat it like a password and move it into Vercel env immediately.

## Write-side behavior notes

- Access tokens are loaded from KV when present, otherwise refreshed from `ZOHO_REFRESH_TOKEN` and cached only in memory for the current runtime instance.
- Recruit errors are normalized into clear JSON types such as `auth`, `scope`, `missing_module`, `not_found`, and `idempotency_conflict`.
- Decision endpoints treat `decision` as normalized audit metadata. Actual Recruit stage/status changes come from explicit `target.stage` / `target.status`, extra `fieldValues`, or `ZOHO_RECRUIT_DECISION_FIELD_MAP`; the API does not guess tenant-specific stage names.
- Decision, note, and patch endpoints support request-level idempotency keyed by `idempotencyKey` or `sourceRunId`. Reusing the same key with a different payload returns `409 idempotency_conflict`.
- Decision endpoints write a Recruit note by default so downstream CRM sync and audit logging have a durable human-readable trail.
- Decision and note writes include OpenClaw idempotency/source-run markers in note content and try to reuse a matching recent note before creating another one.
- Write-side endpoints return a config error when KV is missing instead of pretending idempotency still exists.
- Resume responses expose attachment metadata and direct Zoho download URLs when Zoho returns attachment ids. Downloading those URLs still requires a valid Zoho OAuth token.
- Title lookup uses the Recruit search API. Candidate detail responses with attachments and the resume endpoint also require `ZohoRecruit.modules.attachments.READ`; note workflows are safest with `ZohoRecruit.modules.notes.ALL`. After changing scopes, reconnect OAuth before retrying.
- Zoho field names vary across tenants. The normalized payloads prefer standard Recruit fields and let operators map custom fields through `ZOHO_RECRUIT_DECISION_FIELD_MAP` rather than baking tenant assumptions into the routes.
- Notes APIs assume the Recruit `Notes` module is available for the target record type. If your tenant does not expose notes for `Applications`, use mapped fields and/or candidate notes instead.

## Decision payload example

```json
{
  "decision": "advance",
  "target": {
    "stage": "Hiring Manager Screen",
    "status": "Under Review"
  },
  "reviewer": {
    "id": "usr_123",
    "name": "OpenClaw"
  },
  "scorecard": {
    "overallScore": 8.7,
    "summary": "Strong backend systems signal"
  },
  "summary": "Advance to hiring manager screen",
  "rationale": "Strong Ruby and API design depth",
  "externalSync": {
    "attioRecordId": "rec_attio_123"
  },
  "fieldValues": {
    "OpenClaw_Last_Action": "advance"
  },
  "sourceRunId": "run_2026_03_06_001"
}
```

## Patch payload example

```json
{
  "fields": {
    "Application_Status": "On Hold",
    "Stage": "Awaiting Recruiter Review"
  },
  "idempotencyKey": "hold-application-123"
}
```

## Response shape highlights

- Stable resource identifiers (`applicationId`, `candidateId`, `jobOpeningId` where available)
- `previousState`, `currentState`, and `stateChange`
- `created.noteIds` / `created.reviewIds`
- Normalized `decision` summary and idempotency metadata
- Enough record state for downstream CRM sync and audit pipelines
