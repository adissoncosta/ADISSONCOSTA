// Alertas de promoção, disparados pelo agendamento do Worker (a cada 10 min). Envia por qualquer canal
// configurado (segredos do Worker); sem nenhum, nada é enviado:
//   WhatsApp pela Green API: GREENAPI_INSTANCE, GREENAPI_TOKEN [, GREENAPI_URL] e WHATSAPP_PHONE
//     (número que recebe, com DDI) ou WHATSAPP_CHAT (id de um grupo, ex. 120363...@g.us)
//   Telegram: TELEGRAM_TOKEN [, TELEGRAM_CHAT] — sem TELEGRAM_CHAT, usa quem mandou /start para o bot
//   WhatsApp pelo CallMeBot: WHATSAPP_PHONE e CALLMEBOT_APIKEY
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
    `*${d.from ? `${up(city(d.from))} ✈️ ` : "✈️ PARA "}${up(city(d.to))}*`];
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

const clean = (r, body) => `${r.status}: ${String(body).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160)}`;
export const channels = env => [
  env.GREENAPI_INSTANCE && env.GREENAPI_TOKEN && (env.WHATSAPP_CHAT || env.WHATSAPP_PHONE) && "greenapi",
  env.TELEGRAM_TOKEN && "telegram",
  env.CALLMEBOT_APIKEY && env.WHATSAPP_PHONE && "callmebot",
].filter(Boolean);

// WhatsApp pela Green API (WhatsApp conectado por QR code no painel da Green API)
async function sendGreen(env, text, fetchImpl) {
  const chatId = env.WHATSAPP_CHAT || `${String(env.WHATSAPP_PHONE).replace(/\D/g, "")}@c.us`;
  const base = (env.GREENAPI_URL || "https://api.green-api.com").replace(/\/+$/, "");
  const r = await fetchImpl(`${base}/waInstance${env.GREENAPI_INSTANCE}/sendMessage/${env.GREENAPI_TOKEN}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, message: text }) });
  const body = await r.text().catch(() => "");
  if (!r.ok || !/idMessage/.test(body)) throw new Error(`Green API respondeu ${clean(r, body)}`);
}
// Telegram: negrito do WhatsApp (*texto*) vira <b>texto</b>
const tgHtml = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*([^*\n]+)\*/g, "<b>$1</b>");
async function telegramChat(env, store, fetchImpl) {
  if (env.TELEGRAM_CHAT) return env.TELEGRAM_CHAT;
  const saved = store && store.chat;
  if (saved) return saved;
  // ainda sem chat: procura quem mandou mensagem (/start) para o bot
  const r = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/getUpdates`);
  const j = await r.json().catch(() => ({}));
  const m = (j.result || []).map(u => u.message || u.channel_post || u.my_chat_member).filter(Boolean).pop();
  if (!m || !m.chat) throw new Error("Telegram: mande /start para o seu bot para ativar os alertas");
  if (store) store.chat = String(m.chat.id);
  return String(m.chat.id);
}
async function sendTelegram(env, text, fetchImpl, tg) {
  const chat_id = await telegramChat(env, tg, fetchImpl);
  const r = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text: tgHtml(text), parse_mode: "HTML", disable_web_page_preview: true }) });
  const body = await r.text().catch(() => "");
  if (!r.ok || !/"ok":true/.test(body)) throw new Error(`Telegram respondeu ${clean(r, body)}`);
}
async function sendCallMeBot(env, text, fetchImpl) {
  const q = new URLSearchParams({ phone: env.WHATSAPP_PHONE, text, apikey: env.CALLMEBOT_APIKEY });
  const r = await fetchImpl(`https://api.callmebot.com/whatsapp.php?${q}`);
  const body = await r.text().catch(() => "");
  if (!r.ok || /error|invalid|not allowed|is full/i.test(body.slice(0, 400)) && !/queued|sent/i.test(body)) throw new Error(`CallMeBot respondeu ${clean(r, body)}`);
}
// Envia por todos os canais configurados; vale como enviado se ao menos um deu certo
export async function sendAlert(env, text, fetchImpl = fetch, tg = null) {
  const errs = [];
  let ok = 0;
  for (const c of channels(env)) {
    try {
      if (c === "greenapi") await sendGreen(env, text, fetchImpl);
      else if (c === "telegram") await sendTelegram(env, text, fetchImpl, tg);
      else await sendCallMeBot(env, text, fetchImpl);
      ok++;
    } catch (e) { errs.push(e.message); }
  }
  if (!ok) throw new Error(errs.join(" | ") || "nenhum canal configurado");
  return errs;
}

// Uma rodada: lê as promoções, avisa as novas, guarda o que foi avisado.
// store: {get(): Promise<{[key]: timestamp}>, put(obj)}; deps: {offers, lookup, fetchImpl}
export async function runAlerts(env, store, deps, now = new Date()) {
  if (!channels(env).length) return { sent: 0, skipped: "nenhum canal configurado" };
  const data = await deps.offers();
  const seen = (await store.get()) || {};
  // chat do Telegram descoberto pelo /start fica guardado junto (chave "_tg")
  const tg = { chat: seen._tg || "" };
  delete seen._tg;
  const save = () => store.put(tg.chat ? { ...seen, _tg: tg.chat } : seen);
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
    try { errors.push(...await sendAlert(env, text, deps.fetchImpl, tg)); sent++; } catch (e) { errors.push(e.message); }
    if (!sent) { await save(); return { sent, errors }; }
    for (const a of fresh) if (a !== live) seen[a.key] = t;
    // a campanha ao vivo vai em seguida, porque é por tempo limitado
    if (live) fresh.splice(0, fresh.length, live); else fresh.length = 0;
  }
  for (const a of fresh.slice(0, MAX_PER_RUN)) {
    try {
      const text = a.campaign ? campaignMessage(a.campaign, deps.lookup ? await usualPrices(a.campaign.fares || [], deps.lookup) : {}) : dealMessage(a.deal);
      errors.push(...await sendAlert(env, text, deps.fetchImpl, tg));
      seen[a.key] = t; sent++;
    } catch (e) { errors.push(e.message); break; }
  }
  await save();
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
