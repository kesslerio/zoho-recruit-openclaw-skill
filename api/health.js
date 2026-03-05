import { json } from "./_lib.js";

export default async function handler(req, res) {
  return json(res, 200, {
    ok: true,
    service: "zoho-oauth-vercel",
    hasKv: Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
    hasClient: Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET)
  });
}
