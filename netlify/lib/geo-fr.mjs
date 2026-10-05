// Postal code -> INSEE commune code(s). Users only ever type postal codes; INSEE codes stay internal.
//
// Lyon, Paris and Marseille are split into arrondissements with their own INSEE codes, which follow
// a fixed rule, so they are converted without any network call:
//   Lyon       69001-69009  ->  69381-69389
//   Paris      75001-75020  ->  75101-75120   (75116 is also Paris 16e)
//   Marseille  13001-13016  ->  13201-13216
// Any other postal code is looked up in the national address service (Base Adresse Nationale).
// One postal code can cover several communes (often in the countryside), so a list is returned.
import { fetchWithTimeout, readBody } from "./common.mjs";

const ORD = (n) => n === 1 ? "1er" : `${n}e`;

export function cityArrondissement(postcode) {
  const pc = String(postcode || "").trim();
  let m;
  if ((m = /^6900([1-9])$/.exec(pc))) { const n = +m[1]; return [{ insee: `6938${n}`, name: `Lyon ${ORD(n)}`, postcode: pc }]; }
  if ((m = /^750(\d\d)$/.exec(pc)) && +m[1] >= 1 && +m[1] <= 20) { const n = +m[1]; return [{ insee: `751${m[1]}`, name: `Paris ${ORD(n)}`, postcode: pc }]; }
  if (pc === "75116") return [{ insee: "75116", name: "Paris 16e", postcode: pc }];
  if ((m = /^130(\d\d)$/.exec(pc)) && +m[1] >= 1 && +m[1] <= 16) { const n = +m[1]; return [{ insee: `132${m[1]}`, name: `Marseille ${ORD(n)}`, postcode: pc }]; }
  return null;
}

const BAN = ["https://data.geopf.fr/geocodage/search", "https://api-adresse.data.gouv.fr/search/"];

export async function postalToInsee(postcode) {
  const pc = String(postcode || "").trim();
  if (!/^\d{5}$/.test(pc) && !/^2[AB]\d{3}$/i.test(pc)) throw Object.assign(new Error("A French postal code has 5 digits, for example 69002"), { status: 400 });
  const fixed = cityArrondissement(pc);
  if (fixed) return { postcode: pc, communes: fixed, source: "arrondissement rule" };
  let last = null;
  for (const base of BAN) {
    try {
      const res = await fetchWithTimeout(`${base}?${new URLSearchParams({ q: pc, type: "municipality", limit: "50" })}`, {}, 8000);
      const { data } = await readBody(res);
      if (!res.ok || !data) { last = `${new URL(base).hostname} answered ${res.status}`; continue; }
      const seen = new Map();
      for (const f of data.features || []) {
        const p = f.properties || {};
        if (p.postcode === pc && p.citycode && !seen.has(p.citycode))
          seen.set(p.citycode, { insee: p.citycode, name: p.city || p.name, postcode: pc, lat: f.geometry?.coordinates?.[1], lon: f.geometry?.coordinates?.[0] });
      }
      if (!seen.size) throw Object.assign(new Error(`No commune found for postal code ${pc}`), { status: 404 });
      return { postcode: pc, communes: [...seen.values()], source: new URL(base).hostname };
    } catch (e) { if (e.status) throw e; last = e.message; }
  }
  throw Object.assign(new Error(`The address service could not be reached (${last})`), { status: 502 });
}
