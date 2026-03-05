---
name: zoho-recruit-openclaw-skill
description: Connect OpenClaw to Zoho Recruit via OAuth and API endpoints. Use when setting up Zoho Recruit authentication, storing refresh/access tokens in Vercel KV, testing Recruit API connectivity, listing job openings/candidates, or building applicant sync automations (e.g., Indeed -> Zoho Recruit).
---

# Zoho Recruit OpenClaw Skill

Deploy and run a minimal OAuth + API bridge for Zoho Recruit.

## Configure

Set these environment variables in Vercel:

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REGION` (`com`, `eu`, `in`, ...)
- `ZOHO_SCOPE` (default recommended: `ZohoRecruit.modules.ALL,ZohoRecruit.settings.ALL`)
- `INTERNAL_API_SECRET`

Optional:

- `ZOHO_RECRUIT_BASE` (override Recruit API host)
- `ZOHO_REDIRECT_URI` (if you want a custom callback URL)
- `ZOHO_TOKEN_KEY` (defaults to `zoho:tokens`)

Also connect Vercel KV / Upstash and ensure these are present:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

## Endpoints

- `GET /api/health` — service/env sanity check
- `GET /api/oauth/zoho/start` — starts OAuth consent flow
- `GET /api/oauth/zoho/callback` — receives Zoho code, stores tokens
- `GET /api/token` — returns stored token data (protected)
- `GET /api/refresh` — refreshes access token from refresh token (protected)
- `GET /api/recruit/ping` — validates Recruit API reachability (protected)

Protected endpoints require either:

- query: `?secret=<INTERNAL_API_SECRET>`
- header: `x-internal-secret: <INTERNAL_API_SECRET>`

## Deploy

```bash
vercel link
vercel deploy --prod
```

Use this callback URL in Zoho API Console:

`https://<your-domain>/api/oauth/zoho/callback`

## Verify

1. Open `/api/oauth/zoho/start` and complete consent.
2. Call `/api/recruit/ping` with secret.
3. Confirm `ok: true`.
