// WhatsApp pela Green API (https://green-api.com): recebe mensagens por webhook e envia texto e arquivos.
// Segredos: GREENAPI_INSTANCE (idInstance), GREENAPI_TOKEN (apiTokenInstance) e GREENAPI_URL (apiUrl).

export const chatDe = telefone => `${telefone}@c.us`;

// Lê o webhook "incomingMessageReceived" da Green API → { id, telefone, nome, texto } ou null
export function lerWebhook(corpo) {
  if (corpo?.typeWebhook !== "incomingMessageReceived") return null;
  const chat = corpo.senderData?.chatId || "";
  if (!chat.endsWith("@c.us")) return null;           // ignora grupos e canais
  const m = corpo.messageData || {};
  const texto = m.textMessageData?.textMessage ?? m.extendedTextMessageData?.text ?? m.quotedMessage?.text ?? null;
  return {
    id: corpo.idMessage,
    telefone: chat.replace("@c.us", ""),
    nome: corpo.senderData?.senderName || "",
    texto: texto == null ? null : String(texto),
    tipo: m.typeMessage,
  };
}

async function chamar(env, metodo, corpo, fetchImpl = fetch) {
  const base = (env.GREENAPI_URL || "https://api.green-api.com").replace(/\/+$/, "");
  const r = await fetchImpl(`${base}/waInstance${env.GREENAPI_INSTANCE}/${metodo}/${env.GREENAPI_TOKEN}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  });
  const texto = await r.text();
  if (!r.ok || !/idMessage/.test(texto)) throw new Error(`Green API (${metodo}) respondeu ${r.status}: ${texto.slice(0, 200)}`);
  return JSON.parse(texto);
}

export const enviarTexto = (env, telefone, message, f) => chamar(env, "sendMessage", { chatId: chatDe(telefone), message }, f);
export const enviarArquivo = (env, telefone, urlFile, fileName, caption, f) =>
  chamar(env, "sendFileByUrl", { chatId: chatDe(telefone), urlFile, fileName, caption }, f);
