// Shared helpers for every live-source function.

// Where we test. Each source reports which scope it could really apply.
export const SCOPES = {
  lyon: {
    key: "lyon", label: "Lyon, France", city: "Lyon", country: "FR",
    insee: "69123",          // INSEE code of the commune of Lyon
    departement: "69",       // Rhône
    region: "Auvergne-Rhône-Alpes",
    lat: 45.7640, lon: 4.8357,
    // box around Lyon and Villeurbanne: south, west, north, east
    bbox: [45.707, 4.771, 45.808, 4.898],
    radiusKm: 15
  },
  france: { key: "france", label: "France", country: "FR" }
};

export function getScope(url) {
  const s = (url.searchParams.get("scope") || "lyon").toLowerCase();
  return SCOPES[s] || SCOPES.lyon;
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

// One answer shape for the test page and, later, for APA's helper agents.
export function result({ source, scopeRequested, scopeApplied, note, items, raw, started, wantRaw }) {
  return json({
    ok: true, source,
    scope_requested: scopeRequested, scope_applied: scopeApplied, note: note || null,
    count: items.length, ms: Date.now() - started,
    items,
    raw: wantRaw ? raw : undefined
  });
}

export function fail(source, error, hint, status = 502, extra = {}) {
  return json({ ok: false, source, error: String(error), hint: hint || null, ...extra }, status);
}

export function missingKeys(source, names) {
  return fail(source, `Missing environment variable(s): ${names.join(", ")}`,
    "Add them in Netlify: Site configuration > Environment variables, then redeploy.", 503, { missing: names });
}

export async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

// Netlify Functions v2 expose Netlify.env; fall back to process.env for local runs.
export const env = (k) =>
  ((typeof Netlify !== "undefined" && Netlify.env) ? Netlify.env.get(k) : process.env[k]) || "";

export const stripHtml = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
export const clip = (s, n = 280) => { s = stripHtml(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// Read the upstream body as text first, so non-JSON errors are still reported clearly.
export async function readBody(res) {
  const text = await res.text();
  try { return { data: JSON.parse(text), text }; } catch { return { data: null, text }; }
}
