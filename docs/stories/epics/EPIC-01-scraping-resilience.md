# Epic 1 — Scraping Resilience & Reliability

**ID:** EPIC-01
**Status:** Ready for Story Creation
**Priority:** P0 (BLOCKER — deve ser feito antes dos outros epics)
**Owner:** @sm (criação de stories) → @dev (implementação)
**PRD Reference:** `docs/prd/PRD-perfect-vacation-v2.md` — FR1, FR2, FR3, FR4

---

## Vision

Transformar o scraper frágil do Perfect Vacation Monitor em um sistema resiliente com múltiplas estratégias de extração, retry automático e confidence scoring — garantindo que ofertas reais nunca sejam perdidas por falhas técnicas evitáveis.

## Problem Being Solved

O `fetchSunwingData.js` atual usa heurísticas de DOM genéricas que quebram ao menor redesign do site Sunwing. A detecção de estrelas baseia-se em presença do caractere "5" ou "4" no texto, gerando falsos positivos. Não há retry — uma falha de rede = scrape perdido silenciosamente.

## Success Criteria

- [ ] Taxa de extração com sucesso > 95% (medida por 1 semana)
- [ ] Confidence score < 0.6 descarta deal automaticamente (sem falsos positivos)
- [ ] 3 tentativas automáticas antes de reportar falha
- [ ] Falha total reportada via Telegram (sem silêncio)
- [ ] Logs estruturados com timestamp, URL, deals encontrados, erros

## Stories (ordered)

| Story | Arquivo | Descrição | Estimativa |
|-------|---------|-----------|------------|
| 1.1 | `1.1.story.md` | Multi-strategy extraction + confidence scoring | M |
| 1.2 | `1.2.story.md` | Refatorar detecção de estrelas (multi-source) | S |
| 1.3 | `1.3.story.md` | Retry logic com exponential backoff | S |
| 1.4 | `1.4.story.md` | Structured logging + health check Telegram | S |

## Files Impacted

- `skills/fetchSunwingData.js` — MAJOR REFACTOR (preservar interface pública)
- `skills/sendTelegramAlert.js` — MINOR (adicionar health check message type)
- `skills/` — ADD `extractionStrategies.js` (novo, strategies isoladas)

## Dependencies

- Nenhuma dependência externa — pode iniciar imediatamente
- Epic 2 e Epic 3 dependem deste estar Done

## Agent Assignment

| Fase | Agent | Tarefa |
|------|-------|--------|
| Story creation | @sm | `*draft` para cada story deste epic |
| Story validation | @po | `*validate-story-draft` |
| Implementation | @dev | `*develop` cada story em sequência |
| QA Review | @qa | `*qa-gate` após cada story |

---

*Epic 1 of 3 — Perfect Vacation Monitor v2.0*
