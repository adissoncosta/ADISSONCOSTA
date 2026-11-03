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

// ---------------- alertas no WhatsApp ----------------
const A = await import("../server/alertas.js");
const mi = parseMdItem({ title: "Jalapão! Voos diretos da Latam para Palmas a partir de 11 mil milhas o trecho", link: "https://md/palmas", pub: "" });
assert(mi && mi.miles === 11000 && mi.to === "PMW" && mi.airline === "LA" && mi.price === 0, "miles deal parsed from the feed: " + JSON.stringify(mi));
assert(parseMdItem({ title: "Bom demais! Peça o cartão Latam Pass Itaú e ganhe até 80 mil milhas bônus", link: "x" }) === null, "card bonus posts are not flight deals");
const mx = parseMdItem({ title: "Voos do Recife para Fernando de Noronha a partir de R$ 125 ou 9 mil pontos Azul o trecho mais taxas", link: "y" });
assert(mx && mx.price === 125 && mx.miles === 9000 && mx.to === "FEN" && mx.airline === "AD", "cash + miles deal: " + JSON.stringify(mx));
const camp = { name: "Anoiteceu Azul", url: "https://passagens.voeazul.com.br/pt/anoiteceu", price: "R$ 219,90", points: "8.000 pontos", cond: "Consulte condições.", when: "É só essa noite, das 18h às 23h59!",
  fares: Array.from({ length: 8 }, (_, i) => ({ from: "GRU", to: ["GIG", "CWB", "POA", "FLN", "REC", "SSA", "BSB", "FOR"][i], fromName: "São Paulo", price: 214.53 + i * 10, dep: "2027-03-04", ret: "", oneWay: true })) };
const msg = A.campaignMessage(camp, { "GRU-GIG": { price: 480, month: "mar/27" } });
assert(/PROMOÇÃO AO VIVO/.test(msg) && /\*SÃO PAULO ✈️ RIO DE JANEIRO\*/.test(msg) && /⭕ \*R\$ 214,53\* só ida/.test(msg) && /Ida em 04\/03\/2027/.test(msg)
  && /8\.000 milhas/.test(msg) && !/pontos/.test(msg) && /R\$ 480/.test(msg) && /Mais 3 trechos/.test(msg) && msg.includes(A.SITE), "campaign message like the example (R$, milhas, comparison, links):\n" + msg.split("\n").slice(0, 9).join(" / "));
const dm = A.dealMessage({ url: "https://md/palmas", title: "Jalapão!", to: "PMW", from: "GRU", miles: 11000, airline: "LA" });
assert(/EMISSÃO NACIONAL/.test(dm) && /SÃO PAULO ✈️ PALMAS/.test(dm) && /Cia: \*LATAM\*/.test(dm) && /11\.000 milhas\* Latam Pass o trecho/.test(dm), "miles deal message: " + dm.split("\n").slice(0, 6).join(" / "));
assert(/PROMOÇÃO INTERNACIONAL/.test(A.dealMessage({ url: "u", title: "t", to: "LIS", price: 3599, roundTrip: true })) && /R\$ 3\.599\* ida e volta/.test(A.dealMessage({ url: "u", title: "t", to: "LIS", price: 3599, roundTrip: true })), "international cash deal message");
// horário da campanha (Brasília): 19h dentro, 12h fora
const data = { campaigns: [camp], cash: [{ source: "md", url: "https://md/sc", title: "SC", to: "FLN", price: 278, roundTrip: true }, { source: "azul", to: "GIG", price: 214 }], miles: [{ url: "https://md/palmas", title: "J", to: "PMW", miles: 11000 }, { url: "https://md/sc", to: "FLN", miles: 5000 }] };
assert(A.pendingAlerts(data, new Date("2026-11-02T22:00:00Z")).map(a => a.key).join() === "camp:Anoiteceu Azul:2026-11-02,md:https://md/palmas,md:https://md/sc", "pending alerts: live campaign + feed deals, no duplicates");
assert(!A.pendingAlerts(data, new Date("2026-11-02T15:00:00Z")).some(a => a.campaign), "campaign outside its hours is not alerted");
// rodadas: 1ª confirma e manda só a campanha ao vivo; 2ª nada; nova promoção -> 1 mensagem
const sentMsgs = [];
const cmb = async u => { const q = new URL(u).searchParams; sentMsgs.push(q.get("text")); return { ok: true, status: 200, text: async () => "Message queued. You will receive it in a few seconds." }; };
let saved = {};
const store = { get: async () => ({ ...saved }), put: async o => { saved = { ...o }; } };
const envA = { WHATSAPP_PHONE: "+5541999990000", CALLMEBOT_APIKEY: "123456" };
const deps = { offers: async () => data, lookup: async () => 480, fetchImpl: cmb };
let ra = await A.runAlerts(envA, store, deps, new Date("2026-11-02T22:00:00Z"));
assert(ra.sent === 2 && /Alertas do Radar de Passagens ativados/.test(sentMsgs[0]) && /3 promoções/.test(sentMsgs[0]) && /ANOITECEU AZUL/.test(sentMsgs[1]) && Object.keys(saved).length === 3, "first run: confirmation + live campaign, existing deals marked as seen: " + JSON.stringify(ra));
ra = await A.runAlerts(envA, store, deps, new Date("2026-11-02T22:10:00Z"));
assert(ra.sent === 0 && sentMsgs.length === 2, "nothing repeated on the next run");
data.cash.push({ source: "md", url: "https://md/new", title: "Novidade", to: "SSA", from: "GRU", price: 399, roundTrip: true, airline: "G3" });
ra = await A.runAlerts(envA, store, deps, new Date("2026-11-02T22:20:00Z"));
assert(ra.sent === 1 && /SÃO PAULO ✈️ SALVADOR/.test(sentMsgs[2]) && /Cia: \*GOL\*/.test(sentMsgs[2]) && /R\$ 399\* ida e volta/.test(sentMsgs[2]), "new deal sent once: " + sentMsgs[2].split("\n").slice(0, 6).join(" / "));
ra = await A.runAlerts(envA, store, deps, new Date("2026-11-03T22:00:00Z"));
assert(ra.sent === 1 && /ANOITECEU AZUL/.test(sentMsgs[3]), "campaign alerted again the next night");
const failSend = async () => ({ ok: true, status: 200, text: async () => "APIKey is invalid" });
saved = {}; ra = await A.runAlerts(envA, store, { ...deps, fetchImpl: failSend }, new Date("2026-11-02T22:00:00Z"));
assert(ra.sent === 0 && /APIKey is invalid/.test(ra.errors[0]) && !Object.keys(saved).length, "send failure reported, nothing marked as sent");
assert((await A.runAlerts({}, store, deps)).sent === 0, "no secrets: nothing sent");
// WhatsApp pela Green API
const calls2 = [];
const green = async (u, o) => { calls2.push({ u, body: o && o.body && JSON.parse(o.body) }); return { ok: true, status: 200, text: async () => '{"idMessage":"3EB0"}' }; };
await A.sendAlert({ GREENAPI_INSTANCE: "7103000001", GREENAPI_TOKEN: "tok", WHATSAPP_PHONE: "+55 (41) 99999-0000" }, "*Oi*", green);
assert(calls2[0].u === "https://api.green-api.com/waInstance7103000001/sendMessage/tok" && calls2[0].body.chatId === "5541999990000@c.us" && calls2[0].body.message === "*Oi*", "Green API: sends to the phone chat: " + JSON.stringify(calls2[0]));
await A.sendAlert({ GREENAPI_INSTANCE: "1", GREENAPI_TOKEN: "t", GREENAPI_URL: "https://7103.api.greenapi.com/", WHATSAPP_CHAT: "120363000@g.us" }, "x", green);
assert(calls2[1].u === "https://7103.api.greenapi.com/waInstance1/sendMessage/t" && calls2[1].body.chatId === "120363000@g.us", "Green API: custom host and group chat");
let gErr = ""; try { await A.sendAlert({ GREENAPI_INSTANCE: "1", GREENAPI_TOKEN: "t", WHATSAPP_PHONE: "1" }, "x", async () => ({ ok: false, status: 401, text: async () => "Unauthorized" })); } catch (e) { gErr = e.message; }
assert(/Green API respondeu 401/.test(gErr), "Green API error reported: " + gErr);
// Telegram: descobre o chat pelo /start e guarda; negrito em HTML
const tgCalls = [];
const tgf = async (u, o) => { tgCalls.push({ u, body: o && o.body && JSON.parse(o.body) });
  if (u.endsWith("/getUpdates")) return { ok: true, status: 200, json: async () => ({ ok: true, result: [{ message: { text: "/start", chat: { id: 987654, type: "private" } } }] }) };
  return { ok: true, status: 200, text: async () => '{"ok":true,"result":{}}' }; };
saved = {}; sentMsgs.length = 0;
const envT = { TELEGRAM_TOKEN: "123:abc" };
ra = await A.runAlerts(envT, store, { ...deps, fetchImpl: tgf }, new Date("2026-11-02T22:00:00Z"));
const tgSend = tgCalls.filter(c => c.u.endsWith("/sendMessage"));
assert(ra.sent === 2 && tgSend.length === 2 && tgSend[0].body.chat_id === "987654" && tgSend[0].body.parse_mode === "HTML" && /<b>Alertas do Radar de Passagens ativados!<\/b>/.test(tgSend[0].body.text) && saved._tg === "987654", "Telegram: chat found by /start, saved, bold as HTML: " + JSON.stringify(ra));
const nUpd = tgCalls.filter(c => c.u.endsWith("/getUpdates")).length;
data.cash.push({ source: "md", url: "https://md/tg", title: "Nova", to: "REC", price: 450, roundTrip: true });
ra = await A.runAlerts(envT, store, { ...deps, fetchImpl: tgf }, new Date("2026-11-02T22:30:00Z"));
assert(ra.sent === 1 && tgCalls.filter(c => c.u.endsWith("/getUpdates")).length === nUpd && saved._tg === "987654" && !A.pendingAlerts(data).some(a => a.key === "_tg"), "Telegram: saved chat reused, not treated as an alert");
let tErr = ""; try { await A.sendAlert({ TELEGRAM_TOKEN: "x" }, "y", async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: [] }) })); } catch (e) { tErr = e.message; }
assert(/mande \/start/.test(tErr), "Telegram without /start explains what to do");
assert(/is full/.test(await A.sendAlert({ WHATSAPP_PHONE: "1", CALLMEBOT_APIKEY: "k", TELEGRAM_TOKEN: "123:abc", TELEGRAM_CHAT: "5" }, "z", async u => u.includes("callmebot") ? { ok: true, status: 200, text: async () => "This Bot is full" } : { ok: true, status: 200, text: async () => '{"ok":true}' }).then(e => e.join()).catch(e => "throw " + e.message)), "one channel failing does not block the others");
const offM = await offers(env, async u => ({ ok: true, status: 200, text: async () => u.includes("milhas/feed")
  ? '<rss><item><title>Jalapão! Voos diretos da Latam para Palmas a partir de 11 mil milhas o trecho</title><link>https://md/palmas</link><pubDate></pubDate><description></description></item></rss>'
  : u.includes("feed") ? "<rss></rss>" : "<html></html>", json: async () => ({ success: true, data: [] }) }));
assert(offM.miles.length === 1 && offM.miles[0].miles === 11000 && offM.miles[0].to === "PMW", "offers include miles deals from the miles feed");
if (failed) { console.log(failed + " falha(s)"); process.exit(1); }
