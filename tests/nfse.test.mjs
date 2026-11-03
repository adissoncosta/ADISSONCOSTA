// Testes do Emissor de NFS-e pelo WhatsApp (nfse/), com WhatsApp, Focus NFe e Receita simulados.
import { cpfValido, cnpjValido, valor, lerPedido, telefone, agoraBrasilia } from "../nfse/documentos.js";
import { montarDps } from "../nfse/focus.js";
import { lerWebhook } from "../nfse/whatsapp.js";
import { receberMensagem, finalizar, verificarPendentes } from "../nfse/emissor.js";

let failed = 0;
const assert = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };

// ---- documentos e valores ----
assert(cpfValido("529.982.247-25") && !cpfValido("529.982.247-26") && !cpfValido("111.111.111-11"), "CPF validation");
assert(cnpjValido("11.222.333/0001-81") && !cnpjValido("11.222.333/0001-82") && !cnpjValido("00000000000000"), "CNPJ validation");
const vs = { "1.500,00": 1500, "R$ 1.500": 1500, "1500": 1500, "1500.5": 1500.5, "2,5 mil": 2500, "1,234.56": 1234.56, "99,9": 99.9, "abc": null, "0": null };
assert(Object.entries(vs).every(([t, v]) => valor(t) === v), "money parsing: " + JSON.stringify(Object.fromEntries(Object.keys(vs).map(k => [k, valor(k)]))));
let lp = lerPedido("nota 1.500,00 para 11.222.333/0001-81 consultoria em marketing");
assert(lp.valor === 1500 && lp.doc?.numero === "11222333000181" && lp.descricao === "Consultoria em marketing", "free-text order: " + JSON.stringify(lp));
lp = lerPedido("emitir nota de R$ 350 para o cpf 52998224725 referente a aula particular");
assert(lp.valor === 350 && lp.doc?.tipo === "cpf" && lp.descricao === "Aula particular", "free-text order with CPF: " + JSON.stringify(lp));
lp = lerPedido("nota");
assert(!lp.valor && !lp.doc && !lp.descricao, "bare 'nota' has nothing");
assert(lerPedido("nota 100 para 11.222.333/0001-99").docInvalido === "11.222.333/0001-99", "invalid document reported");
assert(telefone("(41) 99999-8888") === "5541999998888" && telefone("+55 41 99999-8888") === "5541999998888" && telefone("123") === null, "phone parsing");
assert(agoraBrasilia(Date.UTC(2026, 0, 1, 2, 30)).dataHora === "2025-12-31T23:30:00-0300", "Brasília time");

// ---- webhook da Green API ----
const wh = (texto, id = Math.random().toString(36), chat = "5541999990000@c.us") => ({
  typeWebhook: "incomingMessageReceived", idMessage: id, senderData: { chatId: chat, senderName: "Ana Souza" },
  messageData: { typeMessage: "textMessage", textMessageData: { textMessage: texto } },
});
assert(lerWebhook(wh("oi")).telefone === "5541999990000" && lerWebhook(wh("oi")).texto === "oi", "reads Green API text webhook");
assert(lerWebhook({ ...wh("x"), typeWebhook: "outgoingMessageReceived" }) === null && lerWebhook(wh("x", "1", "1203@g.us")) === null, "ignores outgoing and group messages");
assert(lerWebhook({ typeWebhook: "incomingMessageReceived", senderData: { chatId: "55@c.us" }, messageData: { typeMessage: "extendedTextMessage", extendedTextMessageData: { text: "nota" } } }).texto === "nota", "reads extended text");

// ---- DPS ----
const empresa = {
  nome: "Estúdio Exemplo LTDA", cnpj: "11222333000181", telefones: ["41 99999-0000"], codigo_municipio: 4106902,
  codigo_tributacao_nacional_iss: "010701", codigo_opcao_simples_nacional: 3, descricao_padrao: "Desenvolvimento de software",
  campos_extras: { consumidor_final: 0 },
};
const dps = montarDps({ empresa, tomador: { tipo: "cpf", numero: "52998224725", nome: "João" }, valor: 350, descricao: "Aula", numero: 7, agora: agoraBrasilia(Date.UTC(2026, 10, 3, 15)) });
assert(dps.cpf_tomador === "52998224725" && !dps.cnpj_tomador && dps.razao_social_tomador === "João" && dps.numero_dps === 7 && dps.serie_dps === 1
  && dps.cnpj_prestador === "11222333000181" && dps.codigo_municipio_emissora === 4106902 && dps.codigo_municipio_prestacao === "4106902"
  && dps.codigo_tributacao_nacional_iss === "010701" && dps.valor_servico === 350 && dps.data_emissao === "2026-11-03T12:00:00-0300"
  && dps.data_competencia === "2026-11-03" && dps.emitente_dps === 1 && dps.tributacao_iss === 1 && dps.codigo_opcao_simples_nacional === 3 && dps.consumidor_final === 0,
  "DPS body: " + JSON.stringify(dps));

// ---- conversa completa (simulada) ----
function cenario({ emitir, consultar } = {}) {
  const dados = new Map(), enviados = [], chamadas = [];
  let t = Date.UTC(2026, 10, 3, 15);
  const ctx = {
    env: { PRESTADORES: JSON.stringify([empresa]), FOCUS_AMBIENTE: "homologacao" },
    store: { get: async k => structuredClone(dados.get(k)), put: async (k, v) => void dados.set(k, structuredClone(v)), delete: async k => void dados.delete(k) },
    wa: {
      texto: async (tel, msg) => void enviados.push({ tel, msg }),
      arquivo: async (tel, url, nome, legenda) => void enviados.push({ tel, url, nome, msg: legenda }),
    },
    focus: {
      emitir: async (ref, d) => { chamadas.push({ ref, d }); return emitir ? emitir(ref, d) : { http: 202, status: "processando_autorizacao", ref }; },
      consultar: async ref => consultar ? consultar(ref) : { http: 200, status: "processando_autorizacao" },
      cancelar: async (ref, j) => { chamadas.push({ cancelar: ref, j }); return { http: 200, status: "cancelado" }; },
    },
    buscarCnpj: async cnpj => cnpj === "11444777000161" ? { nome: "Cliente Grande SA", email: "fin@cliente.com", codigo_municipio: 3550308, telefone: "5511988887777" } : null,
    agora: () => (t += 1000),
  };
  const fala = texto => receberMensagem(ctx, lerWebhook(wh(texto)));
  const ultima = () => enviados.at(-1)?.msg || "";
  return { ctx, dados, enviados, chamadas, fala, ultima };
}

let s = cenario();
await receberMensagem(s.ctx, lerWebhook(wh("nota 100", "x1", "5511000000000@c.us")));
assert(s.enviados.length === 0, "unauthorized number gets no answer and nothing is issued");

await s.fala("nota");
assert(/CPF ou CNPJ/.test(s.ultima()), "asks for the client's document");
await s.fala("111.111.111-11");
assert(/Não reconheci/.test(s.ultima()), "rejects invalid document");
await s.fala("529.982.247-25");
assert(/nome completo/.test(s.ultima()), "CPF client: asks for the name");
await s.fala("João da Silva");
assert(/valor/.test(s.ultima()), "asks for the amount");
await s.fala("trezentos");
assert(/Não entendi o valor/.test(s.ultima()), "rejects amount in words");
await s.fala("R$ 350,00");
assert(/descrição/.test(s.ultima()) && /Desenvolvimento de software/.test(s.ultima()), "asks for description and offers the default");
await s.fala("1");
assert(/WhatsApp do cliente/.test(s.ultima()), "asks whether to send to the client");
await s.fala("41 98888-7777");
assert(/Confira a nota/.test(s.ultima()) && /R\$\s?350,00/.test(s.ultima()) && /João da Silva/.test(s.ultima()) && /\(41\) 98888-7777/.test(s.ultima()), "summary before issuing: " + s.ultima());
await s.fala("valor 400");
assert(/R\$\s?400,00/.test(s.ultima()), "edits the amount at confirmation");
assert(s.chamadas.length === 0, "nothing issued before SIM");
await s.fala("sim");
const ref1 = "11222333000181-1-1";
assert(s.chamadas.length === 1 && s.chamadas[0].ref === ref1 && s.chamadas[0].d.valor_servico === 400 && s.chamadas[0].d.descricao_servico === "Desenvolvimento de software", "issues via Focus with ref and data");
assert(/enviada para autorização/.test(s.ultima()), "tells the user it is processing");

// webhook repetido não emite de novo
const rep = wh("sim", "dup");
await receberMensagem(s.ctx, lerWebhook(rep)); await receberMensagem(s.ctx, lerWebhook(rep));
assert(s.chamadas.length === 1, "duplicate/late 'sim' does not issue twice");

const autorizada = { ref: ref1, status: "autorizado", numero: "123", codigo_verificacao: "ABC", url_danfse: "https://s3/danfse.pdf", caminho_xml_nota_fiscal: "/arquivos/n.xml", url: "https://nfse.gov.br/c" };
s.enviados.length = 0;
await finalizar(s.ctx, ref1, autorizada);
const pdfs = s.enviados.filter(e => e.url === "https://s3/danfse.pdf");
assert(pdfs.length === 2 && pdfs[0].tel === "5541999990000" && pdfs[1].tel === "5541988887777" && pdfs[0].nome === "NFS-e 123.pdf", "PDF sent to requester and to client: " + JSON.stringify(s.enviados.map(e => [e.tel, e.nome])));
assert(s.enviados.some(e => e.url === "https://homologacao.focusnfe.com.br/arquivos/n.xml"), "XML sent with absolute Focus URL");
assert(/autorizada/.test(pdfs[0].msg) && /R\$\s?400,00/.test(pdfs[0].msg), "caption with number and amount");
const antes = s.enviados.length;
await finalizar(s.ctx, ref1, autorizada);
assert(s.enviados.length === antes, "repeated Focus webhook does not resend");
assert(((await s.ctx.store.get("pendentes")) || []).length === 0, "authorized note leaves the pending list");

// lista e cancelamento
await s.fala("notas");
assert(/nº 123/.test(s.ultima()) && /João da Silva/.test(s.ultima()), "lists notes");
await s.fala("cancelar nota 999");
assert(/Não achei/.test(s.ultima()), "unknown note number");
await s.fala("cancelar nota 123");
assert(/motivo/.test(s.ultima()), "asks for cancellation reason");
await s.fala("errado");
assert(/15 letras/.test(s.ultima()), "reason too short");
await s.fala("Valor emitido errado");
assert(/Não dá para desfazer/.test(s.ultima()), "asks to confirm cancellation");
await s.fala("sim");
assert(s.chamadas.at(-1).cancelar === ref1 && s.chamadas.at(-1).j === "Valor emitido errado" && /cancelada/.test(s.ultima()), "cancels at Focus");

// pedido em uma mensagem só, CNPJ com dados da Receita e telefone já conhecido; número da DPS segue
await s.fala("nota 2.500 para 11.444.777/0001-61 consultoria mensal");
assert(/Confira a nota/.test(s.ultima()) && /Cliente Grande SA/.test(s.ultima()) && /\(11\) 98888-7777/.test(s.ultima()) && /Consultoria mensal/.test(s.ultima()), "one-message order goes straight to summary: " + s.ultima());
await s.fala("whatsapp não");
assert(/Enviar ao cliente: não/.test(s.ultima()), "turns off sending to client");
await s.fala("SIM");
const d2 = s.chamadas.at(-1).d;
assert(s.chamadas.at(-1).ref === "11222333000181-1-2" && d2.cnpj_tomador === "11444777000161" && d2.razao_social_tomador === "Cliente Grande SA" && d2.email_tomador === "fin@cliente.com" && d2.codigo_municipio_tomador === 3550308, "second note: next DPS number and Receita data");

// cliente salvo: próximo pedido já traz nome
await s.fala("nota 80 para 529.982.247-25 aula extra");
assert(/João da Silva/.test(s.ultima()) && /\(41\) 98888-7777/.test(s.ultima()), "remembers client name and phone");
await s.fala("não");
assert(/não emiti/.test(s.ultima()), "NÃO discards the order");

// recusa síncrona devolve o número e permite corrigir
s = cenario({ emitir: () => ({ http: 422, codigo: "erro_validacao", erros: [{ mensagem: "Valor inválido" }] }) });
await s.fala("nota 10 para 529.982.247-25 teste de serviço");
await s.fala("Maria");
await s.fala("não");
await s.fala("sim");
assert(/não foi aceita/.test(s.ultima()) && /Valor inválido/.test(s.ultima()), "shows Focus validation errors");
assert(await s.ctx.store.get("dps:11222333000181:1") === 1, "unused DPS number is given back");
assert((await s.ctx.store.get("conversa:5541999990000"))?.etapa === "confirmar", "order kept for correction");

// recusa pela prefeitura via consulta agendada
s = cenario({ consultar: () => ({ status: "erro_autorizacao", erros: [{ codigo: "E1", mensagem: "Código de serviço inválido", correcao: "Use 010701" }] }) });
await s.fala("nota 10 para 529.982.247-25 teste de serviço"); await s.fala("Maria"); await s.fala("não"); await s.fala("sim");
await verificarPendentes(s.ctx);
assert(/recusada/.test(s.ultima()) && /Código de serviço inválido/.test(s.ultima()) && /Use 010701/.test(s.ultima()), "scheduled check reports rejection");
assert(((await s.ctx.store.get("pendentes")) || []).length === 0, "rejected note leaves pending list");

// ajuda e desistir
s = cenario();
await s.fala("oi");
assert(/emissor de notas/.test(s.ultima()) && /Ana/.test(s.ultima()), "greeting shows help");
await s.fala("nota"); await s.fala("sair");
assert(/descartado/.test(s.ultima()) && !(await s.ctx.store.get("conversa:5541999990000")), "sair discards the order");

console.log(failed ? `\n${failed} falha(s)` : "\nTodos os testes passaram");
process.exit(failed ? 1 : 0);
