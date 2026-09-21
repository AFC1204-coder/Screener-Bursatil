# EUROPA-COVERAGE-TRUTH-1 — preset Europa: cobertura honesta

Copia de referencia. Ejecutar desde `docs/tickets/activo.md`.

**Estado:** prep  
**Rama:** `codex/statsedge-ui-polish` @ `09a7ac5`  
**Modelo:** Composer 2.5 (o Terra)  
**Plan:** `plan-datos-fiabilidad.md` item 5 · slice A (truth / availability)

## Objetivo

Cuando el usuario elige preset **Europa**, la UI no debe presentarse como cobertura completa si la mesa es parcial — en especial huecos en `EUROPE_SECONDARY_MARKETS` (copy prioritario: **IE**, **PT**).

## Por qué este slice (no B/C)

| Opción | Qué | Decisión |
|---|---|---|
| **A** Truth / availability | % o huecos secundarios explícitos en truth/banner | **Este ticket** — cierra done-when del plan («Europa nunca completa si parcial») sin nocturno |
| B Cron / yield EU | Checklist + lote medido | Cola — ops, Mini, no reescribir nocturno prod |
| C FIRDS / curated-fallback warning | Aviso cuando población parcial | Cola — half-built en `universeEngine`; no cableado a UI mesa |

P9 ya avisa «Cobertura parcial» + CTAs si selección≠mesa. Falta: tipificar secundarios Europa (IE/PT) y no pintar Europa-15 como completa cuando solo hay priority en mesa.

## Alcance

1. Preset `europe` / selección Europa-15: si faltan mercados en mesa (sobre todo secundarios), truth line y/o notice P9 con huecos explícitos en copy de producto.
2. Mesa = solo priority (EU1) con selección Europa-15 → aviso de secundarios ausentes; no «Europa completa».
3. Reusar `lib/marketAvailability.js`, `lib/screenerTruthLine.js`, notices existentes. Tests + `./vfc`/vitest.

## Fuera

Cron EU, FIRDS flags, curated-fallback surfacing, scoring, auth, nocturno prod, yield batch, panel laboratorio `/api/coverage` (salvo lectura).

## Done when

- Tests focalizados verdes
- Smoke orquestador: preset Europa → copy de huecos legible
- Sin commit/push desde programación

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
