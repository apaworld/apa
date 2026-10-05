// POST /.netlify/functions/francetravail-explorer
// body: {"scope": "...", "method": "GET"|"POST", "path": "/partenaire/...", "query": "a=1&b=2", "body": {...}}
// Calls any France Travail API your application is subscribed to, with the scope and path you give,
// so each API can be tested before it gets its own dedicated function.
// Safety: only api.francetravail.io/partenaire/* is reachable, and the explorer must be switched on
// with FT_EXPLORER=1 (do not enable it on a public deployment: anyone could use your quota).
import { json, fail, missingKeys, fetchWithTimeout, env, clip, readBody } from "../lib/common.mjs";

const SOURCE = "francetravail-explorer";
const TOKEN_URL = env("FT_TOKEN_URL") || "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const tokens = new Map(); // scope -> {token, until}

async function getToken(id, secret, scope) {
  const c = tokens.get(scope);
  if (c && Date.now() < c.until) return { token: c.token, cached: true };
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret, scope })
  });
  const { data, text } = await readBody(res);
  if (!res.ok || !data?.access_token) {
    const err = new Error(`Token refused (${res.status})`);
    err.detail = clip(text, 500); err.step = "token"; throw err;
  }
  tokens.set(scope, { token: data.access_token, until: Date.now() + Math.max(60, (data.expires_in || 1400) - 60) * 1000 });
  return { token: data.access_token, cached: false, grantedScope: data.scope || null };
}

export default async (req) => {
  const started = Date.now();
  if (env("FT_EXPLORER") !== "1") return fail(SOURCE, "The explorer is switched off",
    "Set FT_EXPLORER=1 (as a Codespaces secret or in .env) to use it for testing.", 403);
  if (req.method !== "POST") return fail(SOURCE, "Use POST", null, 405);
  const id = env("FT_CLIENT_ID"), secret = env("FT_CLIENT_SECRET");
  if (!id || !secret) return missingKeys(SOURCE, ["FT_CLIENT_ID", "FT_CLIENT_SECRET"]);

  let b = {}; try { b = await req.json(); } catch {}
  const scope = String(b.scope || "").trim();
  const method = String(b.method || "GET").toUpperCase() === "POST" ? "POST" : "GET";
  const path = String(b.path || "").trim();
  const query = String(b.query || "").trim().replace(/^\?/, "");
  if (!scope) return fail(SOURCE, "Scope is empty", "Copy it from the API's documentation on francetravail.io.", 400);
  if (!/^\/partenaire\/[A-Za-z0-9_\-./{}]+$/.test(path) || path.includes(".."))
    return fail(SOURCE, "Path must start with /partenaire/", "Copy the path from the API's documentation, without the domain.", 400);

  try {
    const t = await getToken(id, secret, scope);
    const url = `https://api.francetravail.io${path}${query ? "?" + query : ""}`;
    const res = await fetchWithTimeout(url, {
      method,
      headers: { authorization: `Bearer ${t.token}`, accept: "application/json", ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      body: method === "POST" ? JSON.stringify(b.body ?? {}) : undefined
    }, 20000);
    const { data, text } = await readBody(res);
    return json({
      ok: res.ok, source: SOURCE, step: "call", status: res.status, ms: Date.now() - started,
      url: url.replace(/client_secret=[^&]+/g, "client_secret=***"),
      token: { cached: t.cached, granted_scope: t.grantedScope || undefined },
      note: res.status === 204 ? "204: the call worked but there were no results." :
            res.status === 206 ? "206: partial results (normal for paginated lists)." : null,
      response: data ?? clip(text, 4000)
    }, res.ok ? 200 : 502);
  } catch (e) {
    return fail(SOURCE, e.name === "AbortError" ? "France Travail took too long" : e.message,
      e.step === "token" ? (e.detail || "") + "  Check the scope text: it must match the documentation exactly, and the API must be added to your application." : e.detail, 502, { step: e.step || "call" });
  }
};
