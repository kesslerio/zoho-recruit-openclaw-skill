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
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? "application/json" : null;
      }
    },
    text: async () => JSON.stringify(payload)
  };
}

function binaryResponse(bytes, { status = 200, contentType = "application/octet-stream" } = {}) {
  const buffer = Buffer.from(bytes);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? contentType : null;
      }
    },
    arrayBuffer: async () => buffer
  };
}

function createResponseRecorder() {
  return {
    code: null,
    headers: {},
    body: null,
    status(code) {
      this.code = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    send(body) {
      this.body = JSON.parse(body);
      return this;
    }
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


test("downloadAttachmentContent returns binary resume bytes", async () => {
  await withEnv({
    ZOHO_ACCESS_TOKEN: "access-demo",
    ZOHO_ACCESS_TOKEN_EXPIRES_AT: "9999999999999"
  }, async () => {
    await withMockFetch(async (url) => {
      const value = String(url);

      if (value.includes('/Candidates/candidate-123/Attachments') && !value.endsWith('/att-1')) {
        return jsonResponse({
          data: [
            {
              id: 'att-1',
              File_Name: 'resume.pdf',
              Attachment_Category: 'Resume',
              Modified_Time: '2026-04-20 10:00:00'
            }
          ],
          info: { more_records: false }
        });
      }

      if (value.endsWith('/Candidates/candidate-123/Attachments/att-1')) {
        return binaryResponse('resume bytes', { contentType: 'application/pdf' });
      }

      throw new Error(`Unexpected fetch: ${value}`);
    }, async () => {
      const { downloadAttachmentContent } = await importFresh('../api/recruit/_shared.js');
      const result = await downloadAttachmentContent({
        moduleApiName: 'Candidates',
        recordId: 'candidate-123',
        attachmentId: 'att-1'
      });

      assert.equal(result.buffer.toString('utf8'), 'resume bytes');
      assert.equal(result.contentType, 'application/pdf');
    });
  });
});

test("downloadAttachmentContent surfaces embedded Zoho JSON errors", async () => {
  await withEnv({
    ZOHO_ACCESS_TOKEN: "access-demo",
    ZOHO_ACCESS_TOKEN_EXPIRES_AT: "9999999999999"
  }, async () => {
    await withMockFetch(async (url) => {
      const value = String(url);

      if (value.endsWith('/Candidates/candidate-123/Attachments/att-1')) {
        return jsonResponse({
          status: 'error',
          code: 'INVALID_DATA',
          message: 'Attachment is not accessible'
        });
      }

      throw new Error(`Unexpected fetch: ${value}`);
    }, async () => {
      const { downloadAttachmentContent } = await importFresh('../api/recruit/_shared.js');
      await assert.rejects(
        () => downloadAttachmentContent({
          moduleApiName: 'Candidates',
          recordId: 'candidate-123',
          attachmentId: 'att-1'
        }),
        /Attachment is not accessible/
      );
    });
  });
});

test("resume-content handler returns base64 for the primary resume", async () => {
  await withEnv({
    ZOHO_ACCESS_TOKEN: 'access-demo',
    ZOHO_ACCESS_TOKEN_EXPIRES_AT: '9999999999999'
  }, async () => {
    await withMockFetch(async (url) => {
      const value = String(url);

      if (value.includes('/Candidates/candidate-123/Attachments') && !value.endsWith('/att-1')) {
        return jsonResponse({
          data: [
            {
              id: 'att-1',
              File_Name: 'resume.pdf',
              Attachment_Category: 'Resume',
              Modified_Time: '2026-04-20 10:00:00'
            }
          ],
          info: { more_records: false }
        });
      }

      if (value.endsWith('/Candidates/candidate-123/Attachments/att-1')) {
        return binaryResponse('resume bytes', { contentType: 'application/pdf' });
      }

      throw new Error(`Unexpected fetch: ${value}`);
    }, async () => {
      const { default: handler } = await importFresh('../api/recruit/candidates/[candidateId]/resume-content.js');
      const req = {
        query: { candidateId: 'candidate-123' },
        headers: {}
      };
      const res = createResponseRecorder();

      await handler(req, res);

      assert.equal(res.code, 200);
      assert.equal(res.body.attachment.id, 'att-1');
      assert.equal(res.body.contentType, 'application/pdf');
      assert.equal(Buffer.from(res.body.contentBase64, 'base64').toString('utf8'), 'resume bytes');
    });
  });
});

test("resume-content handler rejects non-resume attachment ids", async () => {
  await withEnv({
    ZOHO_ACCESS_TOKEN: 'access-demo',
    ZOHO_ACCESS_TOKEN_EXPIRES_AT: '9999999999999'
  }, async () => {
    await withMockFetch(async (url) => {
      const value = String(url);

      if (value.includes('/Candidates/candidate-123/Attachments')) {
        return jsonResponse({
          data: [
            {
              id: 'att-1',
              File_Name: 'resume.pdf',
              Attachment_Category: 'Resume',
              Modified_Time: '2026-04-20 10:00:00'
            },
            {
              id: 'att-2',
              File_Name: 'notes.txt',
              Attachment_Category: 'Other',
              Modified_Time: '2026-04-20 11:00:00'
            }
          ],
          info: { more_records: false }
        });
      }

      throw new Error(`Unexpected fetch: ${value}`);
    }, async () => {
      const { default: handler } = await importFresh('../api/recruit/candidates/[candidateId]/resume-content.js');
      const req = {
        query: { candidateId: 'candidate-123', attachmentId: 'att-2' },
        headers: {}
      };
      const res = createResponseRecorder();

      await handler(req, res);

      assert.equal(res.code, 404);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error.type, 'not_found');
    });
  });
});
