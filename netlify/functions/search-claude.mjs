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

  const maxSearches = Math.max(1, Math.min(10, Number(env("CLAUDE_MAX_SEARCHES")) || 3));
  const tool = { type: env("CLAUDE_WEB_SEARCH_TOOL") || "web_search_20250305", name: "web_search", max_uses: maxSearches };
  if (scope.key === "lyon") tool.user_location = { type: "approximate", city: "Lyon", region: "Auvergne-Rhône-Alpes", country: "FR", timezone: "Europe/Paris" };
  else tool.user_location = { type: "approximate", country: "FR", timezone: "Europe/Paris" };

  const place = scope.key === "lyon" ? "Lyon (Métropole de Lyon, France)" : "France";
  const system = `You are APA, a personal agent that finds real, current solutions for social and economic problems.
Search the web and answer for someone living in ${place}. Prefer official services (service-public.fr, CAF, France Travail,
Métropole de Lyon, Ville de Lyon), recognised associations and well-known platforms. Give concrete names, addresses or links,
and say when something needs to be checked. Answer in ${lang}, in short paragraphs or a short list, with no preamble.`;

  // Room for thinking + search results + the written answer. 1500 was too small (stop_reason "max_tokens").
  const maxTokens = Math.max(1000, Number(env("CLAUDE_MAX_TOKENS")) || 8000);
  const messages = [{ role: "user", content: q }];
  const blocks = [];
  let data, stop = null, rounds = 0;
  const usage = { input_tokens: 0, output_tokens: 0, web_search_requests: 0 };

  try {
    // A long web search can return stop_reason "pause_turn": send the partial turn back and let Claude continue.
    do {
      rounds++;
      const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: env("CLAUDE_MODEL") || "claude-sonnet-5-5", max_tokens: maxTokens, system, tools: [tool], messages })
      }, 90000);
      const r = await readBody(res);
      if (!res.ok || !r.data) return fail(SOURCE, `Claude API answered ${res.status}`, clip(r.text, 600));
      data = r.data; stop = data.stop_reason;
      blocks.push(...(data.content || []));
      usage.input_tokens += data.usage?.input_tokens || 0;
      usage.output_tokens += data.usage?.output_tokens || 0;
      usage.web_search_requests += data.usage?.server_tool_use?.web_search_requests || 0;
      if (stop === "pause_turn") messages.push({ role: "assistant", content: data.content });
    } while (stop === "pause_turn" && rounds < 3);

    const answer = blocks.filter(b => b.type === "text").map(b => b.text).join("").trim();
    const sources = new Map();
    for (const b of blocks) {
      for (const c of (b.citations || [])) if (c.url) sources.set(c.url, c.title || c.url);
      if (b.type === "web_search_tool_result" && Array.isArray(b.content))
        for (const r of b.content) if (r.url && !sources.has(r.url)) sources.set(r.url, r.title || r.url);
    }
    const items = [...sources].slice(0, 12).map(([u, title]) => ({ title, subtitle: new URL(u).hostname, location: null, date: null, url: u, extra: {} }));
    const note = !answer && stop === "max_tokens"
      ? `Claude ran out of room before writing (stop_reason max_tokens, limit ${maxTokens}). Raise CLAUDE_MAX_TOKENS.`
      : (stop === "max_tokens" ? "The answer was cut short: raise CLAUDE_MAX_TOKENS." : null);
    return json({
      ok: true, source: SOURCE, scope_requested: scope.key, scope_applied: place, note,
      answer, count: items.length, ms: Date.now() - started, items,
      stop_reason: stop, rounds, usage,
      raw: body.raw ? data : undefined
    });
  } catch (e) {
    return fail(SOURCE, e.name === "AbortError" ? "Claude took too long" : e.message);
  }
};
