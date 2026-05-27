# Product Requirements Document — Perfect Vacation Monitor v2.0

## Overview

**Product:** Perfect Vacation Monitor
**Version:** 2.0.0
**Author:** Morgan (AIOX PM Agent)
**Date:** 2026-05-27
**Status:** Draft — Awaiting @po validation
**Type:** Brownfield Enhancement
**Project Path:** `C:\Users\henri\Desktop\Perfect vacation`

---

## 1. Problem Statement

O **Perfect Vacation Monitor** é um bot Node.js funcional que monitora ofertas de viagem no site da Sunwing.ca (partindo de Montreal/YUL), filtra por critérios de qualidade e envia alertas via Telegram. Embora operacional, o sistema apresenta três problemas críticos que limitam sua confiabilidade e utilidade:

1. **Fragilidade do scraper:** A extração de dados usa heurísticas de DOM genéricas (`[class*="Package"]`, traversal por texto) que quebram ao mínimo redesign do site Sunwing. A detecção de estrelas é baseada em guesswork textual (procura o caractere "5" no texto da card). Não há retry logic nem tratamento de falhas parciais.

2. **Execução totalmente manual:** Os bots precisam ser invocados manualmente via `node bot_*.js`. Não há agendamento automático, o que significa que deals podem ser perdidos em horários sem supervisão humana.

3. **Filtros binários sem inteligência:** O sistema aplica filtros pass/fail rígidos (5 estrelas + all-inclusive + beachfront para modo strict). Não há ranking de deals por valor, sem scoring que considere múltiplos fatores como relação preço/qualidade, destino preferido, ou temporada.

**Impacto:** Oportunidades de viagem excelentes são perdidas por falhas silenciosas do scraper, por falta de monitoramento contínuo, ou por filtros demasiado rígidos que eliminam deals de alto valor.

---

## 2. Goals & Objectives

| # | Objetivo | Prioridade | Medição |
|---|----------|------------|---------|
| G1 | Aumentar taxa de sucesso do scraper de ~60% para >95% | P0 | Taxa de execuções sem erro por semana |
| G2 | Eliminar dependência de execução manual | P0 | Uptime de monitoramento automático ≥ 23h/dia |
| G3 | Aumentar qualidade dos deals alertados com scoring inteligente | P1 | Satisfação do usuário com deals recebidos |
| G4 | Reduzir falsos positivos (deals sem real valor) | P1 | % de deals alertados que o usuário considera "bons" |
| G5 | Tornar o sistema configurável sem mudança de código | P2 | Parâmetros editáveis via `.env` |

---

## 3. Existing System Analysis

### 3.1 Arquitetura Atual

```
bot_future_luxury.js  ──►  fetchSunwingData('future', months)
bot_last_minute.js    ──►  fetchSunwingData('lastMinute')
                              │
                              ▼
                      applyQualityFilters(deals, strictMode)
                              │
                              ▼
                      syncWithNeon(filteredDeals)   ──► Neon PostgreSQL
                              │
                              ▼
                      sendTelegramAlert(alerts)     ──► Telegram
```

### 3.2 Stack Técnica

| Componente | Tecnologia | Versão |
|------------|-----------|--------|
| Runtime | Node.js (ESM) | 18+ |
| Scraping | Playwright + playwright-extra | ^1.49.1 |
| Anti-bot | puppeteer-extra-plugin-stealth | ^2.11.2 |
| Database | Neon PostgreSQL (via `pg`) | ^8.13.1 |
| Notificações | node-telegram-bot-api | ^0.66.0 |
| Config | dotenv | ^16.4.7 |

### 3.3 Problemas Técnicos Identificados (Debt Map)

| ID | Arquivo | Problema | Severidade |
|----|---------|----------|------------|
| D1 | `fetchSunwingData.js:49` | Selectors genéricos `[class*="Package"]` sem fallback estratégico | CRÍTICO |
| D2 | `fetchSunwingData.js:93-99` | Detecção de estrelas por heurística textual (procura "5", "4" no texto) | CRÍTICO |
| D3 | `fetchSunwingData.js` | Sem retry logic — falha única = scrape perdido | ALTO |
| D4 | `fetchSunwingData.js:106` | Data extraction via regex frágil, sem validação | MÉDIO |
| D5 | `syncWithNeon.js:23` | `CREATE TABLE IF NOT EXISTS` em produção a cada execução | MÉDIO |
| D6 | `applyQualityFilters.js` | Filtros binários sem scoring/ranking | BAIXO |
| D7 | Arquitetura | Sem agendamento — execução manual obrigatória | CRÍTICO |
| D8 | Arquitetura | Fonte única (Sunwing) — sem redundância | BAIXO |

### 3.4 Assets a Preservar

- ✅ Estrutura de skills (arquitetura modular está boa)
- ✅ Schema da tabela `travel_deals` no Neon
- ✅ Lógica de deduplicação e price-drop detection em `syncWithNeon.js`
- ✅ Formatação de mensagens Telegram em `sendTelegramAlert.js`
- ✅ Integração com `.env` para configuração

---

## 4. Functional Requirements

### FR1 — Scraper Resiliente com Multi-Strategy Extraction
**Prioridade:** P0 | **Epic:** 1

Implementar sistema de extração de dados em camadas com múltiplas estratégias:
- **Estratégia 1 (Primária):** Seletores específicos baseados em `data-testid` e classes CSS conhecidas do Sunwing
- **Estratégia 2 (Fallback):** Extração via JSON-LD / structured data (schema.org)
- **Estratégia 3 (Último recurso):** Heurística atual melhorada com validação mais rigorosa

A extração deve retornar dados com confidence score. Deals com score < 0.6 são descartados.

### FR2 — Detecção Precisa de Estrelas
**Prioridade:** P0 | **Epic:** 1

Implementar extração de rating com lógica de múltiplas fontes:
- Buscar atributos `data-rating`, `aria-label`, classes CSS de estrelas
- Parsear valores numéricos explícitos (ex: "4.5 out of 5")
- Verificar presença de ícones SVG de estrelas (contagem de elementos)
- Fallback: valor `null` (explícito) ao invés de guess incorreto

### FR3 — Retry Logic e Error Recovery
**Prioridade:** P0 | **Epic:** 1

Implementar mecanismo de retry com exponential backoff:
- Max 3 tentativas por URL com intervalo 5s, 15s, 30s
- Timeout por tentativa: 60s (navegação) + 30s (idle)
- Em caso de falha total: logar estruturalmente + enviar Telegram de status

### FR4 — Agendamento Automático via GitHub Actions
**Prioridade:** P0 | **Epic:** 2

Criar workflow `.github/workflows/` com dois cron jobs:
- `bot-future-luxury`: Executa diariamente às 08:00 ET (1x/dia)
- `bot-last-minute`: Executa a cada 6 horas (4x/dia: 06:00, 12:00, 18:00, 00:00 ET)
- Secrets do repositório para `DATABASE_URL`, `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, etc.
- Health check: enviar Telegram de confirmação após execução bem-sucedida

### FR5 — Sistema de Scoring de Deals
**Prioridade:** P1 | **Epic:** 3

Implementar scoring multidimensional para cada deal (0-100 pontos):

| Dimensão | Peso | Critérios |
|----------|------|-----------|
| Preço vs. budget | 30% | Quanto abaixo do MAX_BUDGET |
| Rating do hotel | 25% | Stars normalizadas (5★ = 100%) |
| Amenidades | 20% | All-inclusive, beachfront, adults-only (+bônus) |
| Temporada | 15% | Meses de alta/baixa preferidos pelo usuário |
| Destino | 10% | Match com `TARGET_DESTINATIONS` |

Score mínimo para alerta: configurável via `MIN_SCORE` em `.env` (default: 60).

### FR6 — Alertas com Ranking
**Prioridade:** P1 | **Epic:** 3

Modificar `sendTelegramAlert.js` para:
- Ordenar deals por score antes de enviar
- Incluir score visual no alerta (ex: ⭐ 87/100)
- Agrupar múltiplos deals em uma mensagem quando score similar (evita spam)
- Máximo de 5 alertas por execução para evitar flood

### FR7 — Configuração Expandida via .env
**Prioridade:** P2 | **Epic:** 3

Expor novos parâmetros configuráveis:
```env
MIN_SCORE=60              # Score mínimo para alertar
MAX_ALERTS_PER_RUN=5      # Máximo de alertas por execução
PREFERRED_DESTINATIONS=   # Destinos com bônus de score (ex: "Cancun,Punta Cana")
PEAK_MONTHS=              # Meses de alta prioridade (ex: "2026-10,2026-12")
MIN_STARS_RELAXED=4       # Mínimo de estrelas no modo relaxado
```

---

## 5. Non-Functional Requirements

| Categoria | Requisito |
|-----------|-----------|
| **Confiabilidade** | Taxa de sucesso do scraper > 95% medida por semana |
| **Resiliência** | Sistema deve continuar operando em caso de falha parcial (uma URL falha, outras continuam) |
| **Observabilidade** | Logs estruturados com timestamp, mode, URLs processadas, deals encontrados, erros |
| **Manutenibilidade** | Cada skill deve ter responsabilidade única; mudança de seletor não afeta lógica de negócio |
| **Compatibilidade** | Manter compatibilidade com schema atual da tabela `travel_deals` no Neon |
| **Segurança** | Nenhuma credencial hardcoded; todas via variáveis de ambiente |
| **Performance** | Execução de um bot completo em < 5 minutos |

---

## 6. Brownfield Considerations

### 6.1 Pontos de Integração (Preservar)
- Neon PostgreSQL — Schema `travel_deals` deve ser mantido (adicionar colunas via migration, nunca recriar)
- Telegram API — Formato de mensagens existente mantido, com adições
- `.env` — Novas vars adicionadas são opcionais com defaults sensatos

### 6.2 Estratégia de Migração

**Princípio:** Enhancement incremental — nenhum arquivo existente é deletado antes da substituição funcionar.

```
Fase 1: Criar skills novas (fetchSunwingDataV2, dealScorer)
        → testar em paralelo com originais
        → quando validado, atualizar imports nos bots
        
Fase 2: Adicionar GitHub Actions
        → testar manualmente primeiro via workflow_dispatch
        → após validação, ativar cron schedule
        
Fase 3: Adicionar scoring ao pipeline
        → filtros existentes permanecem como pre-filter
        → scoring adiciona camada de ranking pós-filtro
```

### 6.3 Riscos de Migração

| Risco | Mitigação |
|-------|-----------|
| Novos seletores Sunwing falham silenciosamente | Confidence score + fallback para v1 heurístico |
| GitHub Actions cota gratuita insuficiente | Verificar: 2000 min/mês free é suficiente para 4+1 = 5 runs/dia × ~3 min = ~450 min/mês |
| Schema Neon quebra com nova coluna | Migration script seguro com `ADD COLUMN IF NOT EXISTS` |

---

## 7. Success Metrics

| Métrica | Baseline Atual | Target v2.0 | Método de Medição |
|---------|----------------|-------------|-------------------|
| Taxa de sucesso do scraper | ~60% (estimado) | >95% | Log de execuções/semana |
| Cobertura de monitoramento | ~10% (manual) | >95% (automático) | Uptime de runs/dia |
| Deals com score ≥ 60 alertados | N/A | 100% dos alertados | Verificação no log |
| Falsos negativos (deals perdidos) | Desconhecido | <5%/semana | Spot checks manuais |
| Tempo de execução por bot | ~3-4 min | <5 min | Log de duração |

---

## 8. Timeline & Milestones (Épicos)

### Epic 1 — Scraping Resilience 🔧
**Prioridade:** P0 | **Complexidade:** STANDARD | **Estimativa:** 3-5 stories

| Story | Descrição |
|-------|-----------|
| 1.1 | Implementar multi-strategy extraction com confidence scoring |
| 1.2 | Refatorar detecção de estrelas com múltiplas fontes |
| 1.3 | Implementar retry logic com exponential backoff |
| 1.4 | Adicionar structured logging e health check via Telegram |

### Epic 2 — Automatic Scheduling ⏰
**Prioridade:** P0 | **Complexidade:** SIMPLE | **Estimativa:** 2-3 stories

| Story | Descrição |
|-------|-----------|
| 2.1 | Criar GitHub Actions workflow para bot_future_luxury (diário) |
| 2.2 | Criar GitHub Actions workflow para bot_last_minute (6h) |
| 2.3 | Configurar secrets e testar com workflow_dispatch |

### Epic 3 — Smart Filtering & Scoring 🧠
**Prioridade:** P1 | **Complexidade:** STANDARD | **Estimativa:** 3-4 stories

| Story | Descrição |
|-------|-----------|
| 3.1 | Implementar deal scoring engine (dealScorer.js) |
| 3.2 | Integrar scoring no pipeline pós-filtro |
| 3.3 | Refatorar sendTelegramAlert para ranking + agrupamento |
| 3.4 | Expor novos parâmetros configuráveis no .env |

**Sequência recomendada:** Epic 1 → Epic 2 → Epic 3

---

## 9. Risks & Mitigations

| Risco | Impacto | Probabilidade | Mitigação |
|-------|---------|---------------|-----------|
| Sunwing redesign quebra todos seletores | Alto | Média | Multi-strategy extraction + monitoring por score de confiança |
| GitHub Actions cota gratuita excedida | Médio | Baixa | Verificar cota antes; fallback para node-cron local se necessário |
| Neon DB connection pool esgotado | Alto | Baixa | Implementar connection pooling adequado; garantir `client.end()` em finally |
| Telegram rate limit com muitos alerts | Baixo | Baixa | Delay entre mensagens já existe; limitar max 5 alerts/run |
| Mudança na estrutura de URLs Sunwing | Alto | Média | Validar URL antes de scrape; alertar via Telegram em caso de 404 |

---

## 10. Out of Scope (v2.0)

- ❌ Múltiplas fontes além da Sunwing (Air Transat, etc.) — backlog v3.0
- ❌ Interface web/dashboard para visualizar deals
- ❌ Machine Learning real (apenas rule-based scoring nesta versão)
- ❌ Suporte a múltiplos usuários/chat IDs
- ❌ Destinos de partida além de YUL (Montreal)

---

## 11. Definition of Done (Epic Level)

- [ ] Todos os bots executam sem erro em 3 runs consecutivos
- [ ] Taxa de sucesso do scraper > 95% em 1 semana de monitoramento
- [ ] GitHub Actions ativo e disparando nos schedules configurados
- [ ] Score aparece nas mensagens Telegram
- [ ] Logs estruturados com timestamp em cada execução
- [ ] Schema Neon atualizado via migration segura (sem perda de dados)
- [ ] `.env.example` atualizado com todas as novas variáveis

---

**Generated by:** Morgan (AIOX PM Agent) — Synkra AIOX v2.0
**Template:** prd-v2.0 (brownfield)
**Next Step:** @po validation → @sm story creation (Epic 1 first)
