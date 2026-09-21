# Ticket activo — EUROPA-COVERAGE-TRUTH-1

**Estado:** prep  
**ID:** EUROPA-COVERAGE-TRUTH-1  
**Rama:** `codex/statsedge-ui-polish` @ `09a7ac5`  
**Modelo:** Composer 2.5 (o Terra)  
**Plan:** item 5 cobertura intl · slice A (honestidad UI; no yield cron)

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md

Eres programación StatsEdge (NO orquestador). Rama: codex/statsedge-ui-polish @ 09a7ac5.
Modelo: Composer 2.5 (o Terra). SIN commit ni push.

Ticket EUROPA-COVERAGE-TRUTH-1 — preset Europa no se presenta como cobertura completa.

Contexto (no inventar): plan item 5 «yield Europa»; P9 ya tiene banner «Cobertura parcial» + CTAs cuando selección≠mesa; EUROPE_SECONDARY_MARKETS (DK/NO/FI/BE/PT/AT/IE) en lib/markets.js; preset `europe` = 15 mercados (lib/screenerConfig EUROPE); truth line vía lib/screenerTruthLine.js + buildScreenerTruthMarketSegments (lib/marketAvailability.js). Gap: con preset Europa la UI puede sugerir universo completo aunque falten secundarios (IE/PT tipificados) o la mesa sea solo priority.

Alcance (closable):
1) Cuando la selección sea preset Europa (o ≥N mercados EUROPE / región Europa), si la mesa no cubre todos los seleccionados — en especial EUROPE_SECONDARY (prioridad copy: IE y PT) — extender truth line y/o notice P9 para decirlo en lenguaje de producto (huecos explícitos; no jerga «selección≠mesa»).
2) Si la mesa ya está alineada pero solo trae priority (EU1) mientras la selección es Europa-15: no pintar como «Europa completa»; aviso corto de secundarios ausentes o finos.
3) Reusar marketAvailability / screenerTruthLine / notices existentes. Tests focalizados (marketAvailability + truth line). `./vfc` o vitest del ticket en verde.
4) Smoke orquestador (Browser Use): preset Europa → copy honesto de huecos; no inventar % si no hay dato de filas/coverage ya cableado.

No tocar: cron EU / shadow-europe / FIRDS flags / universeEngine curated-fallback (cola B/C), scoring, nocturno prod, auth, yield batch, GlobalCoveragePanel laboratorio salvo lectura.

Plantilla Resumen / Archivos / Tests / LO QUE NO VERIFIQUÉ. Sin commit ni push.
```

## Objetivo

Honestidad de producto al elegir **Europa**: la mesa/truth nunca implica cobertura completa si faltan mercados (sobre todo secundarios IE/PT) o si solo hay priority cargados.

## Fuera de alcance

- Yield cron / lote nocturno EU medido (YIELD-EU-1 · cola B)
- Aviso FIRDS off → curated-fallback (cola C)
- Twelve Data / Hito 1B / scoring / auth

## Done when

- Tests del ticket verdes + `./vfc` (o vitest acotado) OK
- Orquestador: smoke Browser preset Europa con copy de huecos legible
- Diff solo UI/copy/availability + tests

## Notas orquestador

- Slice elegido: **A** (S–M) — máximo leverage vs plan «Europa nunca completa si parcial»; B/C quedan en cola.
- HEAD activación: `09a7ac5`.
