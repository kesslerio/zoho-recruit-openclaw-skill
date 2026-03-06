---
name: zoho-recruit-openclaw-skill
description: Connect OpenClaw to Zoho Recruit via OAuth and API endpoints. Use when setting up Zoho Recruit authentication, storing refresh/access tokens in Vercel KV, checking Recruit API reachability/connectivity, listing job openings/candidates, or building applicant sync automations (e.g., Indeed -> Zoho Recruit).
---

# Zoho Recruit OpenClaw Skill

Deploy and run a minimal OAuth + API bridge for Zoho Recruit.

## Configure

Set these environment variables in Vercel:

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REGION` (`com`, `eu`, `in`, ...)
- `ZOHO_SCOPE` (default recommended: `ZohoRecruit.modules.ALL,ZohoRecruit.modules.notes.ALL,ZohoRecruit.settings.ALL,ZohoRecruit.search.READ,ZohoRecruit.modules.attachments.READ`)
- `INTERNAL_API_SECRET`

Optional:

- `ZOHO_RECRUIT_BASE` (override Recruit API host)
- `ZOHO_REDIRECT_URI` (if you want a custom callback URL)
- `ZOHO_TOKEN_KEY` (defaults to `zoho:tokens`)
- `ZOHO_RECRUIT_DECISION_FIELD_MAP` (maps normalized decision metadata into tenant-specific Recruit fields)

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
- `GET /api/recruit/jobs` — lists job openings or finds one by `id` / exact `title` (protected)
- `GET /api/recruit/jobs/:jobId/applicants` — lists associated applicants/candidates for a job opening (protected)
- `GET /api/recruit/candidates/:candidateId` — returns normalized candidate detail and optional application/job context (protected)
- `GET /api/recruit/candidates/:candidateId/resume` — returns attachment metadata and resume-oriented download URLs (protected)
- `POST /api/recruit/applications/:applicationId/decision` — updates application state and writes decision notes (protected)
- `POST /api/recruit/candidates/:candidateId/decision` — updates candidate state and writes decision notes (protected)
- `POST /api/recruit/applications/:applicationId/notes` — writes recruiter notes/comments onto an application (protected)
- `POST /api/recruit/candidates/:candidateId/notes` — writes recruiter notes/comments onto a candidate (protected)
- `PATCH /api/recruit/applications/:applicationId` — applies explicit application field updates (protected)

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
3. Call `/api/recruit/jobs` with secret.
4. Call a write-side endpoint with an explicit `idempotencyKey` or `sourceRunId`.
5. Confirm `ok: true`.

## Workflow notes

- Job title lookups use the Recruit search API, so `ZohoRecruit.search.READ` must be in `ZOHO_SCOPE`.
- Attachment-backed candidate/resume flows require `ZohoRecruit.modules.attachments.READ`.
- Write-side note workflows are safest with `ZohoRecruit.modules.notes.ALL`.
- Candidate detail responses include a normalized `reviewPayload` for scoring/rubric workflows.
- Resume endpoint responses merge candidate attachments and optional application attachments when `applicationId` is provided.
- Zoho attachment `downloadUrl` values require Zoho OAuth authorization when fetched directly.
- Decision writes are idempotent when callers provide `idempotencyKey` or `sourceRunId`; the same key with a different payload is rejected.
- Decision enums are normalized (`approve`, `reject`, `disqualify`, `advance`, `hold`), but tenant-specific stage/status values must still be supplied explicitly or mapped via `ZOHO_RECRUIT_DECISION_FIELD_MAP`.

For operations and troubleshooting, see [references/operations.md](references/operations.md).
