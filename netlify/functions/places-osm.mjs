// GET /.netlify/functions/places-osm?scope=lyon&category=library
// Useful places from OpenStreetMap (Overpass API). No key needed.
// Lyon: Lyon and Villeurbanne. France-wide is too large for one query, so scope=france
// needs a city (&city=Marseille) and searches inside that commune.
// Usage policy: https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
import { getScope, result, fail, fetchWithTimeout, env, clip, readBody } from "../lib/common.mjs";

const SOURCE = "places-osm";
const OVERPASS = "https://overpass-api.de/api/interpreter";

// category -> OSM tags. Each fits a helper agent (community, health, jobs, languages...).
const CATEGORIES = {
  library:            ['["amenity"="library"]'],
  community_centre:   ['["amenity"="community_centre"]'],
  social_services:    ['["amenity"="social_facility"]', '["office"="association"]'],
  employment_agency:  ['["office"="employment_agency"]'],
  coworking:          ['["amenity"="coworking_space"]', '["office"="coworking"]'],
  sports:             ['["leisure"="sports_centre"]', '["leisure"="fitness_centre"]'],
  language_school:    ['["amenity"="language_school"]'],
  health:             ['["amenity"="clinic"]', '["amenity"="doctors"]', '["healthcare"="centre"]'],
  townhall:           ['["amenity"="townhall"]'],
  training:           ['["amenity"="college"]', '["amenity"="training"]']
};

export default async (req) => {
  const started = Date.now();
  const url = new URL(req.url);
  const scope = getScope(url);
  const cat = url.searchParams.get("category") || "library";
  const tags = CATEGORIES[cat];
  if (!tags) return fail(SOURCE, `Unknown category "${cat}"`, `Use one of: ${Object.keys(CATEGORIES).join(", ")}`, 400);

  let area, applied, areaDef = "";
  if (scope.key === "lyon") {
    const [s, w, n, e] = scope.bbox; area = `(${s},${w},${n},${e})`; applied = "Lyon + Villeurbanne";
  } else {
    const city = (url.searchParams.get("city") || "").replace(/["\\]/g, "").trim();
    if (!city) return fail(SOURCE, "France-wide place search is too large for one query",
      "Add &city=Marseille (or any French commune), or use scope=lyon.", 400);
    area = "(area.a)"; applied = `${city} (commune)`;
    areaDef = `area["name"="${city}"]["boundary"="administrative"]["admin_level"="8"]["ref:INSEE"]->.a;`;
  }
  const query = `[out:json][timeout:25];${areaDef}(${tags.map(t => `nwr${t}${area};`).join("")});out center tags 60;`;

  try {
    const contact = env("OSM_CONTACT_EMAIL") || "contact@example.com";
    const res = await fetchWithTimeout(OVERPASS, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": `Apacom-APA/0.1 (${contact})` },
      body: new URLSearchParams({ data: query })
    }, 30000);
    const { data, text } = await readBody(res);
    if (!res.ok || !data) return fail(SOURCE, `Overpass answered ${res.status}`, clip(text, 300) || "The public server may be busy: retry in a minute.");
    const items = (data.elements || []).filter(x => x.tags?.name).map(x => {
      const t = x.tags, lat = x.lat ?? x.center?.lat, lon = x.lon ?? x.center?.lon;
      const addr = [t["addr:housenumber"], t["addr:street"], t["addr:postcode"], t["addr:city"]].filter(Boolean).join(" ");
      return {
        title: t.name, subtitle: t.operator || t.description || cat.replace("_", " "),
        location: addr || null, date: null,
        url: t.website || t["contact:website"] || `https://www.openstreetmap.org/${x.type}/${x.id}`,
        extra: { phone: t.phone || t["contact:phone"] || null, opening_hours: t.opening_hours || null, wheelchair: t.wheelchair || null, lat, lon }
      };
    });
    return result({ source: SOURCE, scopeRequested: scope.key, scopeApplied: applied, note: `Category: ${cat}`, items,
      raw: { query, response: data }, started, wantRaw: url.searchParams.has("raw") });
  } catch (e) {
    return fail(SOURCE, e.name === "AbortError" ? "Overpass took too long" : e.message, "The public Overpass server is shared; retry later.");
  }
};
