// GET /.netlify/functions/agencies-ft?postcode=69002
// France Travail agencies for the postal code the user knows. The postal code is converted to
// INSEE commune code(s) in the background (Lyon 69002 -> 69382), because the API only accepts those.
// Tested settings: scope "api_referentielagencesv1 organisationpe", GET /partenaire/referentielagences/v1/agences?commune=<INSEE>
import { result, fail, missingKeys } from "../lib/common.mjs";
import { postalToInsee } from "../lib/geo-fr.mjs";
import { ftKeys, ftCall } from "../lib/ft.mjs";

const SOURCE = "agencies-ft";
const SCOPE = "api_referentielagencesv1 organisationpe";
const titleCase = (s) => String(s || "").toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

function toItem(a, commune) {
  const ad = a.adressePrincipale || {};
  const lines = ["ligne3", "ligne4", "ligne5", "ligne6"].map(k => ad[k]).filter(Boolean).map(titleCase);
  const lat = ad.gpsLat ?? ad.latitude ?? null, lon = ad.gpsLon ?? ad.longitude ?? null;
  return {
    title: a.libelleEtendu || a.libelle || "Agence France Travail",
    subtitle: commune.name,
    location: lines.join(", ") || null,
    date: null,
    url: "https://www.francetravail.fr/",
    extra: { phone: a.contact?.telephonePublic || null, email: a.contact?.email || null, code: a.code || null, safir: a.codeSafir || null,
             lat: lat != null ? Number(lat) : null, lon: lon != null ? Number(lon) : null }
  };
}

export default async (req) => {
  const started = Date.now();
  const url = new URL(req.url);
  const { id, secret } = ftKeys();
  if (!id || !secret) return missingKeys(SOURCE, ["FT_CLIENT_ID", "FT_CLIENT_SECRET"]);
  const postcode = (url.searchParams.get("postcode") || "").trim();
  if (!postcode) return fail(SOURCE, "Type a postal code", "For example 69002 for Lyon 2e", 400);

  try {
    const conv = await postalToInsee(postcode);
    const items = []; const seen = new Set();
    for (const c of conv.communes.slice(0, 5)) {
      const list = (await ftCall(SCOPE, "/partenaire/referentielagences/v1/agences", { query: { commune: c.insee } })) || [];
      for (const a of list) { const k = a.code || a.libelle; if (!seen.has(k)) { seen.add(k); items.push(toItem(a, c)); } }
    }
    const conversion = conv.communes.map(c => `${c.name}: postal code ${postcode}, INSEE ${c.insee}`).join("; ");
    return result({
      source: SOURCE, scopeRequested: "postcode", scopeApplied: conv.communes.map(c => c.name).join(", "),
      note: `Converted in the background (${conv.source}): ${conversion}.` + (items.length ? "" : " No agency is registered in this commune; APA would look in the neighbouring ones."),
      items, raw: { conversion: conv }, started, wantRaw: url.searchParams.has("raw")
    });
  } catch (e) {
    return fail(SOURCE, e.message, e.detail || null, e.status || 502);
  }
};
