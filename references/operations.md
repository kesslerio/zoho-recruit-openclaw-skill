# Operations

## Minimum production checklist

- Vercel project linked and deployed
- Vercel KV (Upstash) connected
- OAuth app in Zoho API Console configured as server-based
- Redirect URI set to `/api/oauth/zoho/callback`
- `INTERNAL_API_SECRET` set and stored in a secret manager

## Troubleshooting

### OAuth consent fails with CRM permission errors
Cause: CRM scopes used with Recruit-only org.
Fix: set `ZOHO_SCOPE` to Recruit scopes, e.g. `ZohoRecruit.modules.ALL,ZohoRecruit.settings.ALL`.

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
