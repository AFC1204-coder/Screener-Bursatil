# MH-FILL-5 — Régimen por región (US · EU · JP · HK)

**Estado:** Hecho  
**Prioridad:** P1  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/tickets/MH-FILL-5-decisiones-2026-09-10.md` (dueño 2026-09-10)  
**Tipo:** market-health · régimen paralelo · amplitud por filas · sin score mundial único  
**Cierre:** smoke chips US/EU/JP/HK (SPY/FEZ/EWJ/EWH) · hero US · tests 17/18 + suite route

## Decisiones fijadas (no reabrir)

1. Termómetro = **ETF líquido** del índice del mercado (no `^…`).
2. Veredictos **en paralelo** (opción A): US / EU / JP / HK.
3. **Amplitud** = agregado de **acciones** del nocturno por geografía; cobertura insuficiente → ausencia. El ETF **no** sustituye amplitud.
4. Sectores SPDR = **solo US** en v1.
5. Barras ETF vía stack actual; fallo → ausencia declarada.
6. **Alcance v1 países:** US + EU + JP + HK (AU/CA/GB fuera de v1).

### Mapa ETF v1

| Clave | ETF | Nombre |
|---|---|---|
| US | SPY | S&P 500 |
| EU | FEZ | Euro Stoxx 50 |
| JP | EWJ | MSCI Japan |
| HK | EWH | MSCI Hong Kong |

## Problema

El régimen / market score / StageStrip hablan casi solo US (SPY cesta + SPDR). El producto es multi-mercado; hace falta etapa+amplitud por región en paralelo.

## Alcance

1. **Config** única (p. ej. `lib/marketRegions.js`): claves US/EU/JP/HK, ETF, países ISO para filtrar filas (`US`; EU = lista actual del panel; `JP`; `HK`).
2. **Por región:** etapa Weinstein + estructura (mismos módulos que FILL-1) sobre barras del ETF; amplitud (al menos % sobre MM30s; reutilizar umbral cobertura tipo breadth) sobre `scan_results` filtrados por país de esa región.
3. **API:** extender `/api/market-health` y/o ruta hermana con `regimes[]` / por clave; US puede seguir alimentando el hero actual **declarando** que es US, o el hero pasa a selector — preferir: **hero = US** + franja/chips de regímenes hermanos (paralelo), sin mezclar en un score global.
4. **UI `/market-health`:** chips o fila de régimen por US/EU/JP/HK (etapa + calificador + amplitud o «sin cobertura»); alinear copy de `GlobalRegionsPanel` benchmarks con el mapa ETF.
5. **Tests** del mapa, agregación amplitud por país, payload régimen; `./vfc`. Sin commit/push.

## Fuera de alcance (NO)

| Tema | Motivo |
|---|---|
| AU / CA / GB / ACWI como régimen v1 | Fuera del corte dueño |
| Sectores no-US | Fase posterior |
| MH-FILL-6 serie temporal | Ticket aparte |
| Score mundial ponderado | Choca con decisión A |
| weeklyStage/scoring fórmulas | Congelado |
| Mini V1 / supervisor | Línea aparte |
| A/D, follow-through | No |

## Criterios

1. Cuatro regiones visibles en paralelo con ETF del mapa.  
2. Amplitud de una región con pocas filas → ausencia, no inventada desde el ETF.  
3. US SPDR sin cambio de alcance.  
4. Vitest + smoke orquestador `/market-health`.

Sin commit/push.
