import { getBaseUrl, getTokenStorageMode, hasKvConfig, json, loadTokens } from "./_lib.js";

export default async function handler(req, res) {
  const hasKv = hasKvConfig();
  const hasClient = Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET);
  const tokenStorage = getTokenStorageMode();
  const callbackUrl = process.env.ZOHO_REDIRECT_URI || `${getBaseUrl(req)}/api/oauth/zoho/callback`;
  let storedTokens = null;
  let tokenLookupError = null;

  try {
    storedTokens = await loadTokens();
  } catch (error) {
    tokenLookupError = String(error?.message || error);
  }

  const hasRefreshToken = Boolean(storedTokens?.refresh_token);
  const hasAccessToken = Boolean(storedTokens?.access_token);
  const hasStoredToken = hasRefreshToken || hasAccessToken;

  return json(res, 200, {
    ok: true,
    service: "zoho-oauth-vercel",
    hasKv,
    hasClient,
    hasRefreshToken,
    hasAccessToken,
    hasStoredToken,
    tokenStorage,
    readReady: hasClient && hasStoredToken,
    writeReady: hasClient && hasKv && hasStoredToken,
    callbackUrl,
    tokenLookupError,
    missing: {
      client: hasClient ? [] : ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"],
      read: hasClient && hasStoredToken ? [] : ["ZOHO_REFRESH_TOKEN or completed OAuth token storage"],
      write: hasClient && hasKv && hasStoredToken ? [] : ["KV_REST_API_URL", "KV_REST_API_TOKEN", "completed OAuth token storage"]
    }
  });
}
