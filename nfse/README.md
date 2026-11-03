# Emissor de NFS-e pelo WhatsApp

O **cliente final** pede a nota pelo WhatsApp. O emissor emite a **NFS-e no padrão nacional** pela [Focus NFe](https://focusnfe.com.br) e manda o **PDF (DANFSe)** de volta **para o cliente, automaticamente**. Você recebe uma cópia de cada nota.

Cada cliente é cadastrado por você com **um único WhatsApp ligado ao CPF/CNPJ dele**. Só esse número pode pedir notas para aquele CPF/CNPJ, e as notas saem sempre em nome dele.

```
Você:     cadastrar cliente 11 97777-6666 11.444.777/0001-61
Emissor:  ✅ Cliente cadastrado: Cliente Grande SA – CNPJ 11.444.777/0001-61
          Só o WhatsApp (11) 97777-6666 pode pedir notas para esse CNPJ…

Cliente:  nota 1.200 consultoria de outubro
Emissor:  Confira a nota: Emitida por Estúdio Exemplo LTDA · Para Cliente Grande SA · R$ 1.200,00
          Responda SIM para emitir ou NÃO para desistir.
Cliente:  sim
Emissor → cliente: 📄 NFS-e 77.pdf  ✅ NFS-e nº 77 autorizada
Emissor → você:    📄 Cópia: nota pedida por Cliente Grande SA…
```

Você também pode emitir notas para qualquer cliente pelo seu próprio WhatsApp:

```
Você:    nota 1.500 para 11.444.777/0001-61 consultoria em marketing
Emissor: Confira a nota:
         Prestador: Estúdio Exemplo LTDA
         Cliente: Cliente Grande SA – CNPJ 11.444.777/0001-61
         Serviço: Consultoria em marketing
         Valor: R$ 1.500,00
         Enviar ao cliente: (11) 98888-7777
         Responda SIM para emitir ou NÃO para desistir.
Você:    sim
Emissor: ⏳ Nota enviada para autorização. Em instantes mando o PDF aqui.
Emissor: 📄 NFS-e 123.pdf  ✅ NFS-e nº 123 autorizada …
```

## O que ele faz

**Para o cliente final** (número cadastrado por você):
- Pede a nota em texto livre (`nota 1.200 consultoria de outubro`) ou responde ao que o emissor perguntar.
- A nota sai **sempre para o CPF/CNPJ dele**: ele não consegue trocar o tomador nem o número que recebe a nota.
- Recebe o PDF e o XML no próprio WhatsApp e vê as notas dele com `notas`. Para cancelar, precisa falar com você.
- Se você definir um limite, notas acima do **valor máximo** são recusadas.
- Você é avisado de cada pedido e recebe uma cópia do PDF. Se a nota for recusada, os dois são avisados.

**Para você (dono)**:

- **Entende o pedido em texto livre** (valor, CPF/CNPJ e descrição numa mensagem só) ou **pergunta o que faltar**, um dado por vez.
- **Valida o CPF e o CNPJ** (dígitos verificadores) e preenche o cliente com os **dados públicos da Receita** (razão social, e-mail, município e endereço) pela [BrasilAPI](https://brasilapi.com.br).
- **Lembra os clientes** que já receberam nota: da segunda vez em diante, basta o CPF/CNPJ.
- **Sempre pede confirmação** antes de emitir. Na confirmação, dá para corrigir com mensagens como `valor 2.000`, `descrição Consultoria de outubro`, `whatsapp 41 99999-8888` ou `whatsapp não`.
- **Numera a DPS sozinho** (série e número por empresa). Se a nota for recusada na hora, o número volta e não fica buraco.
- **Avisa o motivo** quando a prefeitura ou a Receita recusam a nota, com a correção sugerida.
- **Mostra as últimas notas** com `notas` e **cancela** com `cancelar nota 123`. O cancelamento pede o motivo e uma confirmação.
- **Atende várias empresas**: cada número de WhatsApp autorizado fica ligado a um CNPJ. Isso serve, por exemplo, para um escritório de contabilidade.
- **Cadastra os clientes que pedem a própria nota**: `cadastrar cliente`, `limite`, `clientes` e `remover cliente`. Ao cadastrar o mesmo CPF/CNPJ com outro número, o número anterior perde o acesso. Quando você emite para um cliente cadastrado, a nota vai automaticamente para o WhatsApp dele.
- **Ignora números não autorizados** e grupos, sem responder nada.

## Como funciona

```
WhatsApp ──(Green API, webhook)──▶ Cloudflare Worker /whatsapp ──▶ Durable Object "Emissor"
                                                                   ├─ conversa e cadastro de clientes
                                                                   ├─ Focus NFe: POST /v2/nfsen?ref=…   (emite a DPS)
Focus NFe ──(gatilho "nfsen")────▶ /focus ─────────────────────────┤
Agendamento (a cada minuto) ───────────────────────────────────────┴─ GET /v2/nfsen/{ref} (consulta as pendentes)
                                   └──▶ Green API sendFileByUrl: PDF + XML para quem pediu (e para o cliente)
```

**Por que o cliente é cadastrado por você:** emitir uma nota gera imposto (ISS) para a sua empresa. Por isso, só os clientes que você liberou conseguem pedir notas. Se quiser mais controle, defina um limite de valor por nota para cada cliente.

| Arquivo | Papel |
|---|---|
| `worker.js` | Rotas HTTP, agendamento e Durable Object (guarda tudo e processa um evento por vez) |
| `emissor.js` | Conversa, emissão, entrega do PDF, consulta e cancelamento |
| `focus.js` | API da Focus NFe (NFS-e Nacional) e montagem da DPS |
| `whatsapp.js` | Green API: leitura do webhook e envio de texto e arquivo |
| `documentos.js` | CPF/CNPJ, valores em reais, datas e leitura do pedido em texto livre |
| `../tests/nfse.test.mjs` | Testes com WhatsApp, Focus e Receita simulados (`npm run test:nfse`) |

## Configurar (uma vez)

### 1. Focus NFe (emissão)

1. Crie a conta em https://focusnfe.com.br. O ambiente de homologação é para testes: as notas emitidas nele não têm valor fiscal.
2. No painel, cadastre a empresa (CNPJ), envie o **certificado digital A1** e habilite a **NFS-e Nacional**.
3. Copie o **token** da empresa. Ele vira o segredo `FOCUS_TOKEN`. Use o token de homologação enquanto estiver testando.
4. Confirme com o contador o **código de tributação nacional** do serviço (ex.: `010701`), a opção pelo Simples Nacional e a alíquota.

### 2. Green API (WhatsApp)

1. Crie uma instância em https://console.green-api.com e escaneie o QR code com o WhatsApp que vai **atender** os pedidos. Use um número próprio para isso, por exemplo um WhatsApp Business.
2. Copie o `idInstance`, o `apiTokenInstance` e o `apiUrl`.
3. O plano gratuito "Developer" conversa com até 3 chats. Para mandar nota aos clientes, contrate um plano pago.
4. O webhook é configurado no passo 5.

### 3. Empresas autorizadas (`PRESTADORES`)

Este segredo é um JSON com uma lista de empresas. Em `telefones` ficam os números que podem pedir notas daquela empresa:

```json
[
  {
    "nome": "Estúdio Exemplo LTDA",
    "cnpj": "11.222.333/0001-81",
    "telefones": ["41 99999-0000", "41 98888-1111"],
    "codigo_municipio": 4106902,
    "codigo_tributacao_nacional_iss": "010701",
    "codigo_opcao_simples_nacional": 3,
    "regime_especial_tributacao": 0,
    "serie_dps": 1,
    "proximo_numero_dps": 1,
    "aliquota_iss": 2.0,
    "descricao_padrao": "Desenvolvimento e manutenção de software",
    "informacoes_complementares": "Documento emitido por ME ou EPP optante pelo Simples Nacional.",
    "campos_extras": {}
  }
]
```

| Campo | Significado |
|---|---|
| `codigo_municipio` | Código IBGE de 7 dígitos do município do prestador (ex.: Curitiba 4106902) |
| `codigo_tributacao_nacional_iss` | Código do serviço na lista nacional (pergunte ao contador) |
| `codigo_opcao_simples_nacional` | 1 = não optante, 2 = MEI, 3 = ME/EPP |
| `regime_especial_tributacao` | 0 = nenhum (padrão) |
| `serie_dps` / `proximo_numero_dps` | Série da DPS e o número de partida. Se a empresa já emitiu DPS nessa série, use o número seguinte ao último |
| `aliquota_iss` | Opcional. Só para municípios que não estão no sistema nacional |
| `codigo_municipio_prestacao` | Opcional. Município onde o serviço foi prestado, quando for diferente do município do prestador |
| `tributacao_iss` | Opcional. 1 = tributável (padrão), 2 = imunidade, 3 = exportação, 4 = não incidência |
| `descricao_padrao` | Opcional. Quem pede a nota pode responder "1" para usar esta descrição |
| `campos_extras` | Qualquer outro campo da [lista da Focus](https://campos.focusnfe.com.br/nfse_nacional/EmissaoDPSXml.html) que o seu município ou o contador exigir |

> ⚠️ **Antes de ir para produção**, emita algumas notas em homologação. A lista de campos da Focus marca `finalidade_emissao`, `consumidor_final` e `indicador_destinatario` como obrigatórios, e o seu caso pode exigir também os campos de **IBS/CBS** da reforma tributária. Se a Focus recusar a nota por algum campo, o emissor mostra o erro no WhatsApp: acrescente o campo em `campos_extras`, por exemplo `{"consumidor_final": 0, "indicador_destinatario": 0}`, com os valores que o contador indicar.

### 4. Publicar (GitHub Actions + Cloudflare, gratuito)

Em *Settings → Secrets and variables → Actions → New repository secret*, crie:

| Segredo | Valor |
|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Os mesmos do servidor de preços (veja o README principal) |
| `FOCUS_TOKEN` | Token da Focus NFe |
| `GREENAPI_INSTANCE`, `GREENAPI_TOKEN`, `GREENAPI_URL` | Dados da instância da Green API |
| `NFSE_WEBHOOK_TOKEN` | Uma senha longa inventada por você (ex.: saída de `openssl rand -hex 24`). Protege os webhooks |
| `NFSE_PRESTADORES` | O JSON do passo 3 |

Depois, rode *Actions → Emissor de NFS-e → Run workflow*. O resumo do run mostra o endereço do emissor (ex.: `https://emissor-nfse.SEU-USUARIO.workers.dev`). Abra esse endereço no navegador: o campo `faltam` deve aparecer vazio.

Para publicar sem o GitHub: `cd nfse && npx wrangler deploy`, e depois `npx wrangler secret put NOME` para cada segredo, com os nomes `FOCUS_TOKEN`, `GREENAPI_*`, `WEBHOOK_TOKEN` e `PRESTADORES`.

### 5. Ligar os webhooks

1. **Green API**: no console da instância, em *Settings*, preencha:
   - *Webhook URL*: `https://emissor-nfse.SEU-USUARIO.workers.dev/whatsapp`
   - *Webhook Authorization Header*: o valor de `NFSE_WEBHOOK_TOKEN`
   - Ligue *Receive webhooks on incoming messages*.
2. **Focus NFe**: rode uma vez o comando abaixo. Ele cadastra o gatilho `nfsen` de cada empresa, e a Focus passa a avisar o emissor assim que a nota é autorizada:
   ```
   curl -X POST -H "Authorization: Bearer SEU_WEBHOOK_TOKEN" https://emissor-nfse.SEU-USUARIO.workers.dev/configurar
   ```
   Sem o gatilho, o emissor confere as notas pendentes uma vez por minuto, então o PDF chega do mesmo jeito, só que um pouco depois.
3. Do WhatsApp autorizado, mande `oi` para o número da Green API. A resposta é o menu.
4. Cadastre os clientes: `cadastrar cliente 11 97777-6666 11.444.777/0001-61`. Quando o cliente é CPF, inclua o nome no fim. O cliente recebe na hora uma mensagem explicando como pedir.

### 6. Produção

Em `nfse/wrangler.toml`, troque `FOCUS_AMBIENTE = "homologacao"` por `"producao"`. Atualize também o segredo `FOCUS_TOKEN` com o token de produção e publique de novo.

## Comandos no WhatsApp

### Cliente final

| Mensagem | O que faz |
|---|---|
| `nota` ou `nota 1.200 consultoria de outubro` | Pede uma nota para o próprio CPF/CNPJ |
| `sim` / `não` | Confirma ou descarta |
| `valor 2.000`, `descrição …` | Corrige antes de confirmar |
| `notas` | Últimas notas dele |
| `sair` / `ajuda` | Descarta o pedido / menu |

### Você (dono)

| Mensagem | O que faz |
|---|---|
| `cadastrar cliente 11 97777-6666 11.444.777/0001-61` | Libera esse WhatsApp para pedir notas desse CNPJ (para CPF: `… 529.982.247-25 Nome Completo`) |
| `limite 11 97777-6666 5.000` / `limite 11 97777-6666 sem` | Valor máximo por nota desse cliente / sem limite |
| `clientes` | Lista os clientes cadastrados |
| `remover cliente 11 97777-6666` | Tira o acesso |

| Mensagem | O que faz |
|---|---|
| `nota` | Começa um pedido; o emissor pergunta o que faltar |
| `nota 1.500 para 12.345.678/0001-95 consultoria` | Pedido completo numa mensagem |
| `sim` / `não` | Confirma ou descarta a nota mostrada |
| `valor 2.000`, `descrição …`, `whatsapp 41 9…`, `whatsapp não` | Corrige o pedido antes de confirmar |
| `notas` | Últimas 10 notas |
| `cancelar nota 123` | Cancela a nota nº 123 (pede o motivo e a confirmação) |
| `sair` | Descarta o pedido em andamento |
| `ajuda` | Menu |

Um pedido parado por mais de 2 horas é esquecido.

## Segurança

- Só emitem notas os números listados em `PRESTADORES` (você) e os clientes que você cadastrou. Mensagens de qualquer outro número são ignoradas.
- O cliente só emite para o próprio CPF/CNPJ, e cada CPF/CNPJ tem um único WhatsApp autorizado.
- Os webhooks só são aceitos com o `NFSE_WEBHOOK_TOKEN`.
- Nenhuma nota é emitida sem um **SIM** explícito depois do resumo.
- Os tokens ficam como segredos do Cloudflare, nunca no código.
