import assert from "node:assert/strict";
import test from "node:test";

const ENV_KEYS = [
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "ZOHO_CLIENT_ID",
  "ZOHO_CLIENT_SECRET",
  "ZOHO_REFRESH_TOKEN",
  "ZOHO_ACCESS_TOKEN",
  "ZOHO_ACCESS_TOKEN_EXPIRES_AT",
  "ZOHO_API_DOMAIN",
  "ZOHO_REDIRECT_URI"
];

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
      const value = overrides[key];
      if (value === undefined || value === null) {
        delete process.env[key];
      } else {
        process.env[key] = String(value);
      }
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

test("loadTokens uses env fallback when KV is absent", async () => {
  await withEnv({
    ZOHO_REFRESH_TOKEN: "refresh-demo",
    ZOHO_ACCESS_TOKEN: "access-demo",
    ZOHO_ACCESS_TOKEN_EXPIRES_AT: "12345",
    ZOHO_API_DOMAIN: "https://recruit.zoho.com"
  }, async () => {
    const { loadTokens, getTokenStorageMode, hasKvConfig } = await importFresh("../api/_lib.js");
    const tokens = await loadTokens();

    assert.equal(hasKvConfig(), false);
    assert.equal(getTokenStorageMode(), "env");
    assert.deepEqual(tokens, {
      refresh_token: "refresh-demo",
      access_token: "access-demo",
      expires_at: 12345,
      api_domain: "https://recruit.zoho.com"
    });
  });
});

test("health reports read readiness when client config and refresh token exist", async () => {
  await withEnv({
    ZOHO_CLIENT_ID: "client-demo",
    ZOHO_CLIENT_SECRET: "secret-demo",
    ZOHO_REFRESH_TOKEN: "refresh-demo"
  }, async () => {
    const { default: handler } = await importFresh("../api/health.js");
    const req = { headers: { host: "example.vercel.app", "x-forwarded-proto": "https" } };
    const res = createResponseRecorder();

    await handler(req, res);

    assert.equal(res.code, 200);
    assert.equal(res.body.hasClient, true);
    assert.equal(res.body.hasRefreshToken, true);
    assert.equal(res.body.hasAccessToken, false);
    assert.equal(res.body.hasStoredToken, true);
    assert.equal(res.body.tokenStorage, "env");
    assert.equal(res.body.readReady, true);
    assert.equal(res.body.writeReady, false);
    assert.deepEqual(res.body.missing.write, ["KV_REST_API_URL", "KV_REST_API_TOKEN", "completed OAuth token storage"]);
  });
});

test("health does not report ready when KV is configured but no token exists yet", async () => {
  await withEnv({
    KV_REST_API_URL: "https://kv.example.test",
    KV_REST_API_TOKEN: "kv-token",
    ZOHO_CLIENT_ID: "client-demo",
    ZOHO_CLIENT_SECRET: "secret-demo"
  }, async () => {
    await withMockFetch(async (url) => {
      if (String(url).startsWith("https://kv.example.test/get/")) {
        return {
          ok: true,
          json: async () => ({ result: null })
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }, async () => {
      const { default: handler } = await importFresh("../api/health.js");
      const req = { headers: { host: "example.vercel.app", "x-forwarded-proto": "https" } };
      const res = createResponseRecorder();

      await handler(req, res);

      assert.equal(res.code, 200);
      assert.equal(res.body.hasKv, true);
      assert.equal(res.body.hasStoredToken, false);
      assert.equal(res.body.readReady, false);
      assert.equal(res.body.writeReady, false);
      assert.deepEqual(res.body.missing.read, ["ZOHO_REFRESH_TOKEN or completed OAuth token storage"]);
    });
  });
});

test("oauth callback no-KV bootstrap returns refresh token with no-store headers", async () => {
  await withEnv({
    ZOHO_CLIENT_ID: "client-demo",
    ZOHO_CLIENT_SECRET: "secret-demo"
  }, async () => {
    await withMockFetch(async () => ({
      ok: true,
      json: async () => ({
        refresh_token: "refresh-demo",
        access_token: "access-demo",
        expires_in: 3600,
        api_domain: "https://recruit.zoho.com"
      })
    }), async () => {
      const { default: handler } = await importFresh("../api/oauth/zoho/callback.js");
      const req = {
        query: { code: "oauth-code" },
        headers: { host: "example.vercel.app", "x-forwarded-proto": "https" }
      };
      const res = createResponseRecorder();

      await handler(req, res);

      assert.equal(res.code, 200);
      assert.equal(res.headers["cache-control"], "no-store, max-age=0");
      assert.equal(res.headers.pragma, "no-cache");
      assert.equal(res.body.storage, "manual_env");
      assert.equal(res.body.manualEnv.ZOHO_REFRESH_TOKEN, "refresh-demo");
      assert.equal(res.body.manualEnv.ZOHO_API_DOMAIN, "https://recruit.zoho.com");
    });
  });
});

test("oauth callback KV branch stores tokens and omits manual bootstrap payload", async () => {
  await withEnv({
    KV_REST_API_URL: "https://kv.example.test",
    KV_REST_API_TOKEN: "kv-token",
    ZOHO_CLIENT_ID: "client-demo",
    ZOHO_CLIENT_SECRET: "secret-demo"
  }, async () => {
    const calls = [];

    await withMockFetch(async (url, options = {}) => {
      calls.push({ url: String(url), options });

      if (String(url).includes("/oauth/v2/token")) {
        return {
          ok: true,
          json: async () => ({
            refresh_token: "refresh-demo",
            access_token: "access-demo",
            expires_in: 3600,
            api_domain: "https://recruit.zoho.com"
          })
        };
      }

      if (String(url).startsWith("https://kv.example.test/set/")) {
        return {
          ok: true,
          json: async () => ({ result: "OK" })
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }, async () => {
      const { default: handler } = await importFresh("../api/oauth/zoho/callback.js");
      const req = {
        query: { code: "oauth-code" },
        headers: { host: "example.vercel.app", "x-forwarded-proto": "https" }
      };
      const res = createResponseRecorder();

      await handler(req, res);

      assert.equal(res.code, 200);
      assert.equal(res.headers["cache-control"], "no-store, max-age=0");
      assert.equal(res.headers.pragma, "no-cache");
      assert.equal(res.body.storage, "kv");
      assert.equal(res.body.manualEnv, undefined);
      assert.equal(calls.length, 2);
      assert.match(calls[1].url, /^https:\/\/kv\.example\.test\/set\//);
    });
  });
});
