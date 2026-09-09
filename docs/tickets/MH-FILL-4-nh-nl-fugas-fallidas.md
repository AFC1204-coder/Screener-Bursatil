# MH-FILL-4 — NH/NL + fugas fallidas (amplitud real)

**Estado:** Hecho  
**Prioridad:** P1  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer (orquestador)  
**Origen:** `docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md` G5/G6 · MH-FILL-4  
**Tipo:** market-health · agregado sobre nocturno US · sin decisión de producto nueva  
**Cierre:** tests 18/18 breadth+leadership; smoke UI limitado (API amplitud/liderazgo down en local)

## Problema

Checklist Mercado: faltan **nuevos máximos / nuevos mínimos** visibles como amplitud del universo y la **tasa de fugas fallidas entre líderes**. `failedBreakout` ya existe por fila; `distance52w` / `lowAdvance52w` también. Falta agregar y mostrar.

## Dependencias

| Ticket | Relación |
|---|---|
| MH-FILL-1/2/3 | Cerrados; misma población nocturna US |
| MH-FILL-5 | **No depende** (no régimen regional) |
| MH-FILL-6 | Serie temporal — aparte |

## Alcance

1. **Amplitud** (`lib/marketBreadth.js`): indicador de cercanía al **mínimo 52s** (`lowAdvance52w ≤ 1%`, simétrico a `nearHigh52w`); labels honestos NH/NL; leer `lowAdvance52w` del nocturno.
2. **Liderazgo** (`lib/marketLeadership.js`): entre la lista de líderes del pulse, % / conteo con `failedBreakout`; campo en payload; KPI en UI Leadership pulse.
3. Tests + `./vfc` tocados. Sin weeklyStage/scoring/Mini/V1.

## Criterios

1. Universo breadth expone near-high y near-low 52s con cobertura declarada.  
2. Pulse expone tasa de fugas fallidas **entre líderes** (o ausencia honesta).  
3. Vitest OK · smoke `/market-health` labels visibles.
