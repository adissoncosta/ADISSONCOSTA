// Cloudflare Worker do Emissor de NFS-e pelo WhatsApp.
//   POST /whatsapp  → webhook da Green API (mensagens recebidas)
//   POST /focus     → gatilho da Focus NFe (nota autorizada/recusada)
//   POST /configurar → cadastra o gatilho da Focus para cada empresa (uma vez, depois de publicar)
//   GET  /          → situação do serviço
// Agendamento a cada minuto: consulta as notas que ainda esperam resposta.
// Webhooks exigem o segredo WEBHOOK_TOKEN no cabeçalho Authorization (Bearer) ou em ?token=.
import { DurableObject } from "cloudflare:workers";
import { receberMensagem, finalizar, verificarPendentes, empresas } from "./emissor.js";
import * as focus from "./focus.js";
import * as wa from "./whatsapp.js";

// Dados públicos do CNPJ (Receita Federal) pela BrasilAPI, para preencher o cliente sozinho
export async function buscarCnpj(cnpj, fetchImpl = fetch) {
  const r = await fetchImpl(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { headers: { "User-Agent": "emissor-nfse" } });
  if (!r.ok) return null;
  const j = await r.json();
  const fone = String(j.ddd_telefone_1 || "").replace(/\D/g, "");
  return {
    nome: j.razao_social || j.nome_fantasia || null,
    email: j.email ? String(j.email).toLowerCase() : null,
    codigo_municipio: j.codigo_municipio_ibge || null,
    cep: j.cep || null,
    logradouro: [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(" ") || null,
    numero_endereco: j.numero || null,
    bairro: j.bairro || null,
    telefone: fone.length === 11 && fone[2] === "9" ? "55" + fone : null,   // só celular
  };
}

// Um único Durable Object guarda tudo e processa um evento por vez (sem corrida entre mensagens)
export class Emissor extends DurableObject {
  ctxEmissor() {
    const env = this.env;
    return {
      env,
      store: {
        get: k => this.ctx.storage.get(k),
        put: (k, v) => this.ctx.storage.put(k, v),
        delete: k => this.ctx.storage.delete(k),
      },
      wa: {
        texto: (tel, msg) => wa.enviarTexto(env, tel, msg),
        arquivo: (tel, url, nome, legenda) => wa.enviarArquivo(env, tel, url, nome, legenda),
      },
      focus: {
        emitir: (ref, dps) => focus.emitir(env, ref, dps),
        consultar: ref => focus.consultar(env, ref),
        cancelar: (ref, just) => focus.cancelar(env, ref, just),
      },
      buscarCnpj: cnpj => buscarCnpj(cnpj),
      agora: () => Date.now(),
    };
  }
  mensagem(msg) { return receberMensagem(this.ctxEmissor(), msg); }
  focusGatilho(dados) { return finalizar(this.ctxEmissor(), dados.ref, dados); }
  verificar() { return verificarPendentes(this.ctxEmissor()); }
}

const emissor = env => env.EMISSOR.get(env.EMISSOR.idFromName("principal"));
const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

export function autorizado(req, env) {
  if (!env.WEBHOOK_TOKEN) return false;
  const url = new URL(req.url);
  const h = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return h === env.WEBHOOK_TOKEN || url.searchParams.get("token") === env.WEBHOOK_TOKEN;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
      const faltam = ["FOCUS_TOKEN", "GREENAPI_INSTANCE", "GREENAPI_TOKEN", "WEBHOOK_TOKEN", "PRESTADORES"].filter(k => !env[k]);
      let qtd = 0;
      try { qtd = empresas(env).length; } catch (e) { faltam.push("PRESTADORES válido"); }
      return json({ servico: "Emissor de NFS-e pelo WhatsApp", ambiente: env.FOCUS_AMBIENTE === "producao" ? "producao" : "homologacao", empresas: qtd, faltam });
    }
    if (req.method !== "POST") return json({ erro: "não encontrado" }, 404);
    if (!autorizado(req, env)) return json({ erro: "não autorizado" }, 401);

    // Responde 200 mesmo com erro interno (fica no log): evita que o webhook seja reenviado sem parar
    if (url.pathname === "/whatsapp") {
      const msg = wa.lerWebhook(await req.json().catch(() => null));
      if (msg) await emissor(env).mensagem(msg).catch(e => console.error("whatsapp:", e.message));
      return json({ ok: true });
    }
    if (url.pathname === "/focus") {
      const dados = await req.json().catch(() => null);
      if (dados?.ref) await emissor(env).focusGatilho(dados).catch(e => console.error("focus:", e.message));
      return json({ ok: true });
    }
    if (url.pathname === "/configurar") {
      const destino = `${url.origin}/focus`;
      const out = [];
      for (const e of empresas(env)) out.push({ cnpj: e.cnpj, resposta: await focus.cadastrarGatilho(env, e.cnpj, destino) });
      return json({ gatilho: destino, empresas: out });
    }
    return json({ erro: "não encontrado" }, 404);
  },
  async scheduled(_evento, env) {
    await emissor(env).verificar();
  },
};
