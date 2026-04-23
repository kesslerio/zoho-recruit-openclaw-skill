---
title: "Restore Zoho Recruit bridge readiness on Vercel and add applicants fallback"
category: "integration-issues"
date: "2026-03-25"
tags:
  - "zoho-recruit"
  - "vercel"
  - "oauth"
  - "upstash-kv"
  - "openclaw"
  - "production-incident"
  - "api-fallback"
repo: "kesslerio/zoho-recruit-openclaw-skill"
status: "resolved"
severity: "high"
pr_numbers:
  - 5
  - 6
commits:
  - "40971f158680e153e05d7780eb0f3b55082fd8fb"
  - "cddd57cdbe1656c6bf4b633bd03955935e4d1445"
components:
  - "api/_lib.js"
  - "api/health.js"
  - "api/oauth/zoho/callback.js"
  - "api/recruit/_write.js"
  - "api/recruit/_shared.js"
  - "api/recruit/_normalize.js"
  - "vercel env"
  - "zoho oauth"
---

# Problem

The Zoho Recruit bridge was deployed in Vercel, but production was not actually usable. It had incomplete environment configuration, no working OAuth bootstrap path, misleading health reporting, and no durable token storage. After those issues were fixed, the applicants route still failed because this Zoho Recruit account rejected the direct `JobOpenings/:id/Candidates` relation path.

# Symptoms

- `/api/health` initially showed only the old minimal response and reported `hasKv: false` and `hasClient: false`
- `/api/oauth/zoho/start` failed with `ZOHO_CLIENT_ID missing` while production was still serving a stale deployment
- Zoho OAuth failed with `Invalid Redirect Uri`
- After the redirect fix, Zoho OAuth failed with `Invalid OAuth Scope`
- Production deployments were stuck in Vercel `INITIALIZING` until manually redeployed
- Before token setup, `readReady: false` and `writeReady: false`
- After the first production fix, `/api/recruit/jobs/:jobId/applicants` still failed live with:
  - type: `recruit_api`
  - code: `INVALID_DATA`
  - message: `the relation name given seems to be invalid`
  - path: `/recruit/v2/JobOpenings/<jobId>/Candidates`

# Root Cause

This was a stack of integration failures rather than one bug.

1. Production had no working Zoho token path.
2. Read-side code assumed KV-backed token storage, so valid Zoho client credentials alone were not enough to make the bridge usable.
3. `/api/health` reflected config presence more than actual token availability.
4. Zoho OAuth was blocked by two external mismatches:
   - the redirect URI configured in Zoho did not exactly match `/api/oauth/zoho/callback`
   - `ZOHO_SCOPE` contained invalid Recruit scopes
5. After auth was fixed, this Zoho Recruit account still rejected `JobOpenings/:id/Candidates` with `INVALID_DATA`.

# Solution

## PR #5: make the bridge bootstrappable and truthful

Merged in `40971f158680e153e05d7780eb0f3b55082fd8fb`.

### Code changes

In [api/_lib.js](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/api/_lib.js):

- `loadTokens()` now falls back from KV to env-backed tokens:
  - `ZOHO_REFRESH_TOKEN`
  - `ZOHO_ACCESS_TOKEN`
  - `ZOHO_ACCESS_TOKEN_EXPIRES_AT`
  - `ZOHO_API_DOMAIN`
- `saveTokens()` persists to KV when available and otherwise keeps tokens in memory for the running process
- KV config is read lazily instead of being fixed at module import time

In [api/health.js](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/api/health.js):

- health became async and checks actual stored token availability
- readiness now reports:
  - `hasRefreshToken`
  - `hasAccessToken`
  - `hasStoredToken`
  - `tokenStorage`
  - `readReady`
  - `writeReady`
  - `tokenLookupError`
  - `missing`

In [api/oauth/zoho/callback.js](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/api/oauth/zoho/callback.js):

- when KV exists, OAuth stores tokens directly in KV
- when KV does not exist, the callback returns:
  - `manualEnv.ZOHO_REFRESH_TOKEN`
  - `manualEnv.ZOHO_API_DOMAIN`
- successful OAuth responses are marked `no-store` / `no-cache`

In [api/recruit/_write.js](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/api/recruit/_write.js):

- write routes now fail explicitly unless KV is configured
- idempotent writes use KV-backed storage

### Production configuration changes

- set real Vercel env vars for Zoho client auth
- corrected Zoho redirect URI to:
  - `https://zoho-recruit-openclaw-skill.vercel.app/api/oauth/zoho/callback`
- replaced the invalid scope set with:
  - `ZohoRecruit.modules.ALL,ZohoRecruit.settings.ALL,ZohoRecruit.search.READ`
- completed one OAuth pass to obtain a refresh token
- stored that refresh token in Vercel production env
- provisioned a fresh Upstash/Vercel KV resource and wired:
  - `KV_REST_API_URL`
  - `KV_REST_API_TOKEN`
  - `ZOHO_TOKEN_KEY`
  - `ZOHO_IDEMPOTENCY_PREFIX`

## PR #6: fix applicants listing for this Zoho account

Merged in `cddd57cdbe1656c6bf4b633bd03955935e4d1445`.

In [api/recruit/_shared.js](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/api/recruit/_shared.js):

- `listJobApplicants()` now treats Zoho `INVALID_DATA` relation failures as fallbackable
- the route now tries:
  1. `JobOpenings/:id/Candidates`
  2. `JobOpenings/:id/associate`
  3. filtered `Applications` listing
- the `Applications` fallback filters by job id and optional candidate status and marks the response with `info.source: "applications_fallback"`

In [api/recruit/_normalize.js](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/api/recruit/_normalize.js):

- `normalizeApplicantRecord()` now falls back to the internal application record id (`record.id`) instead of only external `Application_ID`

## Follow-up gap discovered on 2026-04-22

The March fallback restored applicant listing availability, but it did not fully restore applicant-to-candidate linkage.

- Live `Applications` fallback rows in this tenant can still omit usable `Candidate` / `Candidate_Name` / `Candidate_Id` lookups.
- That means `/api/recruit/jobs/:jobId/applicants` can return rows with `candidateId: null` even though the matching candidate exists.
- Downstream consumers that need `GET /api/recruit/candidates/:candidateId` or `/resume-content` will stop at applicant listing unless the bridge recovers the internal candidate id from exact application contact data.

The corrected bridge behavior is:

- keep the `Applications` fallback for listing availability
- recover `candidateId` from exact candidate search on application `Email`, then `Mobile` / `Phone`, when native lookups are absent
- leave ambiguous or unresolvable rows explicit via `candidateResolution` metadata instead of guessing

# Live Verification

After both PRs were merged and production was redeployed, the following were verified live in production:

- `GET /api/health`
  - `hasKv: true`
  - `hasClient: true`
  - `hasStoredToken: true`
  - `readReady: true`
  - `writeReady: true`
- `GET /api/recruit/ping`
  - returned `ok: true`
- `GET /api/recruit/jobs`
  - returned live Zoho Recruit job data
- `GET /api/recruit/jobs/850051000000560065/applicants`
  - originally failed with `INVALID_DATA`
  - after PR #6 returned `ok: true`, `count: 8`, and `info.source: "applications_fallback"`
- a safe no-op `PATCH /api/recruit/applications/:applicationId`
  - succeeded live
  - sequential replay returned a cached idempotent response

# Prevention

## Lock config drift down

- treat Vercel envs as required infrastructure
- keep [.env.example](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/.env.example) current as the operator contract
- minimum production keys:
  - `ZOHO_CLIENT_ID`
  - `ZOHO_CLIENT_SECRET`
  - `ZOHO_REGION`
  - `ZOHO_SCOPE`
  - `INTERNAL_API_SECRET`
  - `ZOHO_REFRESH_TOKEN` or completed OAuth token storage
- write support additionally requires:
  - `KV_REST_API_URL`
  - `KV_REST_API_TOKEN`
  - `ZOHO_TOKEN_KEY`
  - `ZOHO_IDEMPOTENCY_PREFIX`

## Keep OAuth exact

- use one canonical callback:
  - `https://zoho-recruit-openclaw-skill.vercel.app/api/oauth/zoho/callback`
- keep `ZOHO_SCOPE` minimal and validated against live Zoho behavior
- if OAuth breaks again, inspect the actual redirect emitted by `/api/oauth/zoho/start` before assuming the app code is wrong

## Make health truthful

- read readiness must require:
  - client config present
  - stored token present
- write readiness must require:
  - client config present
  - stored token present
  - KV present

## Prefer graceful degradation

- reads should work from `ZOHO_REFRESH_TOKEN` even without KV
- OAuth callback should return a manual bootstrap payload when KV is absent
- writes should fail explicitly without KV
- Zoho relation endpoints are not reliable across accounts, so fallback logic is necessary

# Safe Smoke Tests

## Read-side

1. `GET /api/health`
2. `GET /api/recruit/ping`
3. `GET /api/recruit/jobs`
4. `GET /api/recruit/jobs/:jobId/applicants`

## Write-side

- use a no-op patch against a real application with current field values
- include an explicit idempotency key
- replay the exact same request after the first response is cached

# Residual Risk

The current idempotency implementation was proven for sequential replay, not for truly concurrent duplicate writes. Two simultaneous identical write requests can still race before the first cached response is written.

# Related Files

- [README.md](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/README.md)
- [SKILL.md](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/SKILL.md)
- [operations.md](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/references/operations.md)
- [.env.example](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/.env.example)

# Follow-Up

`ce:compound-refresh` is warranted for the Zoho Recruit setup docs because the live-verified scope guidance and applicants fallback behavior should stay aligned across:

- [README.md](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/README.md)
- [SKILL.md](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/SKILL.md)
- [operations.md](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/references/operations.md)
- [.env.example](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/.env.example)
