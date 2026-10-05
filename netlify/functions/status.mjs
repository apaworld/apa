// GET /.netlify/functions/status
// Tells the test page which sources have their keys configured. Never returns the keys.
import { json, env } from "../lib/common.mjs";

export default async () => json({
  ok: true,
  sources: {
    "jobs-adzuna":        { needsKey: true,  configured: !!(env("ADZUNA_APP_ID") && env("ADZUNA_APP_KEY")) },
    "jobs-francetravail": { needsKey: true,  configured: !!(env("FT_CLIENT_ID") && env("FT_CLIENT_SECRET")) },
    "search-claude":      { needsKey: true,  configured: !!env("ANTHROPIC_API_KEY") },
    "benefits-openfisca": { needsKey: false, configured: true },
    "places-osm":         { needsKey: false, configured: true },
    "stats-worldbank":    { needsKey: false, configured: true },
    "geocode-fr":         { needsKey: false, configured: true },
    "francetravail-explorer": { needsKey: true, configured: !!(env("FT_CLIENT_ID") && env("FT_CLIENT_SECRET") && env("FT_EXPLORER") === "1") }
  }
});
