// GET /.netlify/functions/places-osm?scope=lyon&category=library
// Useful places from OpenStreetMap (Overpass API). No key needed.
// With &lat=..&lon=..&radius=.. : places around the user, nearest first.
// Lyon: Lyon and Villeurbanne. France-wide is too large for one query, so scope=france
// needs a city (&city=Marseille) and searches inside that commune.
// Usage policy: https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
import { getScope, result, fail, fetchWithTimeout, env, clip, readBody } from "../lib/common.mjs";

const SOURCE = "places-osm";
const OVERPASS = "https://overpass-api.de/api/interpreter";

// category -> OSM tags. Each fits a helper agent (community, health, jobs, languages...).
const CATEGORIES = {
  food_shelter:       ['["social_facility"="food_bank"]', '["social_facility"="soup_kitchen"]', '["social_facility"="shelter"]', '["amenity"="food_bank"]'],
  social_services:    ['["amenity"="social_facility"]', '["amenity"="social_centre"]'],
  associations:       ['["office"="association"]', '["office"="ngo"]'],
  library:            ['["amenity"="library"]'],
  community_centre:   ['["amenity"="community_centre"]'],
  employment_agency:  ['["office"="employment_agency"]'],
  coworking:          ['["amenity"="coworking_space"]', '["office"="coworking"]'],
  sports:             ['["leisure"="sports_centre"]', '["leisure"="fitness_centre"]'],
  language_school:    ['["amenity"="language_school"]'],
  health:             ['["amenity"="clinic"]', '["amenity"="doctors"]', '["healthcare"="centre"]'],
  townhall:           ['["amenity"="townhall"]'],
  training:           ['["amenity"="college"]', '["amenity"="training"]']
};

// distance in metres between two points (haversine)
function distance(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export default async (req) => {
  const started = Date.now();
  const url = new URL(req.url);
  const scope = getScope(url);
  const cat = url.searchParams.get("category") || "library";
  const tags = CATEGORIES[cat];
  if (!tags) return fail(SOURCE, `Unknown category "${cat}"`, `Use one of: ${Object.keys(CATEGORIES).join(", ")}`, 400);

  let area, applied, areaDef = "";
  // "near me": a point and a radius, e.g. &lat=45.76&lon=4.83&radius=2000
  const lat = parseFloat(url.searchParams.get("lat")), lon = parseFloat(url.searchParams.get("lon"));
  const near = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const radius = Math.min(10000, Math.max(200, parseInt(url.searchParams.get("radius") || "2000", 10) || 2000));
  let from = null;
  if (near) {
    area = `(around:${radius},${lat},${lon})`; applied = `${(radius / 1000).toLocaleString("en")} km around the user`;
    from = { lat, lon };
  } else if (scope.key === "lyon") {
    const [s, w, n, e] = scope.bbox; area = `(${s},${w},${n},${e})`; applied = "Lyon + Villeurbanne";
    from = { lat: scope.lat, lon: scope.lon };
  } else {
    const city = (url.searchParams.get("city") || "").replace(/["\\]/g, "").trim();
    if (!city) return fail(SOURCE, "France-wide place search is too large for one query",
      "Add &city=Marseille (or any French commune), give a position with &lat=..&lon=.., or use scope=lyon.", 400);
    area = "(area.a)"; applied = `${city} (commune)`;
    areaDef = `area["name"="${city}"]["boundary"="administrative"]["admin_level"="8"]["ref:INSEE"]->.a;`;
  }
  const query = `[out:json][timeout:25];${areaDef}(${tags.map(t => `nwr${t}${area};`).join("")});out center tags 150;`;

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
        extra: { phone: t.phone || t["contact:phone"] || null, opening_hours: t.opening_hours || null, wheelchair: t.wheelchair || null, lat, lon,
                 distance_m: (from && lat != null) ? distance(from.lat, from.lon, lat, lon) : null }
      };
    }).sort((a, b) => (a.extra.distance_m ?? 1e12) - (b.extra.distance_m ?? 1e12));
    return result({ source: SOURCE, scopeRequested: scope.key, scopeApplied: applied, note: `Category: ${cat}. Sorted by distance from ${near ? "the user" : "the centre of Lyon"}.`, items,
      raw: { query, response: data }, started, wantRaw: url.searchParams.has("raw") });
  } catch (e) {
    return fail(SOURCE, e.name === "AbortError" ? "Overpass took too long" : e.message, "The public Overpass server is shared; retry later.");
  }
};
