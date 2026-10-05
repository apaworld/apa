// POST /.netlify/functions/search-claude   body: {"q": "...", "scope": "lyon"|"france", "lang": "fr"}
// APA's catch-all: Claude searches the live web and answers with sources.
// Lyon: results are localised to Lyon (web search user_location) and the prompt asks for Lyon resources.
// Docs: https://docs.claude.com/en/docs/agents-and-tools/tool-use/web-search-tool
// Model and tool version are configurable because they change over time: check the docs and set
// CLAUDE_MODEL / CLAUDE_WEB_SEARCH_TOOL in Netlify if the defaults are outdated.
import { SCOPES, json, fail, missingKeys, fetchWithTimeout, env, clip, readBody } from "../lib/common.mjs";

const SOURCE = "search-claude";
const LANGS = { en: "English", fr: "French", zh: "Simplified Chinese", ar: "Modern Standard Arabic" };

export default async (req) => {
  const started = Date.now();
  if (req.method !== "POST") return fail(SOURCE, "Use POST with a JSON body", '{"q":"...","scope":"lyon"}', 405);
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return missingKeys(SOURCE, ["ANTHROPIC_API_KEY"]);

  let body = {}; try { body = await req.json(); } catch {}
  const q = String(body.q || "").slice(0, 600).trim();
  if (!q) return fail(SOURCE, "Empty question", "Send {\"q\": \"your question\"}", 400);
  const scope = SCOPES[body.scope] || SCOPES.lyon;
  const lang = LANGS[body.lang] || "French";

  const tool = { type: env("CLAUDE_WEB_SEARCH_TOOL") || "web_search_20250305", name: "web_search", max_uses: 5 };
  if (scope.key === "lyon") tool.user_location = { type: "approximate", city: "Lyon", region: "Auvergne-Rhône-Alpes", country: "FR", timezone: "Europe/Paris" };
  else tool.user_location = { type: "approximate", country: "FR", timezone: "Europe/Paris" };

  const place = scope.key === "lyon" ? "Lyon (Métropole de Lyon, France)" : "France";
  const system = `You are APA, a personal agent that finds real, current solutions for social and economic problems.
Search the web and answer for someone living in ${place}. Prefer official services (service-public.fr, CAF, France Travail,
Métropole de Lyon, Ville de Lyon), recognised associations and well-known platforms. Give concrete names, addresses or links,
and say when something needs to be checked. Answer in ${lang}, in short paragraphs or a short list, with no preamble.`;

  try {
    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: env("CLAUDE_MODEL") || "claude-sonnet-5-5",
        max_tokens: 1500, system, tools: [tool],
        messages: [{ role: "user", content: q }]
      })
    }, 60000);
    const { data, text } = await readBody(res);
    if (!res.ok || !data) return fail(SOURCE, `Claude API answered ${res.status}`, clip(text, 600));

    const blocks = data.content || [];
    const answer = blocks.filter(b => b.type === "text").map(b => b.text).join("").trim();
    const sources = new Map();
    for (const b of blocks) {
      for (const c of (b.citations || [])) if (c.url) sources.set(c.url, c.title || c.url);
      if (b.type === "web_search_tool_result" && Array.isArray(b.content))
        for (const r of b.content) if (r.url && !sources.has(r.url)) sources.set(r.url, r.title || r.url);
    }
    const items = [...sources].slice(0, 12).map(([u, title]) => ({ title, subtitle: new URL(u).hostname, location: null, date: null, url: u, extra: {} }));
    return json({
      ok: true, source: SOURCE, scope_requested: scope.key, scope_applied: place, note: null,
      answer, count: items.length, ms: Date.now() - started, items,
      usage: data.usage || null,
      raw: body.raw ? data : undefined
    });
  } catch (e) {
    return fail(SOURCE, e.name === "AbortError" ? "Claude took too long" : e.message);
  }
};
