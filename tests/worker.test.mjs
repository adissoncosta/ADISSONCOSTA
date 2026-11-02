// Testes do servidor de preços (server/worker.js) com a API da Travelpayouts simulada.
import worker, { viaOf, totalOf, cheapestByAirline, prices, months, parse, parseAzul, parseRss, parseMdItem, offers } from "../server/worker.js";
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
assert(viaOf("/search/CWB0912CNF1?t=G317968050001796817600000210CWBCGHCNF_1f09&search_date=1").join() === "CGH" && viaOf("/x?t=LA17952189001795222800000065GRUGIG_6c").length === 0 && viaOf("") .length === 0, "layover airports read from the search link");
assert(totalOf("/search/CWB0912CNF1?t=G317968050001796817600000210CWBCGHCNF_1f09") === 210 && totalOf("") === 0, "total trip time (with layover) read from the search link");
assert(cheapestByAirline([{ airline: "G3", price: 479, duration_to: 145, link: "/search/CWB0912CNF1?t=G317968050001796817600000210CWBCGHCNF_1f09" }]).G3.duration === 210, "one-way duration includes the layover");
const det = cheapestByAirline([{ airline: "G3", price: 1222, departure_at: "2026-11-07T14:40:00-03:00", return_at: "", transfers: 1, duration: 210, duration_to: 210, origin_airport: "CNF", destination_airport: "CWB", flight_number: "1460" }]).G3;
assert(det.duration === 210 && det.origin_airport === "CNF" && det.destination_airport === "CWB" && det.flight_number === "G31460" && det.transfers === 1 && det.departure_at.startsWith("2026-11-07T14:40"), "flight details for the list (time, duration, airports, flight number): " + JSON.stringify(det));

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

calls = [];
r = await prices(env, { from: "CWB", to: "GIG", dep: "2027-01-01", ret: "2027-01-08" }, fake(q => q.destination === "RIO" ? [{ airline: "G3", price: 450 }] : []));
assert(calls.length === 3 && calls[2].origin === "CWB" && calls[2].destination === "RIO" && calls[2].departure_at === "2027-01" && r.airlines.G3.price === 450 && r.scope === "month", "then tries the city code (GIG -> RIO)");
calls = [];
await prices(env, { from: "CWB", to: "FOR", dep: "2027-01-01", ret: "2027-01-08" }, fake(() => []));
assert(calls.length === 4 && !calls.some(q => q.destination !== "FOR"), "no city retry for single-airport cities (then 2 later months)");
calls = [];
r = await prices(env, { from: "CWB", to: "CNF", dep: "2026-11-07", ret: "" }, fake(q => q.departure_at === "2026-12" ? [{ airline: "G3", price: 479, departure_at: "2026-12-09T08:00:00-03:00" }] : []));
assert(r.scope === "later" && r.airlines.G3.price === 479 && calls[2].departure_at === "2026-12" && !("return_at" in calls[2]), "no fare in the chosen month: nearest of the next months (scope later)");
// 12 meses, preferindo duração próxima da escolhida
calls = [];
const m = await months(env, { from: "GRU", to: "LIS", days: 10 }, new Date("2026-11-02T12:00:00Z"), fake(q => q.departure_at === "2026-12" ? [
  { airline: "TP", price: 2900, departure_at: "2026-12-05T10:00:00Z", return_at: "2026-12-07T10:00:00Z" },
  { airline: "LA", price: 3400, departure_at: "2026-12-05T10:00:00Z", return_at: "2026-12-15T10:00:00Z" }] : []));
const byAirport = calls.filter(q => q.origin === "GRU");
assert(byAirport.length === 12 && byAirport[0].departure_at === "2026-11" && byAirport[11].departure_at === "2027-10", "asks the next 12 months");
assert(m.months["2026-12"].price === 3400 && m.months["2026-12"].airline === "LA" && Object.keys(m.months).length === 1, "month price prefers trips near the chosen length: " + JSON.stringify(m.months));

calls = [];
const mc = await months(env, { from: "MAO", to: "GIG", days: 7 }, new Date("2026-11-02T12:00:00Z"), fake(q => q.destination === "RIO" && q.departure_at === "2027-02" ? [{ airline: "AD", price: 1500, departure_at: "2027-02-02T10:00:00Z", return_at: "2027-02-09T10:00:00Z" }] : []));
assert(calls.length === 24 && mc.months["2027-02"].price === 1500, "12-month view also retries by city code (" + calls.length + " calls)");
// promoções ao vivo: página de campanha da Azul (trecho do HTML público) e RSS do Melhores Destinos
const AZUL_HTML = `<html><head><title>Anoiteceu Azul</title></head><body><h1>Quando anoitece,</h1><p>É só essa noite, das 18h às 23h59!</p>
<div>Passagens a partir de</div><span>R$</span><span>219</span><span>ou</span><span>8.000 pontos*</span><span>,90</span><p>*No cartão Azul Itau. Consulte condições.</p>
<div><span>São Paulo (SAO)</span><span>Para</span><span>Rio de Janeiro (RIO)</span><p>Ida: 04/03/2027</p><p>A partir de</p><p>R$214,53</p><sup>*</sup><p>Visto: 3 horas atrás</p><p>Só ida</p>/<p>Econômica</p></div>
<div><span>São Paulo (SAO)</span><span>Para</span><span>Rio de Janeiro (RIO)</span><p>Ida: 04/03/2027</p><p>A partir de</p><p>R$214,53</p><sup>*</sup><p>Visto: 3 horas atrás</p><p>Só ida</p></div>
<div><span>Macapá (MCP)</span><span>Para</span><span>Belém (BEL)</span><p>Ida: 29/04/2027</p><p>A partir de</p><p>R$1.240,92</p><sup>*</sup><p>Visto: 1 dia atrás</p><p>Só ida</p></div></body></html>`;
const az = parseAzul(AZUL_HTML, "https://passagens.voeazul.com.br/pt/anoiteceu");
assert(az.campaign.price === "R$ 219,90" && az.campaign.points === "8.000 pontos" && /Itau/.test(az.campaign.cond) && /essa noite/.test(az.campaign.when), "Azul campaign headline: " + JSON.stringify(az.campaign));
assert(az.fares.length === 2 && az.fares[0].from === "SAO" && az.fares[0].to === "RIO" && az.fares[0].dep === "2027-03-04" && az.fares[0].price === 214.53 && az.fares[1].price === 1240.92 && az.fares[0].seen === "3 horas atrás", "Azul fares parsed, duplicates removed: " + JSON.stringify(az.fares.map(f => f.from + f.to + f.price)));
const RSS = `<rss><channel><item><title><![CDATA[Santa Catarina bem barato! Passagens para Florianópolis ou Navegantes a partir de R$ 278 ida e volta]]></title><link>https://www.melhoresdestinos.com.br/promocao/sc</link><pubDate>Mon, 02 Nov 2026 09:00:00 +0000</pubDate><description><![CDATA[<p>Encontramos passagens para Florianópolis a partir de R$ 278 saindo de Porto Alegre, e mais.</p>]]></description></item>
<item><title>Europa em voo direto da LATAM a partir de R$ 3.599 ida e volta para Lisboa</title><link>https://md/2</link><pubDate>Mon, 02 Nov 2026 08:00:00 +0000</pubDate><description>Ofertas</description></item>
<item><title>Gol reduz pacotes de internet</title><link>https://md/3</link><pubDate>Mon, 02 Nov 2026 07:00:00 +0000</pubDate><description>x</description></item></channel></rss>`;
const its = parseRss(RSS), md1 = parseMdItem(its[0]), md2 = parseMdItem(its[1]);
assert(md1 && md1.to === "FLN" && md1.from === "POA" && md1.price === 278 && md1.roundTrip && !md1.airline, "RSS deal: destination from title, origin from text: " + JSON.stringify(md1));
assert(md2 && md2.to === "LIS" && md2.airline === "LA" && md2.price === 3599 && parseMdItem(its[2]) === null, "RSS deal: single airline in title; items without price ignored");
calls = [];
const off = await offers(env, async (u) => {
  if (u.includes("voeazul")) return { ok: true, status: 200, text: async () => AZUL_HTML };
  if (u.includes("melhoresdestinos")) return { ok: true, status: 200, text: async () => RSS };
  const q = Object.fromEntries(new URL(u).searchParams); calls.push(q);
  return resp(q.destination === "FLN" ? [{ airline: "G3", price: 300 }, { airline: "AD", price: 280 }] : []);
}, new Date("2026-11-02T12:00:00Z"));
const offAz = off.cash.filter(c => c.source === "azul"), offMd = off.cash.filter(c => c.source === "md");
assert(off.campaigns[0].fares.length === 2 && off.campaigns[0].fares[0].from === "GRU" && off.campaigns[0].fares[0].price === 214.53 && off.campaigns[0].fares[1].fromName === "Macapá", "campaign carries its full fare list, cheapest first");
assert(off.campaigns.length === 1 && offAz.length === 2 && offAz[0].from === "GRU" && offAz[0].to === "GIG" && offAz[0].airline === "AD", "offers: Azul fares (city codes -> main airport)");
assert(offMd.length === 2 && offMd.find(c => c.to === "FLN").airline === "AD" && calls[0].origin === "POA" && calls[0].departure_at === "2026-12", "offers: RSS deals get the cheapest airline from fares: " + JSON.stringify(offMd.map(c => c.to + ":" + c.airline)));
const realFetch2 = globalThis.fetch;
globalThis.fetch = async (u) => u.includes("voeazul") ? { ok: true, status: 200, text: async () => AZUL_HTML } : u.includes("melhoresdestinos") ? { ok: true, status: 200, text: async () => RSS } : resp([]);
const r5 = await worker.fetch(new Request("https://w/?ofertas=1", { headers: { Origin: "https://adissoncosta.github.io" } }), env, null);
const b5 = await r5.json();
globalThis.fetch = realFetch2;
assert(r5.status === 200 && b5.campaigns.length === 1 && b5.cash.length >= 3 && r5.headers.get("Access-Control-Allow-Origin") === "https://adissoncosta.github.io", "GET ?ofertas=1 returns live deals");

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
