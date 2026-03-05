# zoho-recruit-openclaw-skill

Generic Zoho Recruit OAuth + API bridge for OpenClaw workflows.

## What this repo provides

- OAuth start + callback flow for Zoho Recruit
- Token persistence in Vercel KV (Upstash)
- Protected token/refresh endpoints
- Recruit connectivity probe endpoint (`/api/recruit/ping`)
- OpenClaw `SKILL.md` for skill-level usage

## Endpoints

- `GET /api/health`
- `GET /api/oauth/zoho/start`
- `GET /api/oauth/zoho/callback`
- `GET /api/token` (protected)
- `GET /api/refresh` (protected)
- `GET /api/recruit/ping` (protected)

Protected endpoints require:
- query: `?secret=<INTERNAL_API_SECRET>`
- or header: `x-internal-secret: <INTERNAL_API_SECRET>`

## Required environment variables

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REGION` (`com`, `eu`, `in`, ...)
- `ZOHO_SCOPE` (recommended: `ZohoRecruit.modules.ALL,ZohoRecruit.settings.ALL`)
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
