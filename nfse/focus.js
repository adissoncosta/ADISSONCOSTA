// Cliente da API da Focus NFe para a NFS-e Nacional (padrão nacional, endpoint /v2/nfsen).
// Documentação: https://doc.focusnfe.com.br/reference/emitir_dps_nacional
// Autenticação: HTTP Basic com o token como usuário e senha vazia.

export const FOCUS_HOSTS = {
  homologacao: "https://homologacao.focusnfe.com.br",
  producao: "https://api.focusnfe.com.br",
};

export function focusHost(env) {
  return FOCUS_HOSTS[env.FOCUS_AMBIENTE === "producao" ? "producao" : "homologacao"];
}

async function chamar(env, metodo, caminho, corpo, fetchImpl = fetch) {
  if (!env.FOCUS_TOKEN) throw new Error("Falta o segredo FOCUS_TOKEN");
  const r = await fetchImpl(focusHost(env) + caminho, {
    method: metodo,
    headers: { Authorization: "Basic " + btoa(env.FOCUS_TOKEN + ":"), "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let json;
  try { json = texto ? JSON.parse(texto) : {}; } catch { json = { mensagem: texto.slice(0, 300) }; }
  return { http: r.status, ...json };
}

// Monta o corpo da DPS a partir da empresa (prestador), do tomador e do serviço
export function montarDps({ empresa, tomador, valor, descricao, numero, agora }) {
  const t = {};
  if (tomador.tipo === "cnpj") t.cnpj_tomador = tomador.numero; else t.cpf_tomador = tomador.numero;
  if (tomador.nome) t.razao_social_tomador = tomador.nome.slice(0, 150);
  if (tomador.email) t.email_tomador = tomador.email.slice(0, 80);
  if (tomador.codigo_municipio) t.codigo_municipio_tomador = Number(tomador.codigo_municipio);
  if (tomador.cep) t.cep_tomador = Number(String(tomador.cep).replace(/\D/g, ""));
  if (tomador.logradouro) t.logradouro_tomador = tomador.logradouro.slice(0, 255);
  if (tomador.numero_endereco) t.numero_tomador = String(tomador.numero_endereco).slice(0, 60);
  if (tomador.bairro) t.bairro_tomador = tomador.bairro.slice(0, 60);
  const municipio = Number(empresa.codigo_municipio);
  return {
    data_emissao: agora.dataHora,
    data_competencia: agora.data,
    serie_dps: Number(empresa.serie_dps || 1),
    numero_dps: numero,
    emitente_dps: 1,                       // 1 = prestador
    codigo_municipio_emissora: municipio,
    cnpj_prestador: empresa.cnpj,
    codigo_opcao_simples_nacional: Number(empresa.codigo_opcao_simples_nacional ?? 1),
    regime_especial_tributacao: Number(empresa.regime_especial_tributacao ?? 0),
    ...t,
    codigo_municipio_prestacao: String(empresa.codigo_municipio_prestacao || municipio),
    codigo_tributacao_nacional_iss: String(empresa.codigo_tributacao_nacional_iss),
    descricao_servico: descricao.slice(0, 2000),
    valor_servico: valor,
    tributacao_iss: Number(empresa.tributacao_iss ?? 1),   // 1 = operação tributável
    ...(empresa.aliquota_iss != null ? { percentual_aliquota_relativa_municipio: Number(empresa.aliquota_iss) } : {}),
    ...(empresa.informacoes_complementares ? { informacoes_complementares: empresa.informacoes_complementares } : {}),
    ...(empresa.campos_extras || {}),     // qualquer outro campo exigido pela prefeitura/contador
  };
}

export const emitir = (env, ref, dps, f) => chamar(env, "POST", "/v2/nfsen?ref=" + encodeURIComponent(ref), dps, f);
export const consultar = (env, ref, f) => chamar(env, "GET", "/v2/nfsen/" + encodeURIComponent(ref), null, f);
export const cancelar = (env, ref, justificativa, f) => chamar(env, "DELETE", "/v2/nfsen/" + encodeURIComponent(ref), { justificativa }, f);
export const cadastrarGatilho = (env, cnpj, url, f) =>
  chamar(env, "POST", "/v2/hooks", { cnpj, event: "nfsen", url, authorization: env.WEBHOOK_TOKEN }, f);

// URL completa de um arquivo devolvido pela Focus (o XML vem como caminho relativo)
export const urlArquivo = (env, caminho) => !caminho ? null : /^https?:/.test(caminho) ? caminho : focusHost(env) + caminho;

// Texto curto com os erros devolvidos pela Focus/prefeitura
export function errosTexto(r) {
  const lista = (r.erros || []).map(e => `• ${e.mensagem || e.codigo}${e.correcao ? ` (${e.correcao})` : ""}`);
  if (!lista.length && r.mensagem) lista.push("• " + r.mensagem);
  return lista.join("\n") || "• Erro sem descrição (código " + (r.codigo || r.http) + ")";
}
