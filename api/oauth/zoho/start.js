import crypto from "node:crypto";
import { getBaseUrl, json, zohoAccountsHost } from "../../_lib.js";

export default async function handler(req, res) {
  if (!process.env.ZOHO_CLIENT_ID) {
    return json(res, 500, { ok: false, error: "ZOHO_CLIENT_ID missing" });
  }

  const scope = process.env.ZOHO_SCOPE || "ZohoRecruit.modules.ALL,ZohoRecruit.modules.notes.ALL,ZohoRecruit.settings.ALL,ZohoRecruit.search.READ,ZohoRecruit.modules.attachments.READ";
  const state = crypto.randomUUID();
  const redirectUri = process.env.ZOHO_REDIRECT_URI || `${getBaseUrl(req)}/api/oauth/zoho/callback`;

  const url = new URL(`${zohoAccountsHost()}/oauth/v2/auth`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.ZOHO_CLIENT_ID);
  url.searchParams.set("scope", scope);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  res.status(302).setHeader("location", url.toString());
  return res.end();
}
