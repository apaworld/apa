// GET /.netlify/functions/jobs-francetravail?q=chauffeur&scope=lyon|france
// Official France Travail job offers (API "Offres d'emploi v2").
// Lyon: commune 69123 with a 10 km radius, falling back to the Rhône département (69).
// France: the whole country. Docs: https://francetravail.io/data/api/offres-emploi
import { getScope, result, fail, missingKeys, fetchWithTimeout, env, clip, readBody } from "../lib/common.mjs";

const SOURCE = "jobs-francetravail";
const TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const SEARCH_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";

let cached = { token: null, until: 0 }; // reused while the function instance stays warm

async function getToken(id, secret) {
  if (cached.token && Date.now() < cached.until) return cached.token;
  const body = new URLSearchParams({
    grant_type: "client_credentials", client_id: id, client_secret: secret, scope: "api_offresdemploiv2 o2dsoffre"
  });
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body
  });
  const { data, text } = await readBody(res);
  if (!res.ok || !data?.access_token) throw Object.assign(new Error(`Token request failed (${res.status})`), { detail: clip(text, 400) });
  cached = { token: data.access_token, until: Date.now() + Math.max(60, (data.expires_in || 1400) - 60) * 1000 };
  return cached.token;
}

async function search(token, params) {
  const res = await fetchWithTimeout(`${SEARCH_URL}?${params}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (res.status === 204) return { status: 204, data: { resultats: [] } };   // no offers
  const { data, text } = await readBody(res);
  return { status: res.status, data, text };                                   // 200 or 206 (partial) are both fine
}

export default async (req) => {
  const started = Date.now();
  const url = new URL(req.url);
  const scope = getScope(url);
  const id = env("FT_CLIENT_ID"), secret = env("FT_CLIENT_SECRET");
  if (!id || !secret) return missingKeys(SOURCE, ["FT_CLIENT_ID", "FT_CLIENT_SECRET"]);

  const q = url.searchParams.get("q") || "";
  const base = { range: "0-19", sort: "1" };          // sort 1 = most recent first
  if (q) base.motsCles = q;

  try {
    const token = await getToken(id, secret);
    let applied = "France", r;
    if (scope.key === "lyon") {
      r = await search(token, new URLSearchParams({ ...base, commune: "69123", distance: "10" }));
      applied = "Lyon + 10 km";
      if (r.status >= 400) {  // some setups reject the commune filter: use the département instead
        r = await search(token, new URLSearchParams({ ...base, departement: "69" }));
        applied = "Rhône (69)";
      }
    } else {
      r = await search(token, new URLSearchParams(base));
    }
    if (r.status >= 400 || !r.data) return fail(SOURCE, `France Travail answered ${r.status}`, clip(r.text, 400));

    const items = (r.data.resultats || []).map(o => ({
      title: o.intitule || "",
      subtitle: o.entreprise?.nom || "",
      location: o.lieuTravail?.libelle || "",
      date: o.dateCreation || null,
      url: o.origineOffre?.urlOrigine || (o.id ? `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}` : null),
      extra: {
        salary: o.salaire?.libelle || null,
        contract: [o.typeContratLibelle, o.dureeTravailLibelleConverti].filter(Boolean).join(", ") || null,
        experience: o.experienceLibelle || null,
        summary: clip(o.description, 240)
      }
    }));
    return result({
      source: SOURCE, scopeRequested: scope.key, scopeApplied: applied, items, raw: r.data, started,
      wantRaw: url.searchParams.has("raw")
    });
  } catch (e) {
    return fail(SOURCE, e.name === "AbortError" ? "France Travail took too long" : e.message, e.detail ||
      "Check that your francetravail.io application is subscribed to the API 'Offres d'emploi v2'.");
  }
};
