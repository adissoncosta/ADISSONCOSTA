# Radar de Passagens

Página única (HTML/CSS/JS, sem dependências) para achar passagens aéreas promocionais saindo do Brasil:

- **Promoções encontradas** – ofertas em reais e em milhas, com botão de compra na companhia ou no programa de milhas. Ofertas vencidas somem sozinhas (campos `until` e `date` em `DEALS`).
- **Para onde vamos viajar?** – escolha a cidade de partida e o Radar busca o preço de ida e volta (1 adulto, 7 dias) para 10 destinos procurados, nacionais e internacionais, e mostra os cartões com foto do mais barato para o mais caro. A busca automática usa o navegador do app Claude para computador; fora dele aparecem os preços das promoções do mesmo trecho. A estrela salva o trecho em **Rotas salvas** (só neste navegador).
- **Busca por cidade** – digite o nome da cidade, do aeroporto ou o código (ex.: "floripa", "nova york", "GRU") e escolha na lista.
- **Comprar direto na companhia** – botões que abrem o site oficial da companhia (LATAM, GOL, Azul, TAP, American, Aerolíneas, Copa) e dos programas de milhas (LATAM Pass, Smiles, Azul Fidelidade) com trecho, datas, passageiros e cabine preenchidos. Para companhias sem link de busca conhecido (Emirates, Air France, Iberia etc.) o botão abre o site oficial. As rotas atendidas por cada companhia ficam em `AIRLINES`.
- **Preço ao longo do ano** – anote o menor preço de cada mês e veja o gráfico (salvo no navegador).
- **Milhas ou dinheiro?** – calculadora do valor do milheiro.

## Rodar

Abra `index.html` no navegador.

## Site

O GitHub Pages publica a página a cada push (*Settings → Pages → Deploy from a branch*):
**https://adissoncosta.github.io/ADISSONCOSTA/**

Depois de cada publicação, o workflow `Site online` roda os testes contra o endereço online no Chromium, Firefox e WebKit (e também uma vez por dia).

## Preços reais (servidor)

Para o site mostrar o preço de cada companhia nos botões de compra e em "Para onde vamos viajar?", ele consulta um servidor próprio (`server/worker.js`, um Cloudflare Worker gratuito). O servidor guarda em segredo o token da [Travelpayouts](https://www.travelpayouts.com/) (API de dados do Aviasales) e devolve o menor preço de cada companhia para o trecho e as datas.

Os preços vêm de buscas recentes feitas por viajantes: podem estar algumas horas defasados, valem por adulto e só existem para a classe econômica. Quando não há preço para a data exata, o servidor devolve o melhor preço do mês da ida, e o site avisa.

**Configurar (uma vez):**

1. **Travelpayouts**: crie uma conta grátis em travelpayouts.com, entre no programa do Aviasales e copie o **API token** (perfil → *API token*).
2. **Cloudflare**: crie uma conta grátis em cloudflare.com. Em *My Profile → API Tokens → Create Token*, use o modelo **Edit Cloudflare Workers** e copie o token. Copie também o **Account ID** (aparece em *Workers & Pages*, no lado direito).
3. **GitHub**: em *Settings → Secrets and variables → Actions → New repository secret*, crie `TRAVELPAYOUTS_TOKEN`, `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.
4. Em *Actions → Servidor de preços → Run workflow*. O resumo do run mostra o endereço do servidor (ex.: `https://radar-precos.SEU-USUARIO.workers.dev`).
5. Coloque o endereço em `window.RADAR_API` no começo do `<script>` do `index.html`.

O servidor só aceita chamadas do site (`ALLOWED_ORIGINS` em `server/wrangler.toml`).

## Testar

Os testes rodam no GitHub Actions nos três motores de navegador a cada push (workflow `Testes`):

| Motor | Navegadores |
|---|---|
| Chromium | Google Chrome, Microsoft Edge, Opera, Samsung Internet |
| Firefox | Mozilla Firefox |
| WebKit | Safari no Mac, iPhone e iPad |

Para rodar localmente:

```bash
npm install
npx playwright install chromium firefox webkit
npm run test:chromium   # ou test:firefox, test:webkit
SITE_URL=https://adissoncosta.github.io/ADISSONCOSTA/ npm test   # testa o site online
```

O teste fixa o relógio em 02/11/2026; atualize as datas das ofertas em `DEALS` quando trocar as promoções.
