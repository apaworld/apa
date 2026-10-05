// GET /.netlify/functions/jobs-adzuna?q=chauffeur&scope=lyon|france&page=1
// Adzuna job search. Lyon: offers within ~20 km of Lyon. France: the whole country.
// Docs: https://developer.adzuna.com/
import { getScope, result, fail, missingKeys, fetchWithTimeout, env, clip, readBody } from "../lib/common.mjs";

const SOURCE = "jobs-adzuna";

export default async (req) => {
  const started = Date.now();
  const url = new URL(req.url);
  const scope = getScope(url);
  const id = env("ADZUNA_APP_ID"), key = env("ADZUNA_APP_KEY");
  if (!id || !key) return missingKeys(SOURCE, ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"]);

  const q = url.searchParams.get("q") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const p = new URLSearchParams({
    app_id: id, app_key: key, results_per_page: "20", what: q, "content-type": "application/json", sort_by: "date"
  });
  if (scope.key === "lyon") { p.set("where", "Lyon"); p.set("distance", "20"); }

  try {
    const res = await fetchWithTimeout(`https://api.adzuna.com/v1/api/jobs/fr/search/${page}?${p}`);
    const { data, text } = await readBody(res);
    if (!res.ok || !data) return fail(SOURCE, `Adzuna answered ${res.status}`, clip(text, 400), res.status === 401 ? 401 : 502);
    const items = (data.results || []).map(j => ({
      title: j.title ? clip(j.title, 140) : "",
      subtitle: j.company?.display_name || "",
      location: j.location?.display_name || "",
      date: j.created || null,
      url: j.redirect_url || null,
      extra: {
        salary: j.salary_min ? `${Math.round(j.salary_min)}–${Math.round(j.salary_max || j.salary_min)} € / year${j.salary_is_predicted === "1" ? " (estimated)" : ""}` : null,
        contract: [j.contract_type, j.contract_time].filter(Boolean).join(", ") || null,
        category: j.category?.label || null,
        summary: clip(j.description, 240)
      }
    }));
    return result({
      source: SOURCE, scopeRequested: scope.key, scopeApplied: scope.key === "lyon" ? "Lyon + 20 km" : "France",
      note: `Total matching offers: ${data.count ?? "unknown"}`,
      items, raw: data, started, wantRaw: url.searchParams.has("raw")
    });
  } catch (e) {
    return fail(SOURCE, e.name === "AbortError" ? "Adzuna took too long" : e.message);
  }
};
