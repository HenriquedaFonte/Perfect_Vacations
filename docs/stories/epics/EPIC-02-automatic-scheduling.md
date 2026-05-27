# Epic 2 — Automatic Scheduling via GitHub Actions

**ID:** EPIC-02
**Status:** Ready for Story Creation (após Epic 1 Done)
**Priority:** P0
**Owner:** @sm (stories) → @dev (workflows) → @devops (push/secrets)
**PRD Reference:** `docs/prd/PRD-perfect-vacation-v2.md` — FR4

---

## Vision

Eliminar a dependência de execução manual dos bots transformando-os em rotinas automáticas via GitHub Actions — garantindo monitoramento contínuo 24/7 sem intervenção humana.

## Problem Being Solved

Atualmente ambos os bots exigem execução manual via `node bot_*.js`. Sem agendamento, deals são perdidos em qualquer horário sem supervisão ativa. Um sistema de monitoramento de preços deve ser, por definição, autônomo.

## Success Criteria

- [ ] `bot_future_luxury` executa automaticamente 1x/dia às 08:00 ET
- [ ] `bot_last_minute` executa automaticamente 4x/dia (06h, 12h, 18h, 00h ET)
- [ ] Ambos os workflows podem ser disparados manualmente via `workflow_dispatch`
- [ ] Secrets configurados no repositório (sem credenciais no código)
- [ ] Telegram recebe confirmação de execução bem-sucedida

## Stories (ordered)

| Story | Arquivo | Descrição | Estimativa |
|-------|---------|-----------|------------|
| 2.1 | `2.1.story.md` | GitHub Actions workflow — bot_future_luxury (cron diário) | S |
| 2.2 | `2.2.story.md` | GitHub Actions workflow — bot_last_minute (cron 6h) | S |
| 2.3 | `2.3.story.md` | Setup de secrets + teste end-to-end via workflow_dispatch | S |

## Files Impacted

- `.github/workflows/` — ADD `bot-future-luxury.yml`, `bot-last-minute.yml` (novos)
- `package.json` — ADD scripts `start:future` e `start:lastminute`
- `.env.example` — Documentar todas as vars necessárias para CI

## Dependencies

- **Epic 1 deve estar Done** — scraper resiliente garante que os runs automáticos não falhem silenciosamente
- Repositório GitHub deve existir (criar se necessário)

## Agent Assignment

| Fase | Agent | Tarefa |
|------|-------|--------|
| Story creation | @sm | `*draft` para stories 2.1-2.3 |
| Implementation | @dev | Criar YAML dos workflows |
| Push/Secrets | @devops | `git push` + configurar GitHub Secrets (EXCLUSIVO) |
| QA Review | @qa | Validar workflows via `workflow_dispatch` |

## GitHub Actions Config (Preview)

```yaml
# bot-last-minute.yml
schedule:
  - cron: '0 6,12,18,0 * * *'   # UTC offset para ET

# bot-future-luxury.yml  
schedule:
  - cron: '0 13 * * *'           # 08:00 ET = 13:00 UTC (padrão)
```

---

*Epic 2 of 3 — Perfect Vacation Monitor v2.0*
