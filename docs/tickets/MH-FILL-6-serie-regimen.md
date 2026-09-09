# MH-FILL-6 — Serie temporal del régimen («Qué cambió»)

**Estado:** Hecho  
**Prioridad:** P1  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md` G7 / MH-FILL-6  
**Tipo:** market-health · historia del régimen US · persistencia app_settings  
**Cierre:** smoke «Qué cambió» vacío honesto + chips FILL-5 · tests/vfc OK  
**Depende de:** FILL-1…5 cerrados; **no** necesita decisión de mapa regional nueva

## Problema

Mercado es una **foto de hoy**. Weinstein/framework piden ver el régimen en el tiempo. Solo la participación RS ya trae serie semanal; el **market score** y el **% universo sobre MM30s** no tienen historia. La caché `market_health_cache` es un snapshot de ≤4 h, no una serie.

## Decisiones de implementación (v1 — sin reabrir producto)

| Tema | Elección v1 |
|---|---|
| Alcance geográfico | **Solo hero US** (score + amplitud US). Series por EU/JP/HK = oleada posterior |
| Ventana | Hasta **13** puntos semanales (mínimo útil ~8 cuando existan); mostrar los disponibles |
| Cadencia | **1 punto por semana ISO** (`weekKey`); al escribir caché tras refresh/cálculo vivo, upsert el punto de esa semana |
| Métricas por punto | `marketScore`, `above30wPct` (y `above30w` count/measured si caben), `regimeLabel` opcional, `asOf` / `weekKey` |
| Persistencia | `app_settings` clave dedicada (p. ej. `market_health_series` / type `market_health_series`) — ring buffer; **no** nueva tabla PG en v1 |
| Fallo RPC/Mini | Serie no escrita → `seriesWritten: false` + error; UI ausencia honesta; no tumbar `/market-health` |

## Alcance

1. **Módulo puro** (p. ej. `lib/marketHealthSeries.js`): merge punto → serie (dedupe por weekKey, cap 13, orden cronológico).
2. **Escritura** al persistir market-health (junto a `writeMarketHealthCache` o inmediatamente después en refresh vivo): leer serie, merge, upsert. Lectura en GET (caché o vivo) → campo `regimeSeries` (o nombre estable) en payload.
3. **UI** `/market-health`: bloque «Qué cambió» bajo el hero US — texto breve (Δ score / Δ % MM30s vs punto anterior) + spark/lista mínima de la serie; vacío honesto si &lt;2 puntos.
4. **Tests** merge/cap/dedupe + contrato route; `./vfc`. Sin commit/push.

## Fuera de alcance (NO)

| Tema | Motivo |
|---|---|
| Serie por región FILL-5 | Oleada 2 |
| Nueva migración/tabla Postgres | v1 = app_settings |
| weekly-changes de símbolos / screener «qué cambió» mesa | Otro diseño |
| Reabrir fórmula marketScore / weeklyStage | Congelado |
| Mini supervisor V1 / V1-02… | Línea aparte |
| Follow-through / A/D | No |

## Criterios

1. Tras ≥2 escrituras en semanas distintas (tests con fixtures), el payload expone serie ordenada.  
2. Misma semana ISO no duplica puntos (última gana).  
3. UI muestra Δ o ausencia; no inventa historia.  
4. Vitest OK · smoke orquestador con serie mock o real si Mini/RPC disponible.

Sin commit/push.
