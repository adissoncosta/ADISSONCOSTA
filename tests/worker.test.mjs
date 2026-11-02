// Testes do servidor de preços (server/worker.js) com a API da Travelpayouts simulada.
import worker, { cheapestByAirline, prices, months, parse } from "../server/worker.js";
let failed = 0;
const assert = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const env = { TRAVELPAYOUTS_TOKEN: "t0k3n", ALLOWED_ORIGINS: "https://adissoncosta.github.io" };
const resp = data => ({ ok: true, status: 200, json: async () => ({ success: true, data, currency: "brl" }) });

// menor preço por companhia, agrupando LATAM Brasil (JJ) em LATAM (LA)
const best = cheapestByAirline([
  { airline: "G3", price: 520, departure_at: "2027-01-01T06:00:00-03:00", link: "/search/A" },
  { airline: "JJ", price: 480, departure_at: "2027-01-01T09:00:00-03:00", link: "/search/B", transfers: 0 },
  { airline: "LA", price: 610 }, { airline: "G3", price: 455, link: "/search/C" }, { airline: "AD", price: 0 }, { price: 100 },
]);
assert(best.LA.price === 480 && best.G3.price === 455 && !best.AD && Object.keys(best).length === 2, "cheapest per airline, JJ counted as LATAM: " + JSON.stringify(Object.fromEntries(Object.entries(best).map(([k, v]) => [k, v.price]))));
assert(best.LA.link === "https://www.aviasales.com/search/B", "links made absolute");

// datas exatas; sem resultado, cai para o mês
let calls = [];
const fake = handler => async (u) => { const q = Object.fromEntries(new URL(u).searchParams); calls.push(q); return resp(handler(q)); };
calls = [];
let r = await prices(env, { from: "CWB", to: "GIG", dep: "2027-01-01", ret: "2027-01-08" }, fake(q => q.departure_at === "2027-01-01" ? [{ airline: "AD", price: 399 }] : []));
assert(r.scope === "date" && r.airlines.AD.price === 399 && calls.length === 1, "exact dates: " + JSON.stringify(r.airlines));
assert(calls[0].token === "t0k3n" && calls[0].currency === "brl" && calls[0].return_at === "2027-01-08" && calls[0].one_way === "false", "query sends token, BRL, return date, round trip");
calls = [];
r = await prices(env, { from: "CWB", to: "GIG", dep: "2027-01-01", ret: "" }, fake(q => q.departure_at === "2027-01" ? [{ airline: "G3", price: 210 }] : []));
assert(r.scope === "month" && r.airlines.G3.price === 210 && calls[1].departure_at === "2027-01" && calls[1].one_way === "true" && !("return_at" in calls[1]), "falls back to the departure month (one way)");

// 12 meses, preferindo duração próxima da escolhida
calls = [];
const m = await months(env, { from: "GRU", to: "LIS", days: 10 }, new Date("2026-11-02T12:00:00Z"), fake(q => q.departure_at === "2026-12" ? [
  { airline: "TP", price: 2900, departure_at: "2026-12-05T10:00:00Z", return_at: "2026-12-07T10:00:00Z" },
  { airline: "LA", price: 3400, departure_at: "2026-12-05T10:00:00Z", return_at: "2026-12-15T10:00:00Z" }] : []));
assert(calls.length === 12 && calls[0].departure_at === "2026-11" && calls[11].departure_at === "2027-10", "asks the next 12 months");
assert(m.months["2026-12"].price === 3400 && m.months["2026-12"].airline === "LA" && Object.keys(m.months).length === 1, "month price prefers trips near the chosen length: " + JSON.stringify(m.months));

// validação
assert(parse(new URL("https://x/?from=cwb&to=gig&dep=2027-01-01&ret=2027-01-08")).mode === "prices", "parses price query (lowercase codes ok)");
assert(parse(new URL("https://x/?from=CWB&to=CWB&dep=2027-01-01")).error === "bad_route", "rejects same origin and destination");
assert(parse(new URL("https://x/?from=CWB&to=GIG&dep=2027-01-08&ret=2027-01-01")).error === "bad_dates", "rejects return before departure");
assert(parse(new URL("https://x/?from=CWB&to=GIG&dep=2027-01-01&cabin=business")).error === "cabin", "business cabin explained (economy only)");
assert(parse(new URL("https://x/?from=GRU&to=LIS&days=10")).mode === "months", "parses months query used by the yearly chart");

// HTTP: CORS, falta de token, erro da API
const res1 = await worker.fetch(new Request("https://w/?from=CWB&to=GIG&dep=2027-01-01", { method: "OPTIONS", headers: { Origin: "https://adissoncosta.github.io" } }), env, null);
assert(res1.status === 204 && res1.headers.get("Access-Control-Allow-Origin") === "https://adissoncosta.github.io", "CORS preflight allows the site");
const res2 = await worker.fetch(new Request("https://w/?from=CWB&to=GIG&dep=2027-01-01"), {}, null);
assert(res2.status === 500 && (await res2.json()).error === "no_token", "explains missing token");
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
const res3 = await worker.fetch(new Request("https://w/?from=CWB&to=GIG&dep=2027-01-01", { headers: { Origin: "https://evil.example" } }), env, null);
const b3 = await res3.json();
assert(res3.status === 502 && b3.error === "upstream" && /401/.test(b3.message) && res3.headers.get("Access-Control-Allow-Origin") === "https://adissoncosta.github.io", "upstream error reported; other origins not allowed");
globalThis.fetch = async () => resp([{ airline: "LA", price: 333, link: "/s" }]);
const res4 = await worker.fetch(new Request("https://w/?from=CWB&to=GIG&dep=2027-01-01&ret=2027-01-08"), env, null);
const b4 = await res4.json();
assert(res4.status === 200 && b4.airlines.LA.price === 333 && b4.scope === "date", "GET returns prices per airline");
globalThis.fetch = realFetch;
if (failed) { console.log(failed + " falha(s)"); process.exit(1); }
