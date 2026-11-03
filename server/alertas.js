// Alertas de promoção no WhatsApp (CallMeBot), disparados pelo agendamento do Worker (a cada 10 min).
// Segredos: WHATSAPP_PHONE (seu número com DDI, ex. +5541999998888) e CALLMEBOT_APIKEY (chave que o
// CallMeBot manda no WhatsApp). Sem eles, nada é enviado.
// Cada promoção é avisada uma vez só: as chaves já avisadas ficam guardadas (Durable Object "Alertas").

export const SITE = "https://adissoncosta.github.io/ADISSONCOSTA/";
const MAX_PER_RUN = 4;          // mensagens por rodada (o restante vai na próxima)
const KEEP_DAYS = 45;           // por quanto tempo lembrar o que já foi avisado

const NAMES = {
  GRU: "São Paulo", CGH: "São Paulo", VCP: "Campinas", GIG: "Rio de Janeiro", SDU: "Rio de Janeiro", BSB: "Brasília", CNF: "Belo Horizonte",
  SSA: "Salvador", REC: "Recife", FOR: "Fortaleza", NAT: "Natal", MCZ: "Maceió", JPA: "João Pessoa", AJU: "Aracaju", BEL: "Belém",
  MAO: "Manaus", SLZ: "São Luís", THE: "Teresina", POA: "Porto Alegre", CWB: "Curitiba", FLN: "Florianópolis", NVT: "Navegantes",
  IGU: "Foz do Iguaçu", GYN: "Goiânia", CGB: "Cuiabá", CGR: "Campo Grande", VIX: "Vitória", PMW: "Palmas", FEN: "Fernando de Noronha",
  BPS: "Porto Seguro", LDB: "Londrina", MGF: "Maringá", RAO: "Ribeirão Preto", UDI: "Uberlândia", PVH: "Porto Velho", MCP: "Macapá",
  BVB: "Boa Vista", RBR: "Rio Branco", IOS: "Ilhéus", JDO: "Juazeiro do Norte", CXJ: "Caxias do Sul", XAP: "Chapecó", JOI: "Joinville",
  PNZ: "Petrolina", LIS: "Lisboa", OPO: "Porto", MAD: "Madri", BCN: "Barcelona", CDG: "Paris", FCO: "Roma", MXP: "Milão", LHR: "Londres",
  FRA: "Frankfurt", AMS: "Amsterdã", ZRH: "Zurique", BRU: "Bruxelas", MIA: "Miami", MCO: "Orlando", FLL: "Fort Lauderdale", JFK: "Nova York",
  ATL: "Atlanta", IAH: "Houston", DFW: "Dallas", LAX: "Los Angeles", YYZ: "Toronto", EZE: "Buenos Aires", SCL: "Santiago", MVD: "Montevidéu",
  LIM: "Lima", CUZ: "Cusco", BOG: "Bogotá", PTY: "Cidade do Panamá", CUN: "Cancún", MEX: "Cidade do México", ASU: "Assunção", DXB: "Dubai",
  DOH: "Doha", IST: "Istambul", JNB: "Joanesburgo", NRT: "Tóquio", ICN: "Seul", BKK: "Bangkok", PUJ: "Punta Cana", BRC: "Bariloche",
};
const BR = new Set(["GRU", "CGH", "VCP", "GIG", "SDU", "BSB", "CNF", "SSA", "REC", "FOR", "NAT", "MCZ", "JPA", "AJU", "BEL", "MAO", "SLZ", "THE",
  "POA", "CWB", "FLN", "NVT", "IGU", "GYN", "CGB", "CGR", "VIX", "PMW", "FEN", "BPS", "LDB", "MGF", "RAO", "UDI", "PVH", "MCP", "BVB", "RBR",
  "IOS", "JDO", "CXJ", "XAP", "JOI", "PNZ"]);
const CIA = { AD: "Azul", G3: "Gol", LA: "Latam", TP: "TAP", AA: "American Airlines", CM: "Copa", AR: "Aerolíneas Argentinas", AV: "Avianca",
  IB: "Iberia", AF: "Air France", KL: "KLM", DL: "Delta", UA: "United", EK: "Emirates", QR: "Qatar", TK: "Turkish", LH: "Lufthansa",
  LX: "Swiss", BA: "British Airways", AZ: "ITA Airways", JA: "JetSMART", H2: "Sky Airline" };
const PROGRAM = { AD: "Azul Fidelidade", G3: "Smiles", LA: "Latam Pass" };
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const up = s => String(s || "").toLocaleUpperCase("pt-BR");
const city = (code, name) => name || NAMES[code] || code;
export const brl = v => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
export const milhas = n => `${Number(n).toLocaleString("pt-BR")} milhas`;
const toMiles = t => String(t || "").replace(/\bpontos?\b/gi, "milhas");
const dmy = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "";
// Brasília = UTC-3
export const brNow = (now = new Date()) => { const d = new Date(now.getTime() - 3 * 3600e3); return { ymd: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; };

// Janela da campanha no dia de hoje (Brasília): "das 18h às 23h59" -> {start, end} em minutos; sem horário -> null
export function campWindow(when) {
  const m = /das (\d{1,2})h(\d{2})? (?:às|as|até) (\d{1,2})h(\d{2})?/i.exec(when || "");
  if (m) return { start: +m[1] * 60 + +(m[2] || 0), end: +m[3] * 60 + +(m[4] || 0) };
  if (/só hoje|essa noite|hoje|últimas horas/i.test(when || "")) return { start: 0, end: 24 * 60 - 1 };
  return null;
}

// Mensagem da campanha oficial (ex.: Anoiteceu Azul), com os trechos mais baratos
export function campaignMessage(c, usual = {}) {
  const top = (c.fares || []).slice(0, 5);
  const lines = [`🔥 *PROMOÇÃO AO VIVO · AZUL* 🔥`, `*${up(c.name)}*`];
  if (c.when) lines.push(`⏰ ${c.when}`);
  if (c.price) lines.push(`💰 Passagens a partir de *${c.price}*${c.points ? ` ou *${toMiles(c.points)}*` : ""}`);
  for (const f of top) {
    const u = usual[`${f.from}-${f.to}`];
    lines.push("", `*${up(city(f.from, f.fromName))} ✈️ ${up(city(f.to, f.toName))}*`, `⭕ *${brl(f.price)}* ${f.oneWay ? "só ida" : "ida e volta"}`,
      `🗓️ Ida em ${dmy(f.dep)}${f.ret && !f.oneWay ? ` · volta ${dmy(f.ret)}` : ""}`);
    if (u && u.price > f.price * 1.1) lines.push(`💸 Fora da promoção, o mais barato nessa rota em ${u.month} sai por ${brl(u.price)}`);
  }
  const more = (c.fares || []).length - top.length;
  if (more > 0) lines.push("", `➕ Mais ${more} trechos com preço no site`);
  if (c.cond) lines.push("", `ℹ️ ${c.cond}`);
  lines.push("", `👉 Comprar na Azul: ${c.url}`, `📲 Todos os preços: ${SITE}`);
  return lines.join("\n");
}

// Mensagem de uma promoção publicada pelo Melhores Destinos (em reais ou em milhas)
export function dealMessage(d) {
  const nat = (!d.from || BR.has(d.from)) && BR.has(d.to);
  const cia = d.airline && CIA[d.airline];
  const lines = [`🔥 *${d.miles ? "EMISSÃO" : "PROMOÇÃO"} ${nat ? "NACIONAL" : "INTERNACIONAL"}* 🔥`, "",
    `*${d.from ? `${up(city(d.from))} ✈️ ` : "✈️ "}${up(city(d.to))}*`];
  if (cia) lines.push(`Cia: *${up(cia)}*`);
  lines.push("", d.miles
    ? `⭕ A partir de *${milhas(d.miles)}*${d.airline && PROGRAM[d.airline] ? ` ${PROGRAM[d.airline]}` : ""} o trecho + taxas`
    : `⭕ A partir de *${brl(d.price)}*${d.roundTrip ? " ida e volta" : ""}`);
  if (d.miles && d.price) lines.push(`💰 Ou ${brl(d.price)} pagando em dinheiro`);
  lines.push("", `📰 ${d.title}`, "", `👉 Detalhes e datas: ${d.url}`, `📲 Compare preços: ${SITE}`);
  return lines.join("\n");
}

// Lista do que pode ser avisado agora: [{key, text, campaign?}]
export function pendingAlerts(data, now = new Date()) {
  const out = [], br = brNow(now);
  for (const c of data.campaigns || []) {
    if (!c.price && !(c.fares || []).length) continue;
    const w = campWindow(c.when);
    if (w && !(br.min >= w.start && br.min <= w.end)) continue;  // fora do horário: não avisa
    out.push({ key: `camp:${c.name}:${w ? br.ymd : c.price}`, campaign: c });
  }
  const keys = new Set();
  for (const d of [...(data.miles || []), ...(data.cash || []).filter(d => d.source === "md")]) {
    if (!d.url || !d.to || keys.has(d.url)) continue;  // a mesma notícia pode vir nas duas listas
    keys.add(d.url);
    out.push({ key: `md:${d.url}`, deal: d });
  }
  return out;
}

// Menor preço comum (fora da campanha) de cada trecho no mês da viagem, para comparar
async function usualPrices(fares, lookup) {
  const out = {};
  await Promise.all(fares.slice(0, 5).map(async f => {
    try {
      const p = await lookup(f);
      if (p) out[`${f.from}-${f.to}`] = { price: p, month: `${MES[+f.dep.slice(5, 7) - 1]}/${f.dep.slice(2, 4)}` };
    } catch (_) {}
  }));
  return out;
}

export async function sendWhatsApp(env, text, fetchImpl = fetch) {
  const q = new URLSearchParams({ phone: env.WHATSAPP_PHONE, text, apikey: env.CALLMEBOT_APIKEY });
  const r = await fetchImpl(`https://api.callmebot.com/whatsapp.php?${q}`);
  const body = await r.text().catch(() => "");
  if (!r.ok || /error|invalid|not allowed/i.test(body.slice(0, 400)) && !/queued|sent/i.test(body)) throw new Error(`CallMeBot respondeu ${r.status}: ${body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160)}`);
  return true;
}

// Uma rodada: lê as promoções, avisa as novas, guarda o que foi avisado.
// store: {get(): Promise<{[key]: timestamp}>, put(obj)}; deps: {offers, lookup, fetchImpl}
export async function runAlerts(env, store, deps, now = new Date()) {
  if (!env.WHATSAPP_PHONE || !env.CALLMEBOT_APIKEY) return { sent: 0, skipped: "sem WHATSAPP_PHONE/CALLMEBOT_APIKEY" };
  const data = await deps.offers();
  const seen = (await store.get()) || {};
  const first = !Object.keys(seen).length;
  const t = now.getTime();
  for (const k of Object.keys(seen)) if (t - seen[k] > KEEP_DAYS * 864e5) delete seen[k];
  const fresh = pendingAlerts(data, now).filter(a => !seen[a.key]);
  let sent = 0;
  const errors = [];
  if (first) {
    // primeira vez: confirma que funciona e não dispara tudo o que já estava no ar
    const live = fresh.find(a => a.campaign);
    const text = [`✅ *Alertas do Radar de Passagens ativados!*`, "", "Você vai receber aqui as novas promoções de passagens assim que forem encontradas.",
      `Agora há ${fresh.length} ${fresh.length === 1 ? "promoção" : "promoções"} no ar${live ? `, incluindo *${live.campaign.name}* (ao vivo)` : ""}.`, "", `📲 ${SITE}`].join("\n");
    try { await sendWhatsApp(env, text, deps.fetchImpl); sent++; } catch (e) { errors.push(e.message); }
    if (!sent) return { sent, errors };
    for (const a of fresh) if (a !== live) seen[a.key] = t;
    // a campanha ao vivo vai em seguida, porque é por tempo limitado
    if (live) fresh.splice(0, fresh.length, live); else fresh.length = 0;
  }
  for (const a of fresh.slice(0, MAX_PER_RUN)) {
    try {
      const text = a.campaign ? campaignMessage(a.campaign, deps.lookup ? await usualPrices(a.campaign.fares || [], deps.lookup) : {}) : dealMessage(a.deal);
      await sendWhatsApp(env, text, deps.fetchImpl);
      seen[a.key] = t; sent++;
    } catch (e) { errors.push(e.message); break; }
  }
  await store.put(seen);
  return { sent, pending: Math.max(0, fresh.length - sent), errors };
}

// Durable Object que guarda as chaves já avisadas (armazenamento SQLite do plano gratuito)
export class Alertas {
  constructor(state) { this.state = state; }
  async fetch(req) {
    if (req.method === "PUT") { await this.state.storage.put("seen", await req.json()); return new Response("ok"); }
    return new Response(JSON.stringify((await this.state.storage.get("seen")) || {}), { headers: { "Content-Type": "application/json" } });
  }
}
export function doStore(ns) {
  const stub = ns.get(ns.idFromName("principal"));
  return {
    get: async () => (await stub.fetch("https://alertas/seen")).json(),
    put: async obj => { await stub.fetch("https://alertas/seen", { method: "PUT", body: JSON.stringify(obj) }); },
  };
}
