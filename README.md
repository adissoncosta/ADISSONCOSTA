# Radar de Passagens

Página única (HTML/CSS/JS, sem dependências) para achar passagens aéreas promocionais saindo do Brasil:

- **Promoções encontradas** – ofertas em reais e em milhas, com botão de compra na companhia ou no programa de milhas. Ofertas vencidas somem sozinhas (campos `until` e `date` em `DEALS`).
- **Busca por cidade** – digite o nome da cidade, do aeroporto ou o código (ex.: "floripa", "nova york", "GRU") e escolha na lista.
- **Comprar direto na companhia** – botões que abrem o site oficial da companhia (LATAM, GOL, Azul, TAP, American, Aerolíneas, Copa) e dos programas de milhas (LATAM Pass, Smiles, Azul Fidelidade) com trecho, datas, passageiros e cabine preenchidos. Para companhias sem link de busca conhecido (Emirates, Air France, Iberia etc.) o botão abre o site oficial. As rotas atendidas por cada companhia ficam em `AIRLINES`.
- **Preço ao longo do ano** – anote o menor preço de cada mês e veja o gráfico (salvo no navegador).
- **Milhas ou dinheiro?** – calculadora do valor do milheiro.

## Rodar

Abra `index.html` no navegador.

## Testar

```bash
npm i -D playwright   # se ainda não tiver
node tests/smoke.js
```

O teste fixa o relógio em 02/11/2026; atualize as datas das ofertas em `DEALS` quando trocar as promoções.
