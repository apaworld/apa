# Apacom: live data sources, Lyon first

This package adds real data sources to the Apacom demo. Each source runs as a small
Netlify Function, so API keys stay on the server and never reach the browser.

- `public/index.html`: the Apacom app (registration, cabinet, legal pages)
- `public/live.html`: the **Live sources test** page
- `netlify/functions/`: one function per source
- `netlify/lib/common.mjs`: shared code, including the Lyon and France areas

## The sources and how they apply Lyon

| Function | What it finds | Lyon | France |
|---|---|---|---|
| `search-claude` | Live web search with sources (associations, services, events, anything) | Search localised to Lyon, Lyon resources preferred | Whole country |
| `jobs-francetravail` | Official job offers | Lyon + 10 km (falls back to Rhône, 69) | Whole country |
| `jobs-adzuna` | Job offers from many sites, with salaries | Lyon + 20 km | Whole country |
| `benefits-openfisca` | Estimated RSA, prime d'activité, family allowances, housing aid | Includes housing aid for Lyon | National benefits only (housing aid depends on the commune) |
| `places-osm` | Libraries, community centres, social services, job agencies, language schools, health centres | Lyon + Villeurbanne | Needs a city name (`&city=Marseille`) |
| `stats-worldbank` | Unemployment, inflation, GDP per person, life expectancy, compared with other countries | National data only, so France is used | France |

Every answer has the same shape: `ok`, `scope_requested`, `scope_applied`, `note`,
`count`, `ms`, `items[]` (title, subtitle, location, date, url, extra). Add `raw=1` to see the
untouched provider response. APA's helper agents will read this same shape later.

## Keys to get

1. **Adzuna**: create a free account at https://developer.adzuna.com/ and copy the App ID and App Key.
2. **France Travail**: at https://francetravail.io/ create an application and subscribe it to
   the API **"Offres d'emploi v2"**. Copy the client ID and secret.
3. **Claude API**: create a key at https://console.anthropic.com/. Web search is billed per search
   on top of tokens; check current pricing in the Claude docs.
4. OpenFisca, OpenStreetMap and the World Bank need no key.

The list of variables is in `.env.example`.

## Deploy

Functions need a real deploy: dragging a folder onto Netlify Drop publishes only the static pages.

**Option A, Netlify CLI**
```bash
npm install -g netlify-cli
netlify login
netlify link            # or: netlify init, to create the site
netlify env:set ADZUNA_APP_ID xxx      # repeat for each key, or use the Netlify UI
netlify deploy --prod
```

**Option B, Git**: push this folder to GitHub, then in Netlify choose
*Add new site > Import an existing project*. The settings come from `netlify.toml`.
Add the keys in *Site configuration > Environment variables* and redeploy.

**Local test**: copy `.env.example` to `.env`, fill in the keys, run `netlify dev`,
then open http://localhost:8888/live.html.

## Test plan for a Lyon user

1. Open `/live.html`. The chips at the top show which keys are set.
2. With **Lyon** selected, run each source with the prefilled examples.
3. Check **Area applied** on each result: it says what the source could really filter.
4. Switch to **France** and run again to compare.
5. Note what is useful, missing or wrong for each source. That decides which sources each helper agent gets.

## Before going international

- Adzuna: change `fr` in the request URL to the user's country (gb, us, de, ca...).
- France Travail and OpenFisca are France-only; other countries need their own public APIs.
- OpenStreetMap and Claude web search already work worldwide; only the area changes.
- The public Overpass and OpenFisca servers are shared. For production, cache results or host your own.

## Things to check yourself

Provider endpoints, scopes, prices and terms change. If a source fails, the test page shows the
error and the provider's message; compare them with that provider's current docs. The most likely
to need an update: the France Travail token URL and scope, the OpenFisca variable names, and the
Claude model name and web search tool version (both can be set with environment variables).
