import { getBaseUrl, getTokenStorageMode, hasKvConfig, json } from "./_lib.js";

export default async function handler(req, res) {
  const hasKv = hasKvConfig();
  const hasClient = Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET);
  const hasRefreshToken = Boolean(process.env.ZOHO_REFRESH_TOKEN);
  const tokenStorage = getTokenStorageMode();
  const callbackUrl = process.env.ZOHO_REDIRECT_URI || `${getBaseUrl(req)}/api/oauth/zoho/callback`;

  return json(res, 200, {
    ok: true,
    service: "zoho-oauth-vercel",
    hasKv,
    hasClient,
    hasRefreshToken,
    tokenStorage,
    readReady: hasClient && (hasKv || hasRefreshToken),
    writeReady: hasClient && hasKv,
    callbackUrl,
    missing: {
      client: hasClient ? [] : ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"],
      read: hasClient && (hasKv || hasRefreshToken) ? [] : ["ZOHO_REFRESH_TOKEN or KV_REST_API_URL/KV_REST_API_TOKEN"],
      write: hasClient && hasKv ? [] : ["KV_REST_API_URL", "KV_REST_API_TOKEN"]
    }
  });
}
