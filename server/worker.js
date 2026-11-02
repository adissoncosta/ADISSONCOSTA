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
