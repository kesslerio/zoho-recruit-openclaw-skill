# Operations

## Minimum production checklist

- Vercel project linked and deployed
- Vercel KV (Upstash) connected
- OAuth app in Zoho API Console configured as server-based
- Redirect URI set to `/api/oauth/zoho/callback`
- `INTERNAL_API_SECRET` set and stored in a secret manager
- `ZOHO_SCOPE` includes `ZohoRecruit.search.READ` for job-title lookup workflows, `ZohoRecruit.modules.attachments.READ` for candidate attachment/resume workflows, and `ZohoRecruit.modules.notes.ALL` for write-side decision notes/idempotent note lookup

## Troubleshooting

### OAuth consent fails with CRM permission errors
Cause: CRM scopes used with Recruit-only org.
Fix: set `ZOHO_SCOPE` to Recruit scopes, e.g. `ZohoRecruit.modules.ALL,ZohoRecruit.modules.notes.ALL,ZohoRecruit.settings.ALL,ZohoRecruit.search.READ,ZohoRecruit.modules.attachments.READ`.

### Callback returns 500
Common causes:
- Missing `ZOHO_CLIENT_ID` or `ZOHO_CLIENT_SECRET`
- Missing KV env (`KV_REST_API_URL`, `KV_REST_API_TOKEN`)
- Redirect URI mismatch between Zoho console and deployed URL

### Recruit ping unauthorized
Provide secret via query (`?secret=...`) or `x-internal-secret` header.

### Recruit ping fails after successful OAuth
Check Recruit base URL. Default is `https://recruit.zoho.<region>`.
Set `ZOHO_RECRUIT_BASE` if your tenant requires a custom host.

### `/api/recruit/jobs?title=...` returns a scope error
Cause: title lookups use the Recruit search API.
Fix: add `ZohoRecruit.search.READ` to `ZOHO_SCOPE`, reconnect OAuth, then retry.

### Decision or notes endpoint returns a scope error
Cause: write-side workflows need Recruit write access, and note creation/idempotent note lookup are safest with `ZohoRecruit.modules.notes.ALL`.
Fix: add `ZohoRecruit.modules.notes.ALL` to `ZOHO_SCOPE`, reconnect OAuth, then retry. If only field updates are required, the patch endpoint can still work with record write scope alone.

### Applicant or resume endpoint returns `missing_module`
Cause: the OAuth-connected Recruit org is missing the expected Recruit module or the API name differs from the standard module name.
Fix: confirm the org has `Job Openings`, `Candidates`, and optionally `Applications` enabled. If the tenant requires a non-standard base host, set `ZOHO_RECRUIT_BASE`.

### Resume metadata is present but downloads fail
Cause: returned `downloadUrl` values are direct Zoho attachment URLs and still require Zoho OAuth authorization.
Fix: fetch the file with a valid `Zoho-oauthtoken` header or use the metadata as an input to a separate authenticated download workflow.

## Protected endpoints

- `GET /api/recruit/jobs`
- `GET /api/recruit/jobs/:jobId/applicants`
- `GET /api/recruit/candidates/:candidateId`
- `GET /api/recruit/candidates/:candidateId/resume`
- `POST /api/recruit/applications/:applicationId/decision`
- `POST /api/recruit/candidates/:candidateId/decision`
- `POST /api/recruit/applications/:applicationId/notes`
- `POST /api/recruit/candidates/:candidateId/notes`
- `PATCH /api/recruit/applications/:applicationId`

## Write-side assumptions

- `decision` is normalized OpenClaw metadata; tenant-specific Recruit stage/status values must be supplied explicitly or mapped through `ZOHO_RECRUIT_DECISION_FIELD_MAP`.
- Application notes assume the Zoho Recruit tenant exposes the `Notes` API for `Applications` records. If not, use mapped fields and/or candidate notes instead.
- Idempotency is enforced at the bridge layer via KV and caller-provided `idempotencyKey` / `sourceRunId`.
