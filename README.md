# zoho-recruit-openclaw-skill

Generic Zoho Recruit OAuth + API bridge for OpenClaw workflows.

## What this repo provides

- OAuth start + callback flow for Zoho Recruit
- Token persistence in Vercel KV (Upstash)
- Protected token/refresh endpoints
- Recruit connectivity probe endpoint (`/api/recruit/ping`)
- Recruit jobs, applicants, candidate detail, and resume metadata endpoints
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

Query notes:

- `GET /api/recruit/jobs?id=<jobId>` fetches one job opening by id.
- `GET /api/recruit/jobs?title=<exact title>` looks up job openings by exact title.
- `GET /api/recruit/jobs/:jobId/applicants?page=1&perPage=50` lists associated candidates/applicants.
- `GET /api/recruit/candidates/:candidateId?applicationId=<applicationId>&jobId=<jobId>` adds optional application/job context.
- `GET /api/recruit/candidates/:candidateId/resume?applicationId=<applicationId>` returns candidate attachments plus optional application attachments.

Protected endpoints require:
- query: `?secret=<INTERNAL_API_SECRET>`
- or header: `x-internal-secret: <INTERNAL_API_SECRET>`

## Required environment variables

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REGION` (`com`, `eu`, `in`, ...)
- `ZOHO_SCOPE` (recommended: `ZohoRecruit.modules.ALL,ZohoRecruit.settings.ALL,ZohoRecruit.search.READ,ZohoRecruit.modules.attachments.READ`)
- `INTERNAL_API_SECRET`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Optional:
- `ZOHO_RECRUIT_BASE`
- `ZOHO_REDIRECT_URI`
- `ZOHO_TOKEN_KEY` (default: `zoho:tokens`)

## Deploy (Vercel)

```bash
vercel link
vercel deploy --prod
```

Set Zoho API Console redirect URI to:

`https://<your-domain>/api/oauth/zoho/callback`

## Security notes

- Do not commit secrets.
- Keep `INTERNAL_API_SECRET` in a proper secret manager (1Password/Vercel env).
- Rotate secrets if ever shared in plaintext.

## Recruit API behavior notes

- Access tokens are loaded from KV and auto-refreshed before expiry.
- Recruit errors are normalized into clear JSON types such as `auth`, `scope`, `missing_module`, and `not_found`.
- Resume responses expose attachment metadata and direct Zoho download URLs when Zoho returns attachment ids. Downloading those URLs still requires a valid Zoho OAuth token.
- Title lookup uses the Recruit search API. If `ZohoRecruit.search.READ` is missing, the endpoint returns a scope error instead of silently scanning partial job pages. Candidate detail responses with attachments and the resume endpoint also require `ZohoRecruit.modules.attachments.READ`; after changing scopes, reconnect OAuth before retrying.
- Zoho field names vary across tenants. The normalized payloads prefer standard Recruit fields and keep the candidate detail endpoint’s raw record payload for debugging tenant-specific mappings.
