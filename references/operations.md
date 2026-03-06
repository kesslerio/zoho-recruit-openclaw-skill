# Operations

## Minimum production checklist

- Vercel project linked and deployed
- Vercel KV (Upstash) connected
- OAuth app in Zoho API Console configured as server-based
- Redirect URI set to `/api/oauth/zoho/callback`
- `INTERNAL_API_SECRET` set and stored in a secret manager
- `ZOHO_SCOPE` includes `ZohoRecruit.search.READ` for job-title lookup workflows and `ZohoRecruit.modules.attachments.READ` for candidate attachment/resume workflows

## Troubleshooting

### OAuth consent fails with CRM permission errors
Cause: CRM scopes used with Recruit-only org.
Fix: set `ZOHO_SCOPE` to Recruit scopes, e.g. `ZohoRecruit.modules.ALL,ZohoRecruit.settings.ALL,ZohoRecruit.search.READ,ZohoRecruit.modules.attachments.READ`.

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

### Applicant or resume endpoint returns `missing_module`
Cause: the OAuth-connected Recruit org is missing the expected Recruit module or the API name differs from the standard module name.
Fix: confirm the org has `Job Openings`, `Candidates`, and optionally `Applications` enabled. If the tenant requires a non-standard base host, set `ZOHO_RECRUIT_BASE`.

### Resume metadata is present but downloads fail
Cause: returned `downloadUrl` values are direct Zoho attachment URLs and still require Zoho OAuth authorization.
Fix: fetch the file with a valid `Zoho-oauthtoken` header or use the metadata as an input to a separate authenticated download workflow.

## New protected endpoints

- `GET /api/recruit/jobs`
- `GET /api/recruit/jobs/:jobId/applicants`
- `GET /api/recruit/candidates/:candidateId`
- `GET /api/recruit/candidates/:candidateId/resume`
