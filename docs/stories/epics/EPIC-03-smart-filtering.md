# Epic 3 — Smart Deal Scoring & Intelligent Filtering

**ID:** EPIC-03
**Status:** Ready for Story Creation (após Epic 1 Done)
**Priority:** P1
**Owner:** @sm (stories) → @dev (implementação)
**PRD Reference:** `docs/prd/PRD-perfect-vacation-v2.md` — FR5, FR6, FR7

---

## Vision

Substituir filtros binários pass/fail por um sistema de scoring multidimensional que ranqueia deals por valor real — reduzindo alertas irrelevantes e garantindo que as melhores oportunidades apareçam primeiro.

## Problem Being Solved

O sistema atual filtra de forma absoluta: ou passa (5★ + all-inclusive + beachfront) ou é descartado. Não há noção de "bom deal" vs "deal excepcional". Um hotel 4.8★ a 40% abaixo do budget em destino preferido pode ser melhor que um 5★ no limite do budget — o sistema atual não captura essa nuance.

## Success Criteria

- [ ] Deal scorer calcula score 0-100 para cada deal
- [ ] Score aparece nas mensagens Telegram (ex: "⭐ 87/100")
- [ ] Deals são ordenados por score antes de enviar
- [ ] Máximo 5 deals por execução para evitar spam
- [ ] `MIN_SCORE` configurável via `.env` (default: 60)
- [ ] Novos parâmetros documentados em `.env.example`

## Stories (ordered)

| Story | Arquivo | Descrição | Estimativa |
|-------|---------|-----------|------------|
| 3.1 | `3.1.story.md` | Implementar `dealScorer.js` — engine de scoring multidimensional | M |
| 3.2 | `3.2.story.md` | Integrar scorer no pipeline (pós-filtro, pré-alert) | S |
| 3.3 | `3.3.story.md` | Refatorar sendTelegramAlert — ranking + agrupamento + MAX_ALERTS | S |
| 3.4 | `3.4.story.md` | Expandir `.env` com novos parâmetros configuráveis | XS |

## Scoring Model (Preview)

```javascript
// dealScorer.js — score 0-100
const score = {
  price:       (1 - deal.price / maxBudget) * 30,     // 30pts: quanto abaixo do budget
  stars:       (deal.stars / 5) * 25,                  // 25pts: rating normalizado
  amenities:   calcAmenities(deal.description) * 20,   // 20pts: all-incl, beachfront, etc
  season:      isPreferredMonth(deal.date) * 15,       // 15pts: meses de alta prioridade
  destination: isPreferredDest(deal.hotelName) * 10    // 10pts: destino preferido
};
return Object.values(score).reduce((a, b) => a + b, 0);
```

## Files Impacted

- `skills/` — ADD `dealScorer.js` (novo)
- `skills/applyQualityFilters.js` — MINOR (integrar pré-score como pre-filter)
- `skills/sendTelegramAlert.js` — MODERATE (ranking + agrupamento + score display)
- `bot_future_luxury.js` — MINOR (adicionar scorer no pipeline)
- `bot_last_minute.js` — MINOR (adicionar scorer no pipeline)
- `.env.example` — ADD novos parâmetros

## Dependencies

- **Epic 1 deve estar Done** — scorer depende de dados confiáveis do scraper
- Epic 2 pode rodar em paralelo com Epic 3

## Agent Assignment

| Fase | Agent | Tarefa |
|------|-------|--------|
| Story creation | @sm | `*draft` para stories 3.1-3.4 |
| Implementation | @dev | `*develop` em sequência 3.1 → 3.2 → 3.3 → 3.4 |
| QA Review | @qa | `*qa-gate` após conjunto completo |

---

*Epic 3 of 3 — Perfect Vacation Monitor v2.0*
