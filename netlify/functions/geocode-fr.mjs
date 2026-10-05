// GET /.netlify/functions/geocode-fr?q=69002 Lyon
// Turns a French postal code or address into map coordinates, with the official national address
// service (Base Adresse Nationale). Free, no key. It moved to the IGN Géoplateforme, so the new
// address is tried first and the historic one second. Docs: https://adresse.data.gouv.fr/outils/api-doc/adresse
import { json, fail, fetchWithTimeout, clip, readBody } from "../lib/common.mjs";

const SOURCE = "geocode-fr";
const ENDPOINTS = [
  "https://data.geopf.fr/geocodage/search",
  "https://api-adresse.data.gouv.fr/search/"
];

export default async (req) => {
  const started = Date.now();
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
  if (q.length < 3) return fail(SOURCE, "Type a postal code or an address", "For example: 69002 Lyon", 400);
  let lastError = null;
  for (const base of ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(`${base}?${new URLSearchParams({ q, limit: "1" })}`, {}, 8000);
      const { data, text } = await readBody(res);
      if (!res.ok || !data) { lastError = `${new URL(base).hostname} answered ${res.status}: ${clip(text, 160)}`; continue; }
      const f = (data.features || [])[0];
      if (!f) return fail(SOURCE, `No French address found for "${q}"`, "Check the postal code or add the city name.", 404);
      const [lon, lat] = f.geometry.coordinates;
      const p = f.properties || {};
      return json({ ok: true, source: SOURCE, ms: Date.now() - started, provider: new URL(base).hostname,
        label: p.label || q, postcode: p.postcode || null, city: p.city || null, citycode: p.citycode || null,
        type: p.type || null, lat, lon });
    } catch (e) { lastError = e.name === "AbortError" ? `${new URL(base).hostname} took too long` : e.message; }
  }
  return fail(SOURCE, "The address service could not be reached", lastError);
};
