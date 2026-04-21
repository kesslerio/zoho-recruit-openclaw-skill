import assert from "node:assert/strict";
import test from "node:test";

const ENV_KEYS = [
  "ZOHO_ACCESS_TOKEN",
  "ZOHO_ACCESS_TOKEN_EXPIRES_AT"
];

async function importFresh(relativePath) {
  return import(new URL(`${relativePath}?t=${Date.now()}-${Math.random()}`, import.meta.url));
}

async function withEnv(overrides, fn) {
  const previous = new Map();

  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
  }

  for (const key of ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      process.env[key] = String(overrides[key]);
    } else {
      delete process.env[key];
    }
  }

  try {
    return await fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withMockFetch(implementation, fn) {
  const previous = global.fetch;
  global.fetch = implementation;

  try {
    return await fn();
  } finally {
    global.fetch = previous;
  }
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload)
  };
}

test("normalizeApplicantRecord falls back to the internal application record id", async () => {
  const { normalizeApplicantRecord } = await importFresh("../api/recruit/_normalize.js");
  const applicant = normalizeApplicantRecord({
    id: "850051000000588062",
    Application_ID: "ZR_8_APP",
    Full_Name: "Jacoby Curry",
    Email: "coby@example.com",
    Application_Status: "Applied"
  });

  assert.equal(applicant.applicationId, "850051000000588062");
  assert.equal(applicant.candidateId, null);
  assert.equal(applicant.reviewPayload.candidateId, null);
});

test("normalizeApplicantRecord preserves the related candidate record id separately from the application id", async () => {
  const { normalizeApplicantRecord } = await importFresh("../api/recruit/_normalize.js");
  const applicant = normalizeApplicantRecord({
    id: "850051000000588062",
    Application_ID: "ZR_8_APP",
    Candidate: { id: "850051000000577777", name: "Jacoby Curry" },
    Full_Name: "Jacoby Curry",
    Email: "coby@example.com",
    Application_Status: "Applied"
  });

  assert.equal(applicant.applicationId, "850051000000588062");
  assert.equal(applicant.candidateId, "850051000000577777");
  assert.equal(applicant.reviewPayload.candidateId, "850051000000577777");
});

test("listJobApplicants falls back to Applications when Zoho rejects job candidate relations", async () => {
  await withEnv({
    ZOHO_ACCESS_TOKEN: "access-demo",
    ZOHO_ACCESS_TOKEN_EXPIRES_AT: "9999999999999"
  }, async () => {
    const calls = [];

    await withMockFetch(async (url) => {
      const value = String(url);
      calls.push(value);

      if (value.includes("/JobOpenings/850051000000560065/Candidates")) {
        return jsonResponse({
          code: "INVALID_DATA",
          message: "the relation name given seems to be invalid"
        }, { ok: false, status: 400 });
      }

      if (value.includes("/JobOpenings/850051000000560065/associate")) {
        return jsonResponse({
          code: "INVALID_DATA",
          message: "the relation name given seems to be invalid"
        }, { ok: false, status: 400 });
      }

      if (value.includes("/recruit/v2/Applications?page=1&per_page=200")) {
        return jsonResponse({
          data: [
            {
              id: "850051000000588062",
              Application_ID: "ZR_8_APP",
              $Job_Opening_Id: "850051000000560065",
              Full_Name: "Jacoby Curry",
              Email: "coby@example.com",
              Mobile: "+16363780078",
              Application_Status: "Applied"
            },
            {
              id: "850051000000588063",
              Application_ID: "ZR_9_APP",
              $Job_Opening_Id: "other-job",
              Full_Name: "Wrong Person",
              Email: "wrong@example.com",
              Application_Status: "Applied"
            }
          ],
          info: {
            count: 2,
            page: 1,
            per_page: 200,
            more_records: false
          }
        });
      }

      throw new Error(`Unexpected fetch: ${value}`);
    }, async () => {
      const { listJobApplicants } = await importFresh("../api/recruit/_shared.js");
      const result = await listJobApplicants("850051000000560065", {
        page: 1,
        per_page: 50,
        candidate_statuses: "Applied"
      });

      assert.equal(result.payload.data.length, 1);
      assert.equal(result.payload.data[0].id, "850051000000588062");
      assert.equal(result.payload.info.source, "applications_fallback");
      assert.equal(calls.some((url) => url.includes("/Candidates")), true);
      assert.equal(calls.some((url) => url.includes("/associate")), true);
    });
  });
});
