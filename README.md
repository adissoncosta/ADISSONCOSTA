# Radar de Passagens

Página única (HTML/CSS/JS, sem dependências) para achar passagens aéreas promocionais saindo do Brasil:

- **Promoções encontradas** – ofertas em reais e em milhas, com link para a fonte. Ofertas vencidas somem sozinhas (campos `until` e `date` em `DEALS`).
- **Buscar agora** – monta a mesma busca no Google Voos, Skyscanner, Kayak, Momondo e programas de milhas.
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
