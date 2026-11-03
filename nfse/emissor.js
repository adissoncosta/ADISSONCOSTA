// Emissor de NFS-e pelo WhatsApp: conversa com quem pede a nota, emite pela Focus NFe e devolve o PDF.
//
// Quem pode falar com o emissor:
//   • dono: número listado em "telefones" da empresa (PRESTADORES). Emite para qualquer cliente,
//     cadastra clientes, cancela notas.
//   • cliente final: número cadastrado pelo dono e ligado a UM CPF/CNPJ. Só pede notas em que ele mesmo
//     é o tomador; a nota volta para o WhatsApp dele e o dono recebe uma cópia. Cada CPF/CNPJ tem
//     um único número autorizado.
//   • qualquer outro número é ignorado.
//
// ctx = {
//   env,                                    segredos e variáveis (PRESTADORES, FOCUS_*, GREENAPI_*)
//   store: { get, put, delete },            armazenamento (Durable Object no Cloudflare; Map nos testes)
//   wa: { texto(tel, msg), arquivo(tel, url, nome, legenda) },
//   focus: { emitir(ref, dps), consultar(ref), cancelar(ref, justificativa) },
//   buscarCnpj(cnpj) → dados do cliente ou null,
//   agora() → ms
// }
import { documento, formatarDoc, valor as lerValor, brl, agoraBrasilia, lerPedido, lerCadastro, telefone as lerTelefone } from "./documentos.js";
import { montarDps, errosTexto, urlArquivo } from "./focus.js";

const CONVERSA_EXPIRA_MS = 2 * 3600e3;    // pedido parado por 2 h é esquecido
const PENDENTE_DESISTE_MS = 48 * 3600e3;  // nota sem resposta da prefeitura por 48 h é avisada e largada
const MAX_NOTAS_LISTA = 200;

const SIM = /^\s*(sim|s|ok|confirmo|confirma|pode|pode emitir|emitir|emite|isso|certo|👍)\s*[.!]*\s*$/i;
const NAO = /^\s*(n[aã]o|n|nao quero|cancela|cancelar|errado)\s*[.!]*\s*$/i;

export const AJUDA_CLIENTE = (nome, empresa, cli) => [
  `Olá${nome ? ", " + nome.split(" ")[0] : ""}! Aqui você pede as notas fiscais de serviço de *${empresa.nome || formatarDoc(empresa.cnpj)}*.`,
  `As notas saem para ${cli.tomador.nome} – ${cli.tomador.tipo.toUpperCase()} ${formatarDoc(cli.tomador.numero)}.`,
  "",
  "*nota* – pedir uma nota (eu pergunto o que faltar)",
  "Ou tudo de uma vez: _nota 1.500,00 consultoria de outubro_",
  "*notas* – suas últimas notas",
  "*sair* – desistir do pedido em andamento",
].join("\n");

export const AJUDA = (nome) => [
  `Olá${nome ? ", " + nome.split(" ")[0] : ""}! Sou o emissor de notas fiscais de serviço (NFS-e).`,
  "",
  "*nota* – emitir uma nota (eu pergunto o que faltar)",
  "Ou tudo de uma vez: _nota 1.500,00 para 12.345.678/0001-95 consultoria em marketing_",
  "*notas* – últimas notas emitidas",
  "*cancelar nota 123* – cancelar a nota nº 123",
  "*sair* – desistir do pedido em andamento",
  "",
  "*Clientes que pedem a própria nota:*",
  "*cadastrar cliente 41 99999-8888 12.345.678/0001-95* – só esse WhatsApp poderá pedir notas para esse CNPJ (para CPF, inclua o nome no fim)",
  "*limite 41 99999-8888 5.000* – valor máximo por nota desse cliente (_limite 41 99999-8888 sem_ tira o limite)",
  "*clientes* – lista os clientes cadastrados",
  "*remover cliente 41 99999-8888*",
].join("\n");

// ---------- configuração das empresas (prestadores) ----------

export function empresas(env) {
  let lista = env.PRESTADORES;
  if (typeof lista === "string") {
    try { lista = JSON.parse(lista); } catch { throw new Error("PRESTADORES não é um JSON válido"); }
  }
  return (Array.isArray(lista) ? lista : []).map(e => ({
    ...e,
    cnpj: String(e.cnpj || "").replace(/\D/g, ""),
    telefones: (e.telefones || []).map(t => lerTelefone(t)).filter(Boolean),
  }));
}

export const empresaDoTelefone = (env, tel) => empresas(env).find(e => e.telefones.includes(tel)) || null;
const empresaDoCnpj = (env, cnpj) => empresas(env).find(e => e.cnpj === cnpj) || null;

// ---------- armazenamento ----------

const K = {
  conversa: tel => `conversa:${tel}`,
  nota: ref => `nota:${ref}`,
  notas: cnpj => `notas:${cnpj}`,
  tomador: (cnpj, doc) => `tomador:${cnpj}:${doc}`,
  dps: (cnpj, serie) => `dps:${cnpj}:${serie}`,
  cliente: tel => `cliente:${tel}`,
  clienteDoc: (cnpj, doc) => `clientedoc:${cnpj}:${doc}`,
  clientes: cnpj => `clientes:${cnpj}`,
  pendentes: "pendentes",
  vistos: "vistos",
};

async function adicionarLista(store, chave, item, max) {
  const l = (await store.get(chave)) || [];
  if (!l.includes(item)) l.push(item);
  await store.put(chave, l.slice(-max));
}
async function removerLista(store, chave, item) {
  const l = (await store.get(chave)) || [];
  await store.put(chave, l.filter(x => x !== item));
}

// ---------- mensagens recebidas ----------

export async function receberMensagem(ctx, msg) {
  const { store, env } = ctx;
  if (!msg?.telefone) return;
  if (msg.id) {
    const vistos = (await store.get(K.vistos)) || [];
    if (vistos.includes(msg.id)) return;          // webhook repetido
    vistos.push(msg.id);
    await store.put(K.vistos, vistos.slice(-300));
  }
  // dono da empresa ou cliente final cadastrado; qualquer outro número é ignorado (não responde)
  let empresa = empresaDoTelefone(env, msg.telefone);
  let cli = null;
  if (!empresa) {
    cli = await ctx.store.get(K.cliente(msg.telefone));
    empresa = cli && empresaDoCnpj(env, cli.cnpjPrestador);
    if (!empresa) return;
  }
  const responder = t => ctx.wa.texto(msg.telefone, t);
  const ajuda = () => cli ? AJUDA_CLIENTE(msg.nome, empresa, cli) : AJUDA(msg.nome);
  if (msg.texto == null) return responder("Por enquanto só entendo mensagens de texto. Mande *nota* para pedir uma nota fiscal.");

  const texto = msg.texto.trim();
  let conv = await store.get(K.conversa(msg.telefone));
  if (conv && ctx.agora() - conv.atualizado > CONVERSA_EXPIRA_MS) conv = null;

  if (/^(sair|parar|desistir|cancelar pedido|recome[çc]ar)$/i.test(texto)) {
    await store.delete(K.conversa(msg.telefone));
    return responder("Pedido descartado. Mande *nota* quando quiser.");
  }
  if (/^(ajuda|menu|\?)$/i.test(texto)) return responder(ajuda());
  if (/^(notas|minhas notas|[uú]ltimas notas|hist[oó]rico)$/i.test(texto)) return responder(await listarNotas(ctx, empresa, cli));
  const mc = texto.match(/^cancel(?:ar|e)\s+(?:a\s+)?(?:nota|nfs-?e|nf)\s*(?:n[ºo°.]*\s*)?(\d+)$/i);
  if (mc) {
    if (cli) return responder(`Para cancelar uma nota, fale com ${empresa.nome || "a empresa"}.`);
    return iniciarCancelamento(ctx, empresa, msg.telefone, mc[1]);
  }
  if (!cli) {
    const r = await comandoDono(ctx, empresa, texto);
    if (r) return responder(r);
  }

  const comecaPedido = /^\s*(?:emitir|emite|emita|gerar|gera|nova|uma|quero|preciso de)?\s*(?:uma\s+)?(?:nota|nfs-?e|nf)\b/i.test(texto);
  if (!conv || comecaPedido) {
    const lido = lerPedido(texto.replace(/^\s*(?:quero|preciso de)\s+/i, ""));
    if (!comecaPedido && !lido.doc && !lido.valor) return responder(ajuda());
    conv = { etapa: null, pedido: {}, atualizado: ctx.agora() };
    if (cli) {
      // o cliente só pede nota para o próprio CPF/CNPJ, e ela volta para ele mesmo
      if ((lido.doc && lido.doc.numero !== cli.tomador.numero) || lido.docInvalido)
        return responder(`Por aqui você só pode pedir notas para ${cli.tomador.tipo === "cnpj" ? "o seu CNPJ" : "o seu CPF"} ${formatarDoc(cli.tomador.numero)}. Mande, por exemplo: _nota 1.500 consultoria de outubro_.`);
      conv.cliente = true;
      conv.limite = cli.limite || null;
      conv.pedido.tomador = { ...cli.tomador };
      conv.pedido.whatsCliente = null;
    } else {
      if (lido.docInvalido) await responder(`O documento ${lido.docInvalido} não é um CPF/CNPJ válido.`);
      if (lido.doc) await definirTomador(ctx, empresa, conv, lido.doc);
    }
    if (lido.valor) conv.pedido.valor = lido.valor;
    if (lido.descricao) conv.pedido.descricao = lido.descricao;
    return avancar(ctx, empresa, msg.telefone, conv);
  }

  const p = conv.pedido;
  switch (conv.etapa) {
    case "doc": {
      if (conv.cliente) break;
      const d = documento(texto);
      if (!d) return responder("Não reconheci esse CPF/CNPJ. Confira os números e mande de novo.");
      await definirTomador(ctx, empresa, conv, d);
      break;
    }
    case "nome":
      if (texto.length < 3) return responder("Mande o nome completo (ou a razão social) do cliente.");
      p.tomador.nome = texto;
      break;
    case "valor": {
      const v = lerValor(texto);
      if (!v) return responder("Não entendi o valor. Exemplo: 1.500,00");
      p.valor = v;
      break;
    }
    case "descricao":
      if (texto === "1" && empresa.descricao_padrao) p.descricao = empresa.descricao_padrao;
      else if (texto.length >= 4) p.descricao = texto;
      else return responder("Descreva o serviço prestado (pelo menos algumas palavras).");
      break;
    case "whatsapp_cliente":
      if (NAO.test(texto)) p.whatsCliente = null;
      else {
        const t = lerTelefone(texto);
        if (!t) return responder("Mande o número com DDD (ex.: 41 99999-8888) ou responda *NÃO*.");
        p.whatsCliente = t;
      }
      break;
    case "confirmar":
      if (SIM.test(texto)) return emitirPedido(ctx, empresa, msg.telefone, conv);
      if (NAO.test(texto)) {
        await store.delete(K.conversa(msg.telefone));
        return responder("Ok, não emiti. Mande *nota* para começar outra.");
      }
      if (!(await editarPedido(ctx, empresa, conv, texto)))
        return responder("Responda *SIM* para emitir ou *NÃO* para desistir.\nPara corrigir algo, mande por exemplo: _valor 2.000_, _descrição Consultoria de outubro_, _whatsapp 41 99999-8888_ ou _whatsapp não_, ou outro CPF/CNPJ.");
      break;
    case "cancelar_motivo":
      if (texto.length < 15) return responder("O motivo precisa ter pelo menos 15 letras. Ex.: _Valor emitido errado_.");
      conv.motivo = texto;
      conv.etapa = "cancelar_confirmar";
      conv.atualizado = ctx.agora();
      await store.put(K.conversa(msg.telefone), conv);
      return responder(`Confirma o cancelamento da *NFS-e nº ${conv.numero}*?\nMotivo: ${texto}\n\n⚠️ Não dá para desfazer. Responda *SIM* ou *NÃO*.`);
    case "cancelar_confirmar":
      if (SIM.test(texto)) return confirmarCancelamento(ctx, msg.telefone, conv);
      await store.delete(K.conversa(msg.telefone));
      return responder("Ok, a nota *não* foi cancelada.");
    default:
      await store.delete(K.conversa(msg.telefone));
      return responder(ajuda());
  }
  return avancar(ctx, empresa, msg.telefone, conv);
}

// Na confirmação, aceita correções: "valor 2000", "descrição ...", "whatsapp ...", outro CPF/CNPJ
async function editarPedido(ctx, empresa, conv, texto) {
  const p = conv.pedido;
  let m;
  if ((m = texto.match(/^valor\s*:?\s*(.+)$/i))) { const v = lerValor(m[1]); if (!v) return false; p.valor = v; return true; }
  if ((m = texto.match(/^descri[çc][aã]o\s*:?\s*(.{4,})$/is))) { p.descricao = m[1].trim(); return true; }
  if (conv.cliente) return false;                  // o cliente não troca o tomador nem o envio
  if ((m = texto.match(/^(?:whats(?:app)?|zap|telefone)\s*:?\s*(.+)$/i))) {
    if (NAO.test(m[1])) { p.whatsCliente = null; return true; }
    const t = lerTelefone(m[1]); if (!t) return false; p.whatsCliente = t; return true;
  }
  if ((m = texto.match(/^(?:nome|cliente)\s*:?\s*(.{3,})$/i)) && !documento(m[1])) { p.tomador.nome = m[1].trim(); return true; }
  const d = documento(texto.replace(/^(?:cliente|cpf|cnpj)\s*:?\s*/i, ""));
  if (d) { await definirTomador(ctx, empresa, conv, d); delete p.whatsCliente; return true; }
  return false;
}

// Preenche o cliente (tomador) com o cadastro salvo ou, para CNPJ, com os dados públicos da Receita
async function definirTomador(ctx, empresa, conv, doc) {
  const salvo = await ctx.store.get(K.tomador(empresa.cnpj, doc.numero));
  let tomador = { ...doc, ...(salvo || {}) };
  if (!salvo && doc.tipo === "cnpj" && ctx.buscarCnpj) {
    try { tomador = { ...tomador, ...((await ctx.buscarCnpj(doc.numero)) || {}) }; } catch { /* segue sem os dados */ }
  }
  conv.pedido.tomador = tomador;
  // cliente com WhatsApp cadastrado recebe a nota nesse número
  const fone = (await ctx.store.get(K.clienteDoc(empresa.cnpj, doc.numero))) || tomador.telefone;
  if (fone && conv.pedido.whatsCliente === undefined) conv.pedido.whatsCliente = fone;
}

// Pergunta o próximo dado que falta ou mostra o resumo para confirmar
async function avancar(ctx, empresa, tel, conv) {
  const p = conv.pedido;
  let pergunta;
  if (!p.tomador) { conv.etapa = "doc"; pergunta = "Qual o *CPF ou CNPJ* do cliente (tomador do serviço)?"; }
  else if (!p.tomador.nome) {
    conv.etapa = "nome";
    pergunta = `Qual o *nome completo* do cliente ${p.tomador.tipo === "cnpj" ? "(razão social) " : ""}de ${p.tomador.tipo.toUpperCase()} ${formatarDoc(p.tomador.numero)}?`;
  }
  else if (!p.valor || (conv.limite && p.valor > conv.limite)) {
    conv.etapa = "valor";
    pergunta = p.valor
      ? `O valor máximo por nota pedida por aqui é ${brl(conv.limite)}. Para valores maiores, fale com ${empresa.nome || "a empresa"}.\nQual o *valor* do serviço?`
      : "Qual o *valor* do serviço? (ex.: 1.500,00)";
    delete p.valor;
  }
  else if (!p.descricao) {
    conv.etapa = "descricao";
    pergunta = "Qual a *descrição do serviço*?" + (empresa.descricao_padrao ? `\nOu responda *1* para usar: _${empresa.descricao_padrao}_` : "");
  }
  else if (p.whatsCliente === undefined) {
    conv.etapa = "whatsapp_cliente";
    pergunta = "Quer que eu envie a nota também no *WhatsApp do cliente*? Mande o número com DDD ou responda *NÃO*.";
  }
  else { conv.etapa = "confirmar"; pergunta = conv.cliente ? resumoCliente(empresa, p) : resumo(empresa, p); }
  conv.atualizado = ctx.agora();
  await ctx.store.put(K.conversa(tel), conv);
  return ctx.wa.texto(tel, pergunta);
}

const foneBonito = t => t ? t.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3") : "";

function resumo(empresa, p) {
  return [
    "*Confira a nota:*",
    `Prestador: ${empresa.nome || formatarDoc(empresa.cnpj)}`,
    `Cliente: ${p.tomador.nome} – ${p.tomador.tipo.toUpperCase()} ${formatarDoc(p.tomador.numero)}`,
    `Serviço: ${p.descricao}`,
    `Valor: *${brl(p.valor)}*`,
    `Enviar ao cliente: ${p.whatsCliente ? foneBonito(p.whatsCliente) : "não"}`,
    "",
    "Responda *SIM* para emitir ou *NÃO* para desistir.",
  ].join("\n");
}

function resumoCliente(empresa, p) {
  return [
    "*Confira a nota:*",
    `Emitida por: ${empresa.nome || formatarDoc(empresa.cnpj)}`,
    `Para: ${p.tomador.nome} – ${p.tomador.tipo.toUpperCase()} ${formatarDoc(p.tomador.numero)}`,
    `Serviço: ${p.descricao}`,
    `Valor: *${brl(p.valor)}*`,
    "",
    "Responda *SIM* para emitir ou *NÃO* para desistir. Para corrigir: _valor 2.000_ ou _descrição …_",
  ].join("\n");
}

// ---------- emissão ----------

async function emitirPedido(ctx, empresa, tel, conv) {
  const { store } = ctx;
  const p = conv.pedido;
  const serie = Number(empresa.serie_dps || 1);
  const chaveDps = K.dps(empresa.cnpj, serie);
  const numero = (await store.get(chaveDps)) || Number(empresa.proximo_numero_dps || 1);
  await store.put(chaveDps, numero + 1);
  const ref = `${empresa.cnpj}-${serie}-${numero}`;
  const dps = montarDps({ empresa, tomador: p.tomador, valor: p.valor, descricao: p.descricao, numero, agora: agoraBrasilia(ctx.agora()) });

  let r;
  try { r = await ctx.focus.emitir(ref, dps); }
  catch (e) { r = { http: 0, mensagem: "Sem resposta da Focus NFe: " + e.message }; }

  if (!(r.http >= 200 && r.http < 300)) {
    if ((await store.get(chaveDps)) === numero + 1) await store.put(chaveDps, numero);   // número não usado
    conv.atualizado = ctx.agora();
    await store.put(K.conversa(tel), conv);
    return ctx.wa.texto(tel, `❌ A nota não foi aceita:\n${errosTexto(r)}\n\nCorrija (ex.: _valor 2.000_) e responda *SIM* de novo, ou *NÃO* para desistir.`);
  }

  const nota = {
    ref, cnpj: empresa.cnpj, numeroDps: numero, solicitante: tel, whatsCliente: p.whatsCliente || null,
    avisar: conv.cliente ? empresa.telefones : [],   // pedido do cliente: o dono recebe cópia
    valor: p.valor, descricao: p.descricao, tomadorNome: p.tomador.nome, tomadorDoc: p.tomador.numero,
    status: "processando", criado: ctx.agora(),
  };
  await store.put(K.nota(ref), nota);
  await adicionarLista(store, K.pendentes, ref, 1000);
  await adicionarLista(store, K.notas(empresa.cnpj), ref, MAX_NOTAS_LISTA);
  const { numero: _n, ...cadastro } = p.tomador;
  await store.put(K.tomador(empresa.cnpj, p.tomador.numero), { ...cadastro, telefone: p.whatsCliente || p.tomador.telefone || null });
  await store.delete(K.conversa(tel));
  await ctx.wa.texto(tel, "⏳ Nota enviada para autorização. Em instantes mando o PDF aqui.");
  for (const dono of nota.avisar) {
    await ctx.wa.texto(dono, `🔔 ${nota.tomadorNome} (${foneBonito(tel)}) pediu uma nota de ${brl(nota.valor)}: ${nota.descricao}. Já enviei para autorização.`).catch(() => {});
  }
  if (r.status && r.status !== "processando_autorizacao") await finalizar(ctx, ref, r);
}

// Trata a resposta final da Focus (gatilho "nfsen" ou consulta): envia o PDF ou avisa do erro
export async function finalizar(ctx, ref, dados) {
  const { store, env } = ctx;
  const nota = await store.get(K.nota(ref));
  if (!nota || !dados?.status || nota.status === dados.status) return;
  const empresa = empresaDoCnpj(env, nota.cnpj) || {};

  if (dados.status === "autorizado") {
    if (nota.status !== "processando") return;
    Object.assign(nota, {
      status: "autorizado", numero: dados.numero, codigoVerificacao: dados.codigo_verificacao,
      pdf: dados.url_danfse, xml: urlArquivo(env, dados.caminho_xml_nota_fiscal), consulta: dados.url, autorizado: ctx.agora(),
    });
    await store.put(K.nota(ref), nota);
    await removerLista(store, K.pendentes, ref);
    const nomeArquivo = `NFS-e ${nota.numero || nota.numeroDps}.pdf`;
    const legenda = [
      `✅ *NFS-e nº ${nota.numero} autorizada*`,
      `Cliente: ${nota.tomadorNome}`,
      `Valor: ${brl(nota.valor)}`,
      nota.codigoVerificacao ? `Código de verificação: ${nota.codigoVerificacao}` : "",
      nota.consulta ? `Consulta: ${nota.consulta}` : "",
    ].filter(Boolean).join("\n");
    await enviarPdf(ctx, nota.solicitante, nota, nomeArquivo, legenda);
    if (nota.xml) await ctx.wa.arquivo(nota.solicitante, nota.xml, `NFS-e ${nota.numero}.xml`, "").catch(() => {});
    if (nota.whatsCliente) {
      const msg = `Olá! Segue a nota fiscal de serviço nº ${nota.numero} emitida por ${empresa.nome || "nós"}, no valor de ${brl(nota.valor)}.` +
        (nota.consulta ? `\nConsulta: ${nota.consulta}` : "");
      try {
        await enviarPdf(ctx, nota.whatsCliente, nota, nomeArquivo, msg);
        await ctx.wa.texto(nota.solicitante, `📤 Também enviei ao cliente (${foneBonito(nota.whatsCliente)}).`);
      } catch (e) {
        await ctx.wa.texto(nota.solicitante, `⚠️ Não consegui enviar ao cliente (${foneBonito(nota.whatsCliente)}): ${e.message}`);
      }
    }
    for (const dono of nota.avisar || []) {
      await enviarPdf(ctx, dono, nota, nomeArquivo, `📄 Cópia: nota pedida por ${nota.tomadorNome} (${foneBonito(nota.solicitante)}) pelo WhatsApp.\n` + legenda).catch(() => {});
    }
    return;
  }

  if (dados.status === "erro_autorizacao" || dados.status === "negado") {
    nota.status = dados.status;
    nota.erro = errosTexto(dados);
    await store.put(K.nota(ref), nota);
    await removerLista(store, K.pendentes, ref);
    const pedidoDoCliente = (nota.avisar || []).length > 0;
    await ctx.wa.texto(nota.solicitante, `❌ A nota de ${brl(nota.valor)} para ${nota.tomadorNome} foi recusada:\n${nota.erro}\n\n` +
      (pedidoDoCliente ? `Já avisei ${empresa.nome || "a empresa"}.` : "Corrija e mande o pedido de novo (*nota*)."));
    for (const dono of nota.avisar || []) {
      await ctx.wa.texto(dono, `❌ A nota pedida por ${nota.tomadorNome} (${foneBonito(nota.solicitante)}), de ${brl(nota.valor)}, foi recusada:\n${nota.erro}`).catch(() => {});
    }
    return;
  }

  if (dados.status === "cancelado") {
    nota.status = "cancelado";
    await store.put(K.nota(ref), nota);
    await removerLista(store, K.pendentes, ref);
  }
}

async function enviarPdf(ctx, tel, nota, nomeArquivo, legenda) {
  if (nota.pdf) return ctx.wa.arquivo(tel, nota.pdf, nomeArquivo, legenda);
  return ctx.wa.texto(tel, legenda + "\n(O PDF ainda não ficou pronto; peça *notas* daqui a pouco.)");
}

// Consulta as notas que ainda esperam resposta (agendamento a cada minuto, caso o gatilho falhe)
export async function verificarPendentes(ctx) {
  const pendentes = (await ctx.store.get(K.pendentes)) || [];
  for (const ref of pendentes) {
    const nota = await ctx.store.get(K.nota(ref));
    if (!nota) { await removerLista(ctx.store, K.pendentes, ref); continue; }
    let r;
    try { r = await ctx.focus.consultar(ref); } catch { continue; }
    if (r.status && r.status !== "processando_autorizacao") await finalizar(ctx, ref, r);
    else if (ctx.agora() - nota.criado > PENDENTE_DESISTE_MS) {
      await removerLista(ctx.store, K.pendentes, ref);
      await ctx.wa.texto(nota.solicitante, `⚠️ A nota de ${brl(nota.valor)} para ${nota.tomadorNome} (ref. ${ref}) segue sem resposta da prefeitura há 2 dias. Confira no painel da Focus NFe.`);
    }
  }
}

// ---------- consulta e cancelamento ----------

const ICONE = { autorizado: "✅", processando: "⏳", cancelado: "🚫", erro_autorizacao: "❌", negado: "❌" };

async function listarNotas(ctx, empresa, cli) {
  const refs = ((await ctx.store.get(K.notas(empresa.cnpj))) || []).slice().reverse();
  const linhas = [];
  for (const ref of refs) {
    if (linhas.length >= 10) break;
    const n = await ctx.store.get(K.nota(ref));
    if (!n || (cli && n.tomadorDoc !== cli.tomador.numero)) continue;   // o cliente só vê as notas dele
    const quando = agoraBrasilia(n.criado).data.split("-").reverse().join("/");
    linhas.push(`${ICONE[n.status] || "•"} ${n.numero ? "nº " + n.numero : "(processando)"} – ${quando} – ${n.tomadorNome} – ${brl(n.valor)}`);
  }
  if (!linhas.length) return "Nenhuma nota emitida por aqui ainda. Mande *nota* para pedir.";
  return "*Últimas notas:*\n" + linhas.join("\n");
}

async function iniciarCancelamento(ctx, empresa, tel, numero) {
  const refs = (await ctx.store.get(K.notas(empresa.cnpj))) || [];
  let achada = null;
  for (const ref of refs) {
    const n = await ctx.store.get(K.nota(ref));
    if (n && String(n.numero) === String(numero) && n.status === "autorizado") achada = n;
  }
  if (!achada) return ctx.wa.texto(tel, `Não achei uma nota autorizada nº ${numero} emitida por aqui. Mande *notas* para ver a lista.`);
  await ctx.store.put(K.conversa(tel), { etapa: "cancelar_motivo", ref: achada.ref, numero: achada.numero, atualizado: ctx.agora() });
  return ctx.wa.texto(tel, `Nota nº ${achada.numero}: ${achada.tomadorNome}, ${brl(achada.valor)}.\nQual o *motivo* do cancelamento? (ex.: _Valor emitido errado_)`);
}

async function confirmarCancelamento(ctx, tel, conv) {
  await ctx.store.delete(K.conversa(tel));
  let r;
  try { r = await ctx.focus.cancelar(conv.ref, conv.motivo); }
  catch (e) { r = { http: 0, mensagem: e.message }; }
  if (r.status === "cancelado") {
    const nota = await ctx.store.get(K.nota(conv.ref));
    if (nota) { nota.status = "cancelado"; nota.motivoCancelamento = conv.motivo; await ctx.store.put(K.nota(conv.ref), nota); }
    return ctx.wa.texto(tel, `🚫 NFS-e nº ${conv.numero} cancelada.`);
  }
  return ctx.wa.texto(tel, `❌ Não foi possível cancelar a nota nº ${conv.numero}:\n${errosTexto(r)}`);
}

// ---------- clientes que pedem a própria nota (comandos do dono) ----------

// Devolve a resposta do comando, ou null se a mensagem não é comando de cadastro
async function comandoDono(ctx, empresa, texto) {
  let m;
  if ((m = texto.match(/^cadastr(?:ar|e|o)\s+(?:o\s+|um\s+)?(?:novo\s+)?cliente\s+(.+)$/is))) return cadastrarCliente(ctx, empresa, m[1]);
  if ((m = texto.match(/^(?:remover|excluir|apagar|descadastrar)\s+(?:o\s+)?cliente\s+(.+)$/i))) {
    const tel = lerTelefone(m[1]);
    const cli = tel && await ctx.store.get(K.cliente(tel));
    if (!cli || cli.cnpjPrestador !== empresa.cnpj) return "Não achei cliente cadastrado com esse WhatsApp. Mande *clientes* para ver a lista.";
    await desvincular(ctx, tel, cli);
    return `Cliente removido: ${cli.tomador.nome} (${foneBonito(tel)}) não pode mais pedir notas.`;
  }
  if ((m = texto.match(/^limite\s+(?:do\s+cliente\s+|cliente\s+)?(.+?)\s+(sem|nenhum|livre|r?\$?\s*[\d.,]+(?:\s*mil)?)$/i))) {
    const tel = lerTelefone(m[1]);
    const cli = tel && await ctx.store.get(K.cliente(tel));
    if (!cli || cli.cnpjPrestador !== empresa.cnpj) return "Não achei cliente cadastrado com esse WhatsApp. Mande *clientes* para ver a lista.";
    const v = /^(sem|nenhum|livre)$/i.test(m[2]) ? null : lerValor(m[2]);
    if (v === null && !/^(sem|nenhum|livre)$/i.test(m[2])) return "Não entendi o valor. Ex.: _limite 41 99999-8888 5.000_";
    cli.limite = v;
    await ctx.store.put(K.cliente(tel), cli);
    return v ? `Limite de ${cli.tomador.nome}: até ${brl(v)} por nota.` : `${cli.tomador.nome} agora pode pedir notas de qualquer valor.`;
  }
  if (/^(clientes|meus clientes|lista de clientes)$/i.test(texto)) {
    const tels = (await ctx.store.get(K.clientes(empresa.cnpj))) || [];
    const linhas = [];
    for (const tel of tels) {
      const c = await ctx.store.get(K.cliente(tel));
      if (c) linhas.push(`• ${c.tomador.nome} – ${formatarDoc(c.tomador.numero)} – ${foneBonito(tel)}${c.limite ? ` – até ${brl(c.limite)}` : ""}`);
    }
    return linhas.length ? "*Clientes que pedem a própria nota:*\n" + linhas.join("\n")
      : "Nenhum cliente cadastrado. Ex.: _cadastrar cliente 41 99999-8888 12.345.678/0001-95_";
  }
  return null;
}

async function cadastrarCliente(ctx, empresa, args) {
  const lido = lerCadastro(args);
  if (!lido) return "Não entendi. Use: _cadastrar cliente 41 99999-8888 12.345.678/0001-95_ (para CPF, inclua o nome no fim).";
  const { telefone: tel, doc, nome } = lido;
  if (empresaDoTelefone(ctx.env, tel)) return "Esse número é de quem administra a empresa e já pode emitir notas.";

  const conv = { pedido: {} };
  await definirTomador(ctx, empresa, conv, doc);
  const tomador = conv.pedido.tomador;
  if (nome) tomador.nome = nome;
  if (!tomador.nome) return `Não achei o nome de ${formatarDoc(doc.numero)}. Mande de novo com o nome no fim: _cadastrar cliente ${foneBonito(tel)} ${formatarDoc(doc.numero)} Nome Completo_`;
  delete tomador.telefone;

  const avisos = [];
  // um único WhatsApp por CPF/CNPJ: o número anterior perde o acesso
  const antigoTel = await ctx.store.get(K.clienteDoc(empresa.cnpj, doc.numero));
  if (antigoTel && antigoTel !== tel) {
    await desvincular(ctx, antigoTel, await ctx.store.get(K.cliente(antigoTel)));
    avisos.push(`O número anterior (${foneBonito(antigoTel)}) não pode mais pedir notas para esse ${doc.tipo.toUpperCase()}.`);
  }
  // um WhatsApp pede para um único CPF/CNPJ: o vínculo anterior deste número é trocado
  const anterior = await ctx.store.get(K.cliente(tel));
  if (anterior && (anterior.cnpjPrestador !== empresa.cnpj || anterior.tomador.numero !== doc.numero)) {
    if (anterior.cnpjPrestador !== empresa.cnpj) return "Esse WhatsApp já está cadastrado como cliente de outra empresa.";
    await desvincular(ctx, tel, anterior);
    avisos.push(`Esse WhatsApp deixou de pedir notas para ${formatarDoc(anterior.tomador.numero)}.`);
  }

  const cli = { telefone: tel, cnpjPrestador: empresa.cnpj, tomador, limite: anterior?.limite || null, cadastrado: ctx.agora() };
  await ctx.store.put(K.cliente(tel), cli);
  await ctx.store.put(K.clienteDoc(empresa.cnpj, doc.numero), tel);
  await adicionarLista(ctx.store, K.clientes(empresa.cnpj), tel, 5000);
  const { numero: _n, ...cadastro } = tomador;
  await ctx.store.put(K.tomador(empresa.cnpj, doc.numero), { ...cadastro, telefone: tel });

  let boasVindas = true;
  try {
    await ctx.wa.texto(tel, [
      `Olá! ${empresa.nome || "Nós"} liberou este WhatsApp para pedir notas fiscais de serviço para ${tomador.nome} (${doc.tipo.toUpperCase()} ${formatarDoc(doc.numero)}).`,
      "",
      "Para pedir, mande: _nota 1.500 consultoria de outubro_",
      "Eu confirmo os dados com você, emito e mando o PDF aqui.",
    ].join("\n"));
  } catch { boasVindas = false; }

  return [
    `✅ Cliente cadastrado: ${tomador.nome} – ${doc.tipo.toUpperCase()} ${formatarDoc(doc.numero)}`,
    `Só o WhatsApp ${foneBonito(tel)} pode pedir notas para esse ${doc.tipo.toUpperCase()}, e elas são enviadas para ele.`,
    "Você recebe uma cópia de cada nota. Para pôr um valor máximo: _limite " + foneBonito(tel) + " 5.000_",
    ...avisos,
    boasVindas ? "" : "⚠️ Não consegui mandar a mensagem de boas-vindas para esse número.",
  ].filter(Boolean).join("\n");
}

async function desvincular(ctx, tel, cli) {
  await ctx.store.delete(K.cliente(tel));
  await ctx.store.delete(K.conversa(tel));
  if (!cli) return;
  if ((await ctx.store.get(K.clienteDoc(cli.cnpjPrestador, cli.tomador.numero))) === tel)
    await ctx.store.delete(K.clienteDoc(cli.cnpjPrestador, cli.tomador.numero));
  await removerLista(ctx.store, K.clientes(cli.cnpjPrestador), tel);
}
