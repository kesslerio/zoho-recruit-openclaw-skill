---
title: "Restore Zoho Recruit bridge readiness on Vercel and add applicants fallback"
category: "integration-issues"
date: "2026-03-25"
last_updated: "2026-04-23"
tags:
  - "zoho-recruit"
  - "vercel"
  - "oauth"
  - "upstash-kv"
  - "openclaw"
  - "production-incident"
  - "api-fallback"
  - "candidate-resolution"
  - "application-lifecycle"
repo: "kesslerio/zoho-recruit-openclaw-skill"
status: "resolved"
severity: "high"
pr_numbers:
  - 5
  - 6
  - 9
  - 10
commits:
  - "40971f158680e153e05d7780eb0f3b55082fd8fb"
  - "cddd57cdbe1656c6bf4b633bd03955935e4d1445"
  - "73e4ed907eb3180be13a38d3af6f4aab2db140f6"
  - "9a49582406f48e4ef899aad8f98e3eae286d2e0e"
components:
  - "api/_lib.js"
  - "api/health.js"
  - "api/oauth/zoho/callback.js"
  - "api/recruit/_write.js"
  - "api/recruit/_shared.js"
  - "api/recruit/_normalize.js"
  - "scripts/lib/normalize.mjs"
  - "scripts/lib/attio.mjs"
  - "vercel env"
  - "zoho oauth"
---

# Problem

The Zoho Recruit bridge was deployed in Vercel, but production was not actually usable. It had incomplete environment configuration, no working OAuth bootstrap path, misleading health reporting, and no durable token storage. After those issues were fixed, the applicants route still failed because this Zoho Recruit account rejected the direct `JobOpenings/:id/Candidates` relation path.

That March recovery was still incomplete. In April, live recruiting smoke tests showed that the `Applications` fallback restored listing availability but not the full downstream contract:

- resume parsing only worked when a real `candidateId` was supplied manually
- fallback applicants could still lose `candidateId`
- questionnaire-based screening in `zoho-attio-recruit-triage` could not fire live because this tenant does not store those questionnaire answers on `Applications` or `Candidates`
- the only reliable live screening signal was application lifecycle state such as `Application_Status=Unqualified` and `Hiring_Pipeline=Rejected`

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
- After the `Applications` fallback shipped, live resume parsing worked only when a real `candidateId` was provided separately
- Live `/api/recruit/jobs/850051000000560065/applicants` originally returned fallback rows with `candidateId: null`, which blocked automatic candidate enrichment and resume parsing
- A live dry-run against `zoho-attio-recruit-triage` returned `advance: 0`, `discuss: 6`, `pass: 2`, `screenedOut: 0` even though Benjamin Bennett and Matthew David were already rejected in Zoho
- Live field metadata showed `Applications` had `36` fields and `Candidates` had `52` fields, with no questionnaire custom fields available on either module
- Candidate detail still exposed application lifecycle state (`Application_Status=Unqualified`, `Hiring_Pipeline=Rejected`), but downstream normalization flattened that away and treated those applicants as generic `New` candidates

# Root Cause

This was a stack of integration failures rather than one bug.

1. Production had no working Zoho token path.
2. Read-side code assumed KV-backed token storage, so valid Zoho client credentials alone were not enough to make the bridge usable.
3. `/api/health` reflected config presence more than actual token availability.
4. Zoho OAuth was blocked by two external mismatches:
   - the redirect URI configured in Zoho did not exactly match `/api/oauth/zoho/callback`
   - `ZOHO_SCOPE` contained invalid Recruit scopes
5. After auth was fixed, this Zoho Recruit account still rejected `JobOpenings/:id/Candidates` with `INVALID_DATA`.
6. The `Applications` fallback restored list availability, but the bridge still under-modeled what downstream consumers needed:
   - fallback rows could omit native candidate lookups, so `candidateId` was lost until the bridge recovered it by exact candidate search
   - normalized applicant payloads did not preserve `Hiring_Pipeline` on the application object or `reviewPayload`
7. The triage side initially assumed live questionnaire answers would exist on Zoho application records, but this tenant does not store them there. The real live screening signal was application lifecycle state, not questionnaire fields.
8. Candidate-level status (`New`) could override application-level rejection state (`Unqualified` / `Rejected`) if the bridge and triage code did not explicitly prefer application lifecycle fields.

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

## PR #9: recover fallback candidate ids for downstream resume parsing

Merged in `73e4ed907eb3180be13a38d3af6f4aab2db140f6`.

In [api/recruit/_shared.js](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/api/recruit/_shared.js):

- fallback applicants now recover internal `candidateId` values by exact candidate search on application `Email`, then `Mobile` and `Phone`
- duplicate lookups are cached per request so repeated applicant rows do not cause redundant candidate searches
- ambiguous and failed matches stay explicit in `candidateResolution` metadata instead of being guessed
- recoverable search failures degrade to unresolved applicants instead of failing the whole endpoint

This closed the candidate-id handoff gap that had blocked live resume parsing from the fallback applicants path.

## PR #10: preserve application lifecycle state as part of the bridge contract

Merged in `9a49582406f48e4ef899aad8f98e3eae286d2e0e`.

In [api/recruit/_normalize.js](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/api/recruit/_normalize.js):

- `normalizeApplicationRecord()` now maps lifecycle stage from `Stage`, `Pipeline_Stage`, `Hiring_Pipeline`, and `Application_Stage`
- `normalizeApplicantRecord()` now preserves the normalized `application` object on fallback applicants instead of dropping it
- candidate `reviewPayload` now carries application `status`, `stage`, and `source`, so downstream consumers do not have to infer lifecycle state from raw Zoho records

This made application lifecycle state an explicit read-side contract rather than an accidental raw-field leak.

## Cross-repo follow-up: use application lifecycle state when questionnaire fields are absent

The bridge fix above only mattered because the downstream sync had a second incorrect assumption.

Issue: [zoho-attio-recruit-triage#6](https://github.com/kesslerio/zoho-attio-recruit-triage/issues/6) started as a questionnaire-sync bug. Live investigation showed the tenant did not expose questionnaire answers on `Applications` or `Candidates`, so exact questionnaire screening could not work in production even after the config-driven questionnaire feature merged.

Merged in `kesslerio/zoho-attio-recruit-triage`:

- PR #10 (`bc15c06dce5f26c4b842f8eff2fc97979ef18908`) added the config-driven questionnaire normalization path
- PR #11 (`a3e223f989c7665e982ee529a68573d2164f0d84`) added the live fallback:
  - prefer application lifecycle state over generic candidate status
  - mark applicants screened out when application status/stage is clearly rejected or unqualified
  - write a compact `Screening outcome: ...` note when questionnaire answers are absent

That is the durable lesson for this stack: exact questionnaire syncing is optional per tenant, but preserving application lifecycle state is mandatory.

# Live Verification

After both March PRs were merged and production was redeployed, the following were verified live in production:

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

Additional April verification:

- Hosted bridge resume smoke after PR #9:
  - `GET /api/recruit/jobs/850051000000560065/applicants` returned fallback data for application `850051000000588062`
  - the bridge recovered candidate `850051000000588003`
  - `GET /api/recruit/candidates/850051000000588003/resume-content?applicationId=850051000000588062` returned the real application PDF
  - local parsing succeeded with `parser: "pdf"` and `textLength: 3249`
- Live tenant investigation before the lifecycle fix:
  - the exact questionnaire path did not fire because `Applications` and `Candidates` metadata exposed no questionnaire custom fields
  - Benjamin Bennett and Matthew David still appeared as active `Screening` candidates
  - candidate detail for both still carried `Application_Status=Unqualified`
- Live dry-run against the patched triage code after the lifecycle fix:
  - batch size `8`
  - `summary.screenedOut = 2`
  - Benjamin Bennett and Matthew David both resolved to `status = Passed` and `interviewStage = Passed`

The important distinction is that resume parsing proof came from the hosted bridge after candidate-id recovery, while the lifecycle-screening proof came from patched local code reading live Zoho data. At the time this learning was updated, the bridge lifecycle patch was merged but still needed deployment for hosted `sourceStage` fidelity.

# What Didn't Work

- Assuming the March `Applications` fallback was sufficient once applicant listing came back. It restored availability, not downstream correctness.
- Assuming the triage questionnaire feature would solve live screening by itself. That path depended on fields this tenant does not actually expose.
- Trusting candidate-level status (`New`) more than application-level rejection state. That erased the only live signal that mattered.

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
- `Applications` fallback rows must be treated as a contract surface, not as a temporary compatibility hack. If downstream code needs `candidateId`, application status, or application stage, the bridge should preserve them explicitly.

## Prefer live-verified signals over planned fields

- before building tenant-specific logic around questionnaire answers, verify that those fields actually exist in live Zoho metadata
- when a tenant does not expose questionnaire answers on `Applications` or `Candidates`, treat application lifecycle state as the required fallback signal
- do not let generic candidate status overwrite application lifecycle status during enrichment
- keep regression tests for both:
  - fallback candidate-id recovery
  - lifecycle-screened applicants that must become `Passed` downstream

# Safe Smoke Tests

## Read-side

1. `GET /api/health`
2. `GET /api/recruit/ping`
3. `GET /api/recruit/jobs`
4. `GET /api/recruit/jobs/:jobId/applicants`
   - verify `info.source === "applications_fallback"` when direct relations fail
   - verify fallback applicants expose `candidateResolution`
   - verify fallback applicants expose `application.status` and `application.stage` when Zoho supplies them

## Resume path

1. `GET /api/recruit/jobs/:jobId/applicants`
2. pick a fallback applicant with recovered `candidateId`
3. `GET /api/recruit/candidates/:candidateId/resume-content?applicationId=<applicationId>`
4. verify the returned bytes parse as a real PDF or DOCX and produce non-empty text

## Write-side

- use a no-op patch against a real application with current field values
- include an explicit idempotency key
- replay the exact same request after the first response is cached

# Residual Risk

- The current idempotency implementation was proven for sequential replay, not for truly concurrent duplicate writes. Two simultaneous identical write requests can still race before the first cached response is written.
- Fallback applicants can still remain unresolved when candidate search is ambiguous or the tenant lacks usable contact data. That ambiguity should stay explicit via `candidateResolution`, not be guessed away.
- Exact questionnaire syncing is still tenant-dependent. If the tenant later adds custom questionnaire fields, the triage config can use them, but lifecycle fallback should remain in place.

# Related Files

- [README.md](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/README.md)
- [SKILL.md](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/SKILL.md)
- [operations.md](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/references/operations.md)
- [.env.example](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/.env.example)
- [zoho-attio-recruit-triage issue #6](https://github.com/kesslerio/zoho-attio-recruit-triage/issues/6)
- [zoho-attio-recruit-triage PR #11](https://github.com/kesslerio/zoho-attio-recruit-triage/pull/11)

# Follow-Up

`ce:compound-refresh` is warranted for the Zoho Recruit setup docs because the live-verified scope guidance and applicants fallback behavior should stay aligned across:

- [README.md](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/README.md)
- [SKILL.md](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/SKILL.md)
- [operations.md](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/references/operations.md)
- [.env.example](/home/art/projects/skills/work/zoho-recruit-openclaw-skill/.env.example)
