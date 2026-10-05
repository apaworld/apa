// GET /.netlify/functions/benefits-openfisca?scope=lyon&age=30&salary=1200&rent=650&household=alone&children=0
// Estimates French social benefits with OpenFisca (the open-source engine behind mes-aides / 1jeune1solution).
// Lyon: housing aid uses Lyon's zone (commune 69123). France: housing aid depends on the commune, so it is
// skipped and only national benefits (RSA, prime d'activité, family allowances) are estimated.
// Docs: https://openfisca.org/doc/  ·  API: https://api.fr.openfisca.org/latest/
import { getScope, result, fail, fetchWithTimeout, clip, readBody } from "../lib/common.mjs";

const SOURCE = "benefits-openfisca";
import { env } from "../lib/common.mjs";
const API = env("OPENFISCA_URL") || "https://api.fr.openfisca.org/latest/calculate";

const monthStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const lastMonths = (end, n) => { const out = []; for (let i = n; i >= 0; i--) { const d = new Date(end); d.setMonth(d.getMonth() - i); out.push(monthStr(d)); } return out; };

function buildSituation({ age, salary, partnerSalary, rent, household, children }, month, withHousing) {
  const months = lastMonths(new Date(month + "-15"), 12);           // 12 past months + the target month
  const perMonth = (v) => Object.fromEntries(months.map(m => [m, v]));
  const birthYear = new Date(month + "-15").getFullYear() - age;
  const individus = { demandeur: { date_naissance: { ETERNITY: `${birthYear}-01-01` }, salaire_net: perMonth(salary) } };
  const parents = ["demandeur"], enfants = [];
  if (household === "couple") {
    individus.conjoint = { date_naissance: { ETERNITY: `${birthYear}-01-01` }, salaire_net: perMonth(partnerSalary) };
    parents.push("conjoint");
  }
  for (let i = 0; i < children; i++) {
    const id = `enfant_${i + 1}`;
    individus[id] = { date_naissance: { ETERNITY: `${new Date(month + "-15").getFullYear() - 6 - 2 * i}-06-01` } };
    enfants.push(id);
  }
  const want = { [month]: null };
  const famille = { parents, enfants, rsa: want, ppa: want, af: want };
  const menage = { personne_de_reference: ["demandeur"], enfants };
  if (household === "couple") menage.conjoint = ["conjoint"];
  if (withHousing) {
    famille.aide_logement = want;
    Object.assign(menage, {
      depcom: { [month]: "69123" },
      loyer: { [month]: rent },
      statut_occupation_logement: { [month]: "locataire_vide" }
    });
  }
  return {
    individus,
    familles: { famille_1: famille },
    foyers_fiscaux: { foyer_fiscal_1: { declarants: parents, personnes_a_charge: enfants } },
    menages: { menage_1: menage }
  };
}

async function calculate(situation) {
  const res = await fetchWithTimeout(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(situation) }, 20000);
  const { data, text } = await readBody(res);
  return { ok: res.ok && !!data, status: res.status, data, text };
}

const LABELS = {
  rsa: ["RSA (revenu de solidarité active)", "https://www.service-public.fr/particuliers/vosdroits/N19775"],
  ppa: ["Prime d'activité", "https://www.service-public.fr/particuliers/vosdroits/F2882"],
  af: ["Allocations familiales", "https://www.service-public.fr/particuliers/vosdroits/F13213"],
  aide_logement: ["Aide au logement (APL / ALS / ALF)", "https://www.service-public.fr/particuliers/vosdroits/N20360"]
};

export default async (req) => {
  const started = Date.now();
  const url = new URL(req.url);
  const scope = getScope(url);
  const num = (k, d, min, max) => Math.min(max, Math.max(min, Number(url.searchParams.get(k) ?? d) || 0));
  const input = {
    age: num("age", 30, 18, 99),
    salary: num("salary", 1200, 0, 20000),
    partnerSalary: num("partnerSalary", 0, 0, 20000),
    rent: num("rent", 650, 0, 5000),
    household: url.searchParams.get("household") === "couple" ? "couple" : "alone",
    children: num("children", 0, 0, 6)
  };
  const withHousing = scope.key === "lyon";
  let month = url.searchParams.get("period") || monthStr(new Date());

  try {
    let r = await calculate(buildSituation(input, month, withHousing));
    let note = withHousing ? "Housing aid estimated for a rented flat in Lyon." :
      "France-wide: housing aid depends on the commune and is not estimated. Use scope=lyon to include it.";
    if (!r.ok) {
      // The public API may not have next year's rules yet: retry with the same month one year earlier.
      const d = new Date(month + "-15"); d.setFullYear(d.getFullYear() - 1); const older = monthStr(d);
      const r2 = await calculate(buildSituation(input, older, withHousing));
      if (!r2.ok) return fail(SOURCE, `OpenFisca answered ${r.status}`, clip(r.text, 600));
      r = r2; note += ` Rules for ${month} were not available, so ${older} rules were used.`; month = older;
    }
    const fam = r.data.familles?.famille_1 || {};
    const items = Object.keys(LABELS).filter(k => fam[k]).map(k => {
      const amount = Math.round(Number(fam[k][month] || 0) * 100) / 100;
      return {
        title: LABELS[k][0],
        subtitle: amount > 0 ? `≈ ${amount.toFixed(2)} € / month` : "Probably not eligible with these figures",
        location: withHousing ? "Lyon" : "France",
        date: month, url: LABELS[k][1],
        extra: { amount_eur_per_month: amount, variable: k }
      };
    });
    return result({
      source: SOURCE, scopeRequested: scope.key, scopeApplied: withHousing ? "Lyon (commune 69123)" : "France (national rules)",
      note: note + " Estimates only; the CAF decides the real amount.", items,
      raw: { input, month, response: r.data }, started, wantRaw: url.searchParams.has("raw")
    });
  } catch (e) {
    return fail(SOURCE, e.name === "AbortError" ? "OpenFisca took too long" : e.message);
  }
};
