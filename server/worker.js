// Radar de Passagens — servidor de preços (Cloudflare Worker).
// Guarda o token da Travelpayouts (Aviasales Data API) em segredo e devolve, para o site:
//   ?from=CWB&to=GIG&dep=2027-01-01&ret=2027-01-08[&cabin=economy]
//       → menor preço de cada companhia para essas datas (ou, se não houver, no mês da ida)
//   ?from=CWB&to=GIG&days=7
//       → menor preço de cada um dos próximos 12 meses (usado em "Preço ao longo do ano")
// Os preços vêm de buscas recentes feitas por viajantes no Aviasales: podem estar algumas horas
// defasados e não incluem todas as companhias em todas as rotas.
// Configuração: variável secreta TRAVELPAYOUTS_TOKEN. Opcional: ALLOWED_ORIGINS (lista separada
// por vírgula; padrão "*").

const API = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates";
const CACHE_SECONDS = 1800;
// Códigos que a Travelpayouts usa para empresas do mesmo grupo
const AIRLINE_ALIAS = { JJ: "LA", "4M": "LA", XL: "LA", LP: "LA", "4C": "LA", PZ: "LA" };
const IATA = /^[A-Z]{3}$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
// Código da cidade de aeroportos de cidades com mais de um aeroporto (a fonte tem mais dados por cidade)
const CITY = { GRU: "SAO", CGH: "SAO", VCP: "SAO", GIG: "RIO", SDU: "RIO", JFK: "NYC", EWR: "NYC", EZE: "BUE", AEP: "BUE", NRT: "TYO", HND: "TYO" };

function cors(env, req) {
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get("Origin") || "";
  const allow = allowed.includes("*") ? "*" : (allowed.includes(origin) ? origin : allowed[0]);
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Methods": "GET, OPTIONS", "Vary": "Origin" };
}
const json = (data, status, headers) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${status === 200 ? 600 : 0}`, ...headers },
});

async function tp(env, params, fetchImpl) {
  const q = new URLSearchParams({ currency: "brl", sorting: "price", limit: "1000", unique: "false", ...params, token: env.TRAVELPAYOUTS_TOKEN });
  const r = await fetchImpl(`${API}?${q}`, { headers: { "Accept-Encoding": "gzip" } });
  if (!r.ok) throw Object.assign(new Error(`Travelpayouts respondeu ${r.status}`), { code: "upstream", status: r.status });
  const j = await r.json();
  if (j.success === false) throw Object.assign(new Error(j.error || "erro da Travelpayouts"), { code: "upstream" });
  return Array.isArray(j.data) ? j.data : [];
}
const link = l => (l ? `https://www.aviasales.com${l.startsWith("/") ? "" : "/"}${l}` : "");

// Menor preço por companhia
export function cheapestByAirline(rows) {
  const out = {};
  for (const f of rows) {
    if (!f || !(f.price > 0) || !f.airline) continue;
    const code = AIRLINE_ALIAS[f.airline] || f.airline;
    if (!out[code] || f.price < out[code].price) {
      out[code] = { price: f.price, departure_at: f.departure_at || "", return_at: f.return_at || "",
        transfers: f.transfers ?? null, return_transfers: f.return_transfers ?? null, link: link(f.link) };
    }
  }
  return out;
}

export async function prices(env, p, fetchImpl = fetch) {
  const oneWay = !p.ret;
  const base = { origin: p.from, destination: p.to, one_way: String(oneWay) };
  let scope = "date";
  let rows = await tp(env, { ...base, departure_at: p.dep, ...(oneWay ? {} : { return_at: p.ret }) }, fetchImpl);
  const month = { departure_at: p.dep.slice(0, 7), ...(oneWay ? {} : { return_at: p.ret.slice(0, 7) }) };
  if (!rows.length) {
    // nenhuma busca recente nessas datas exatas: melhor preço no mês da ida (e da volta)
    scope = "month";
    rows = await tp(env, { ...base, ...month }, fetchImpl);
  }
  const cf = CITY[p.from] || p.from, ct = CITY[p.to] || p.to;
  if (!rows.length && (cf !== p.from || ct !== p.to)) {
    // ainda nada: tenta pela cidade (ex.: RIO = Galeão + Santos Dumont)
    scope = "month";
    rows = await tp(env, { ...base, origin: cf, destination: ct, ...month }, fetchImpl);
  }
  return { from: p.from, to: p.to, dep: p.dep, ret: p.ret || "", scope, currency: "BRL", at: new Date().toISOString(), airlines: cheapestByAirline(rows) };
}

export async function months(env, p, now = new Date(), fetchImpl = fetch) {
  const keys = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const oneWay = !(p.days > 0);
  const cf = CITY[p.from] || p.from, ct = CITY[p.to] || p.to, byCity = cf !== p.from || ct !== p.to;
  const res = await Promise.all(keys.map(async k => {
    const q = { departure_at: k, one_way: String(oneWay), limit: "50" };
    let rows = await tp(env, { origin: p.from, destination: p.to, ...q }, fetchImpl).catch(() => []);
    // mês sem dados para o par de aeroportos: tenta pela cidade (ex.: GIG -> RIO)
    if (!rows.length && byCity) rows = await tp(env, { origin: cf, destination: ct, ...q }, fetchImpl).catch(() => []);
    return rows;
  }));
  const out = {};
  res.forEach((rows, i) => {
    // com volta, prefere viagens com duração próxima à escolhida (±3 dias)
    let pool = rows.filter(f => f.price > 0);
    if (!oneWay) {
      const near = pool.filter(f => f.departure_at && f.return_at && Math.abs((Date.parse(f.return_at) - Date.parse(f.departure_at)) / 864e5 - p.days) <= 3);
      if (near.length) pool = near;
    }
    const best = pool.sort((a, b) => a.price - b.price)[0];
    if (best) out[keys[i]] = { price: best.price, airline: AIRLINE_ALIAS[best.airline] || best.airline, departure_at: best.departure_at || "", return_at: best.return_at || "", link: link(best.link) };
  });
  return { from: p.from, to: p.to, days: p.days, currency: "BRL", at: new Date().toISOString(), months: out };
}

// ---------------- Promoções ao vivo (?ofertas=1) ----------------
// Campanhas oficiais da Azul (páginas públicas de ofertas) e promoções novas do Melhores Destinos (RSS).
const UA = "Mozilla/5.0 (compatible; RadarDePassagens/1.0; +https://adissoncosta.github.io/ADISSONCOSTA/)";
export const AZUL_PAGES = ["anoiteceu"];
const OFFERS_SECONDS = 600;
const OFFERS_VERSION = 2;  // aumente ao mudar o formato ou a leitura das ofertas
// Nome da cidade (como aparece nos títulos) -> aeroporto principal
const CITY_CODE = {
  "são paulo": "GRU", "rio de janeiro": "GIG", "rio": "GIG", "brasília": "BSB", "belo horizonte": "CNF", "salvador": "SSA", "recife": "REC",
  "fortaleza": "FOR", "natal": "NAT", "maceió": "MCZ", "joão pessoa": "JPA", "aracaju": "AJU", "belém": "BEL", "manaus": "MAO",
  "são luís": "SLZ", "teresina": "THE", "porto alegre": "POA", "curitiba": "CWB", "florianópolis": "FLN", "navegantes": "NVT",
  "foz do iguaçu": "IGU", "goiânia": "GYN", "cuiabá": "CGB", "campo grande": "CGR", "vitória": "VIX", "palmas": "PMW",
  "fernando de noronha": "FEN", "noronha": "FEN", "porto seguro": "BPS", "campinas": "VCP", "londrina": "LDB", "maringá": "MGF",
  "ribeirão preto": "RAO", "uberlândia": "UDI", "porto velho": "PVH", "macapá": "MCP", "boa vista": "BVB", "rio branco": "RBR",
  "ilhéus": "IOS", "juazeiro do norte": "JDO", "caxias do sul": "CXJ", "chapecó": "XAP", "joinville": "JOI", "petrolina": "PNZ",
  "lisboa": "LIS", "porto": "OPO", "madri": "MAD", "madrid": "MAD", "barcelona": "BCN", "paris": "CDG", "roma": "FCO", "milão": "MXP",
  "londres": "LHR", "frankfurt": "FRA", "amsterdã": "AMS", "zurique": "ZRH", "bruxelas": "BRU", "miami": "MIA", "orlando": "MCO",
  "fort lauderdale": "FLL", "nova york": "JFK", "atlanta": "ATL", "houston": "IAH", "dallas": "DFW", "los angeles": "LAX",
  "toronto": "YYZ", "buenos aires": "EZE", "santiago": "SCL", "montevidéu": "MVD", "lima": "LIM", "cusco": "CUZ", "bogotá": "BOG",
  "cidade do panamá": "PTY", "panamá": "PTY", "cancún": "CUN", "cidade do méxico": "MEX", "assunção": "ASU", "dubai": "DXB", "doha": "DOH",
  "istambul": "IST", "joanesburgo": "JNB", "tóquio": "NRT", "seul": "ICN", "bangkok": "BKK", "punta cana": "PUJ", "bariloche": "BRC",
};
const CITY_MAIN = { SAO: "GRU", RIO: "GIG", BHZ: "CNF", NYC: "JFK", BUE: "EZE", TYO: "NRT", LON: "LHR", PAR: "CDG", MIL: "MXP", ROM: "FCO" };
const AIRLINE_WORDS = [["azul", "AD"], ["gol", "G3"], ["latam", "LA"], ["tap", "TP"], ["american", "AA"], ["copa", "CM"], ["aerolíneas", "AR"], ["avianca", "AV"], ["iberia", "IB"], ["air france", "AF"], ["klm", "KL"], ["delta", "DL"], ["united", "UA"], ["emirates", "EK"], ["qatar", "QR"], ["turkish", "TK"], ["lufthansa", "LH"], ["swiss", "LX"], ["british", "BA"], ["ita airways", "AZ"], ["jetsmart", "JA"], ["sky airline", "H2"]];
const decode = s => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const textTokens = h => decode(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "|")).replace(/\s+/g, " ").replace(/ ?\| ?/g, "|").replace(/\|{2,}/g, "|");
const dmyToIso = d => d.split("/").reverse().join("-");
const brl = n => "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

// Página de campanha da Azul: destaque e trechos com preço ("Origem (XXX)|Para|Destino (YYY)|Ida: dd/mm/aaaa|A partir de|R$ 0,00|...|Visto: ...")
export function parseAzul(html, url) {
  const x = textTokens(html);
  const title = decode((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "Ofertas Azul").trim();
  const hp = x.match(/Passagens a partir de\|R\$\|?(\d[\d.]*)\|(?:ou\|([\d.]+ (?:pontos|milhas))\*?\|)?,(\d{2})/);
  const cond = (x.match(/\|\*([^|]*(?:cart[ãa]o|Itau|Itaú)[^|]*)\|/i) || [])[1] || "";
  const when = (x.match(/\|([^|]*(?:essa noite|só hoje|até \d{1,2}\/\d{1,2}|últimas horas)[^|]*)\|/i) || [])[1] || "";
  const campaign = { name: title, url, price: hp ? `R$ ${hp[1]},${hp[3]}` : "", points: hp && hp[2] ? hp[2] : "", cond: cond.trim(), when: when.trim() };
  const re = /\|([^|]{2,40}?) \(([A-Z]{3})\)\|Para\|([^|]{2,40}?) \(([A-Z]{3})\)\|Ida: (\d{2}\/\d{2}\/\d{4})\|(?:Volta: (\d{2}\/\d{2}\/\d{4})\|)?A partir de\|R\$ ?([\d.]+,\d{2})\|\*?\|?(?:Visto: ([^|]+)\|)?(Só ida|Ida e volta)/g;
  const fares = [], seen = new Set();
  let m;
  while ((m = re.exec(x))) {
    const k = [m[2], m[4], m[5], m[6], m[7]].join();
    if (seen.has(k)) continue;
    seen.add(k);
    fares.push({ fromName: m[1].trim(), from: m[2], toName: m[3].trim(), to: m[4], dep: dmyToIso(m[5]), ret: m[6] ? dmyToIso(m[6]) : "",
      price: +m[7].replace(/\./g, "").replace(",", "."), seen: (m[8] || "").trim(), trip: m[9] });
  }
  return { campaign, fares };
}

// Item do RSS do Melhores Destinos com preço em reais: destino pelo título, origem pela descrição
export function parseMdItem(it) {
  const title = it.title, low = title.toLowerCase();
  const pm = title.match(/a partir de R\$ ?([\d.]+)(?:,(\d{2}))?/i);
  if (!pm) return null;
  const price = +pm[1].replace(/\./g, "") + (pm[2] ? +pm[2] / 100 : 0);
  const after = low.slice(Math.max(0, low.search(/\bpara\b|passagens|voos/)));
  const cityIn = (text) => {
    let best = null;
    for (const [name, code] of Object.entries(CITY_CODE)) {
      const i = text.search(new RegExp(`(^|[^a-zà-ú])${name.replace(/ /g, "\\s+")}([^a-zà-ú]|$)`));
      if (i >= 0 && (!best || i < best.i || (i === best.i && name.length > best.name.length))) best = { i, name, code };
    }
    return best;
  };
  const dest = cityIn(after);
  if (!dest) return null;
  const from = cityIn(((it.description || "").toLowerCase().match(/saindo de ([^,.;]+)/) || [, ""])[1]);
  const airlines = AIRLINE_WORDS.filter(([w]) => new RegExp(`(^|[^a-zà-ú])${w}([^a-zà-ú]|$)`).test(low)).map(([, c]) => c);
  return { title, link: it.link, pub: it.pub, price, roundTrip: /ida e volta/i.test(title), to: dest.code, from: from && from.code !== dest.code ? from.code : "",
    airline: airlines.length === 1 ? airlines[0] : "" };
}
export function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const g = tag => decode((it.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`)) || [, ""])[1]).trim();
    return { title: g("title"), link: g("link"), pub: g("pubDate"), description: g("description").replace(/<[^>]+>/g, " ") };
  });
}

export async function offers(env, fetchImpl = fetch, now = new Date()) {
  const get = async url => { const r = await fetchImpl(url, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR" } }); if (!r.ok) throw new Error(`${url} respondeu ${r.status}`); return r.text(); };
  const errors = [];
  const [azul, md] = await Promise.all([
    Promise.all(AZUL_PAGES.map(p => { const url = `https://passagens.voeazul.com.br/pt/${p}`; return get(url).then(h => parseAzul(h, url)).catch(e => { errors.push(e.message); return null; }); })),
    get("https://www.melhoresdestinos.com.br/feed").then(parseRss).catch(e => { errors.push(e.message); return []; }),
  ]);
  const cash = [], campaigns = [];
  // Azul: os mais baratos, um por destino, para variar as fotos
  for (const page of azul.filter(Boolean)) {
    if (page.campaign.price || page.fares.length) campaigns.push(page.campaign);
    const byDest = new Set();
    for (const f of page.fares.sort((a, b) => a.price - b.price)) {
      const to = CITY_MAIN[f.to] || f.to, city = CITY[to] || to;  // Congonhas e Guarulhos contam como São Paulo
      if (byDest.has(city) || byDest.size >= 8) continue;
      byDest.add(city);
      cash.push({ source: "azul", campaign: page.campaign.name, url: page.campaign.url, from: CITY_MAIN[f.from] || f.from, to: CITY_MAIN[f.to] || f.to,
        fromName: f.fromName, toName: f.toName, price: f.price, dep: f.dep, ret: f.ret, oneWay: f.trip === "Só ida", seen: f.seen, airline: "AD" });
    }
  }
  // Melhores Destinos: promoções dos últimos 3 dias com preço e destino; companhia mais barata pelo Aviasales
  const recent = md.map(parseMdItem).filter(d => d && (!d.pub || now - Date.parse(d.pub) < 3 * 864e5)).slice(0, 6);
  const monthsAhead = [1, 2, 3].map(i => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
  await Promise.all(recent.map(async d => {
    // companhia mais barata do trecho nos próximos meses (para mostrar uma só, a do menor preço)
    const origin = CITY[d.from] || d.from || (d.to === "GRU" || d.to === "CGH" ? "RIO" : "SAO");
    for (const month of monthsAhead) {
      if (d.airline || !env.TRAVELPAYOUTS_TOKEN) break;
      const rows = await tp(env, { origin, destination: CITY[d.to] || d.to, departure_at: month, one_way: "false", limit: "30" }, fetchImpl).catch(() => []);
      const best = rows.filter(r => r.price > 0 && r.airline).sort((a, b) => a.price - b.price)[0];
      if (best) d.airline = AIRLINE_ALIAS[best.airline] || best.airline;
    }
    cash.push({ source: "md", title: d.title, url: d.link, pub: d.pub, from: d.from, to: d.to, price: d.price, roundTrip: d.roundTrip, airline: d.airline });
  }));
  return { at: now.toISOString(), campaigns, cash, errors };
}

export function parse(url) {
  const g = k => (url.searchParams.get(k) || "").trim();
  const from = g("from").toUpperCase(), to = g("to").toUpperCase();
  if (!IATA.test(from) || !IATA.test(to) || from === to) return { error: "bad_route", message: "Informe origem e destino com códigos IATA diferentes (ex.: from=CWB&to=GIG)." };
  if (url.searchParams.has("days")) {
    const days = Number(g("days"));
    if (!Number.isInteger(days) || days < 0 || days > 60) return { error: "bad_days", message: "days deve ser de 0 a 60." };
    return { mode: "months", from, to, days };
  }
  const dep = g("dep"), ret = g("ret"), cabin = g("cabin") || "economy";
  if (!DAY.test(dep) || (ret && (!DAY.test(ret) || ret < dep))) return { error: "bad_dates", message: "Use dep=AAAA-MM-DD e, se houver volta, ret=AAAA-MM-DD depois da ida." };
  if (cabin !== "economy") return { error: "cabin", message: "A fonte de preços só tem tarifas de classe econômica." };
  return { mode: "prices", from, to, dep, ret };
}

export default {
  async fetch(req, env, ctx) {
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...h, "Access-Control-Max-Age": "86400" } });
    if (req.method !== "GET") return json({ error: "method" }, 405, h);
    if (!env.TRAVELPAYOUTS_TOKEN) return json({ error: "no_token", message: "Configure a variável secreta TRAVELPAYOUTS_TOKEN no Worker." }, 500, h);
    const url = new URL(req.url);
    if (url.searchParams.has("ofertas")) {
      const cache = typeof caches !== "undefined" ? caches.default : null;
      const key = new Request(`https://cache.radar/ofertas-v${OFFERS_VERSION}`);  // nova versão = cache novo
      if (cache) { const hit = await cache.match(key); if (hit) return new Response(hit.body, { status: 200, headers: { ...Object.fromEntries(hit.headers), ...h } }); }
      const data = await offers(env);
      if (cache && ctx && data.cash.length) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${OFFERS_SECONDS}` } })));
      return json(data, 200, { ...h, "Cache-Control": `public, max-age=${OFFERS_SECONDS}` });
    }
    const p = parse(url);
    if (p.error) return json(p, 400, h);
    // cache compartilhado por 30 min por trecho e datas
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const key = new Request(`https://cache.radar/${p.mode}?${[...url.searchParams].sort().map(([k, v]) => `${k}=${v}`).join("&")}`);
    if (cache) { const hit = await cache.match(key); if (hit) return new Response(hit.body, { status: 200, headers: { ...Object.fromEntries(hit.headers), ...h } }); }
    try {
      const data = p.mode === "months" ? await months(env, p) : await prices(env, p);
      const res = json(data, 200, h);
      if (cache && ctx) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${CACHE_SECONDS}` } })));
      return res;
    } catch (e) {
      return json({ error: e.code || "error", message: e.message }, 502, h);
    }
  },
};
