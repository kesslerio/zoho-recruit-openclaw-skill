# Theory: Recruit Applicant Review API Surface

## Problem

This repo already proves that Zoho Recruit OAuth works and that protected serverless endpoints can reach the Recruit API. That is not enough for applicant review workflows. A browser-driven reviewer can click around Recruit, but any scoring or rubric pipeline needs stable, API-first JSON that is insulated from token expiry, region quirks, and Zoho’s inconsistent field shapes. The missing capability is not just “more endpoints”; it is a small normalization layer that converts Recruit records into predictable review payloads without dragging browser automation into the architecture.

## Operating Theory

The leverage point in this codebase is `api/_lib.js`. All existing endpoints already depend on shared helpers for JSON responses, KV token storage, secret enforcement, and Zoho host selection. If Recruit API calls, token refresh, and Zoho error normalization are centralized there, then each endpoint can stay thin and focused on one resource shape. The token record in KV is the system of record, so endpoints should always load from KV, refresh when the stored access token is near expiry, and preserve the existing protected-endpoint semantics.

Zoho Recruit’s API is structurally capable of supporting the issue with a small number of record and attachment reads: job openings come from the `Job Openings` module, applicants for a job opening can be obtained from the associated-records API on the job opening, candidate details come from the `Candidates` module, and resume metadata comes from the attachments API on a candidate or application record. The unstable part is field naming. Recruit responses often mix canonical ids with user-configured field labels and lookup objects. That means the implementation should normalize defensively, prefer obvious standard fields, and expose raw records alongside the normalized layer rather than pretending the schema is perfectly known.

## Strategy

The smallest robust solution is to build one shared Recruit client helper and four narrowly scoped endpoints. The shared client should handle base URL normalization, near-expiry refresh, protected fetches, query assembly, and conversion of Zoho error payloads into clear JSON failures for auth, scope, invalid module, and missing configuration cases. Each endpoint should then do only enough Zoho I/O to produce a stable downstream payload: jobs list/filter, job applicants list, candidate detail, and resume/attachment metadata.

Normalization should favor review workflows over exact mirroring of Zoho’s raw schema. The payloads need stable ids, names, contact info, status, experience, attachment presence, and preassembled review-friendly sections. Exact Recruit records still matter for edge cases, so raw records should remain available in the response. This makes the endpoint useful both for scoring pipelines and for debugging ambiguous tenant-specific fields.

## Key Discoveries

The current `ping` endpoint already re-implements token refresh logic locally, which is the first sign that refresh and API calls belong in shared helpers. The Recruit API also separates candidate attachments from candidate records, so “resume support” is really an attachments metadata problem with optional download URLs synthesized from known attachment paths rather than a single dedicated resume field. The associated-records API for job openings is a better fit for applicant listing than guessing an `Applications` search field, because it is explicitly documented for “associated candidates for a job opening.”

Initially the likely design risk was that region handling might require tenant-specific API domains from OAuth token responses. The stronger theory is that Recruit should use an explicit Recruit base helper with override support and strict slash normalization, because the token response’s `api_domain` is not the same thing as the Recruit host.

## Open Questions

Some Recruit tenants may expose application-specific relationships or custom resume handling that do not appear in the generic API examples. The implementation should therefore treat application ids and resume category labels as optional signals, not hard requirements. If downstream consumers later need richer application-specific review context, the likely extension is to add optional application fetches using the `Applications` module rather than broadening the initial surface area now.
