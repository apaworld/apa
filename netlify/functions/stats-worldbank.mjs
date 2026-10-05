// GET /.netlify/functions/stats-worldbank?compare=CA,DE,ES&indicator=unemployment
// Country indicators from the World Bank (no key). Data is national only, so Lyon falls back to France.
// Useful for the relocation advisor: compare France with countries the user is thinking about.
// Docs: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
import { getScope, result, fail, fetchWithTimeout, clip, readBody } from "../lib/common.mjs";

const SOURCE = "stats-worldbank";
const INDICATORS = {
  unemployment:   ["SL.UEM.TOTL.ZS", "Unemployment, % of labour force"],
  youth_unemployment: ["SL.UEM.1524.ZS", "Unemployment, ages 15-24, %"],
  inflation:      ["FP.CPI.TOTL.ZG", "Inflation, consumer prices, % per year"],
  gdp_per_capita: ["NY.GDP.PCAP.CD", "GDP per person, current US$"],
  life_expectancy:["SP.DYN.LE00.IN", "Life expectancy at birth, years"]
};

export default async (req) => {
  const started = Date.now();
  const url = new URL(req.url);
  const scope = getScope(url);
  const which = url.searchParams.get("indicator") || "unemployment";
  const ind = INDICATORS[which];
  if (!ind) return fail(SOURCE, `Unknown indicator "${which}"`, `Use one of: ${Object.keys(INDICATORS).join(", ")}`, 400);
  const compare = (url.searchParams.get("compare") || "").toUpperCase().split(",").map(s => s.trim()).filter(c => /^[A-Z]{2,3}$/.test(c)).slice(0, 6);
  const countries = ["FR", ...compare.filter(c => c !== "FR")];

  try {
    const res = await fetchWithTimeout(`https://api.worldbank.org/v2/country/${countries.join(";")}/indicator/${ind[0]}?format=json&mrnev=1&per_page=50`);
    const { data, text } = await readBody(res);
    if (!res.ok || !Array.isArray(data)) return fail(SOURCE, `World Bank answered ${res.status}`, clip(text, 300));
    const rows = data[1] || [];
    const items = rows.map(r => ({
      title: r.country?.value || r.countryiso3code,
      subtitle: r.value == null ? "No recent value" : `${Math.round(r.value * 100) / 100}`,
      location: r.countryiso3code, date: r.date, url: `https://data.worldbank.org/indicator/${ind[0]}?locations=${r.country?.id || ""}`,
      extra: { indicator: ind[1], value: r.value, year: r.date }
    }));
    return result({ source: SOURCE, scopeRequested: scope.key, scopeApplied: "France (national data)",
      note: (scope.key === "lyon" ? "World Bank data is national, so France is used for Lyon. " : "") + ind[1] + ", latest available year.",
      items, raw: data, started, wantRaw: url.searchParams.has("raw") });
  } catch (e) {
    return fail(SOURCE, e.name === "AbortError" ? "World Bank took too long" : e.message);
  }
};
