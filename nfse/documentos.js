// Utilidades: CPF/CNPJ, valores em reais, datas no horário de Brasília e leitura do pedido em texto livre.

export const digitos = s => String(s ?? "").replace(/\D/g, "");

function dvCpf(n) {
  let s = 0;
  for (let i = 0; i < n.length; i++) s += Number(n[i]) * (n.length + 1 - i);
  const r = (s * 10) % 11;
  return r === 10 ? 0 : r;
}
export function cpfValido(v) {
  const n = digitos(v);
  if (n.length !== 11 || /^(\d)\1+$/.test(n)) return false;
  return dvCpf(n.slice(0, 9)) === Number(n[9]) && dvCpf(n.slice(0, 10)) === Number(n[10]);
}

function dvCnpj(n) {
  const pesos = n.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const s = pesos.reduce((t, p, i) => t + Number(n[i]) * p, 0);
  const r = s % 11;
  return r < 2 ? 0 : 11 - r;
}
export function cnpjValido(v) {
  const n = digitos(v);
  if (n.length !== 14 || /^(\d)\1+$/.test(n)) return false;
  return dvCnpj(n.slice(0, 12)) === Number(n[12]) && dvCnpj(n.slice(0, 13)) === Number(n[13]);
}

// "123.456.789-09" → { tipo: "cpf", numero: "12345678909" }; inválido → null
export function documento(v) {
  const n = digitos(v);
  if (n.length === 11 && cpfValido(n)) return { tipo: "cpf", numero: n };
  if (n.length === 14 && cnpjValido(n)) return { tipo: "cnpj", numero: n };
  return null;
}

export const formatarDoc = n => n.length === 14
  ? n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
  : n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

// "R$ 1.500,50", "1500", "1,5 mil", "2.000" → número em reais (2 casas); inválido → null
export function valor(texto) {
  let s = String(texto ?? "").toLowerCase().replace(/r\$|reais|real/g, "").replace(/\s+/g, " ").trim();
  let mult = 1;
  if (/\bmil$/.test(s)) { mult = 1000; s = s.replace(/\s*mil$/, ""); }
  s = s.replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const v = s.includes(",") && s.includes(".")
    ? (s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""))
    : s.includes(",") ? s.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  const n = Math.round(Number(v) * mult * 100) / 100;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const brl = v => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Data e hora de Brasília (UTC-3, sem horário de verão desde 2019)
export function agoraBrasilia(ms = Date.now()) {
  const iso = new Date(ms - 3 * 3600e3).toISOString().slice(0, 19);
  return { dataHora: iso + "-0300", data: iso.slice(0, 10) };
}

const RE_CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/;
const RE_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;
const RE_VALOR = /(?:r\$\s*)?\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b(?:\s*mil\b)?|(?:r\$\s*)?\b\d+(?:[.,]\d{1,2})?\b(?:\s*mil\b)?(?:\s*reais\b)?/i;
const PONTAS = /^(?:\s|[-:,;.]|\b(?:o|a|os|as|de|do|da|para|pra|pro|no valor|valor|referente(?: a| ao| à)?|ref\.?|servi[çc]o|cnpj|cpf|reais|r\$)\b)+|(?:\s|[-:,;]|\b(?:de|para|pra|pro|no valor|valor|cnpj|cpf)\b)+$/gi;

// Lê um pedido em texto livre: "nota 1.500 para 12.345.678/0001-95 consultoria de marketing"
export function lerPedido(texto) {
  let resto = " " + String(texto ?? "").replace(/^\s*(?:emitir|emite|emita|gerar|gera|nova)?\s*(?:uma\s+)?(?:nota(?:\s+fiscal)?|nfs-?e|nf)\b/i, "") + " ";
  const out = {};
  const m = resto.match(RE_CNPJ) || resto.match(RE_CPF);
  if (m) {
    const d = documento(m[0]);
    if (d) { out.doc = d; resto = resto.replace(m[0], " "); } else out.docInvalido = m[0].trim();
  }
  const mv = resto.match(RE_VALOR);
  if (mv) {
    const v = valor(mv[0]);
    if (v) { out.valor = v; resto = resto.replace(mv[0], " "); }
  }
  resto = resto.replace(/\s+/g, " ");
  const ref = resto.match(/\b(?:referente\s+(?:a|ao|à|aos|às)|ref\.?:?|descri[çc][aã]o:?)\s+(.+)$/i);
  const desc = (ref ? ref[1] : resto).trim().replace(PONTAS, "").trim();
  if (desc.length >= 4) out.descricao = desc.charAt(0).toUpperCase() + desc.slice(1);
  return out;
}

// telefone brasileiro → "5541999998888"; inválido → null
export function telefone(v) {
  let n = digitos(v);
  if (n.length === 10 || n.length === 11) n = "55" + n;
  return /^55\d{10,11}$/.test(n) ? n : null;
}
