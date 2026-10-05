// Shared France Travail access: one token per scope, reused while the function stays warm.
import { env, fetchWithTimeout, readBody, clip } from "./common.mjs";

const TOKEN_URL = () => env("FT_TOKEN_URL") || "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const tokens = new Map();

export function ftKeys() { return { id: env("FT_CLIENT_ID"), secret: env("FT_CLIENT_SECRET") }; }

export async function ftToken(scope) {
  const c = tokens.get(scope);
  if (c && Date.now() < c.until) return c.token;
  const { id, secret } = ftKeys();
  const res = await fetchWithTimeout(TOKEN_URL(), {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret, scope })
  });
  const { data, text } = await readBody(res);
  if (!res.ok || !data?.access_token) throw Object.assign(new Error(`France Travail refused the token (${res.status})`), { detail: clip(text, 300) });
  tokens.set(scope, { token: data.access_token, until: Date.now() + Math.max(60, (data.expires_in || 1400) - 60) * 1000 });
  return data.access_token;
}

// GET or POST on api.francetravail.io. 204 = no results, returned as null.
export async function ftCall(scope, path, { query, body } = {}) {
  const token = await ftToken(scope);
  const url = `https://api.francetravail.io${path}${query ? "?" + new URLSearchParams(query) : ""}`;
  const res = await fetchWithTimeout(url, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }, 20000);
  if (res.status === 204) return null;
  const { data, text } = await readBody(res);
  if (!res.ok) throw Object.assign(new Error(`France Travail answered ${res.status}`), { detail: clip(text, 300) });
  return data;
}
