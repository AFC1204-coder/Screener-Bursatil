# STAGE-2 — Motivo de ausencia del calificador estructural

**Estado:** Hecho  
**Prioridad:** P1  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md` A-2  
**Tipo:** mesa / stageDisplay · dato ya existe  
**Cierre:** smoke mesa Líderes E2 — «Dudoso» + «Con fuga» en columna Etapa; tooltip con detail  
**Nota:** filas sin `weeklyStageStructureDetail` persistido siguen sin calificador de ausencia.

## Problema

Cuando `weeklyStageStructure === "n/a"`, la mesa muestra «Etapa 2» (u otra) **sin motivo**, aunque `weeklyStageStructureDetail` ya distingue dudoso / histórico corto / no aplica.

## Alcance

1. En `lib/stageDisplay.js` (patrón ausencia descriptiva): pintar el motivo cuando el calificador no aplica.
2. Herencia automática a mesa/ficha/vista rápida vía el mismo helper.
3. Tests `stageDisplay` + `./vfc`.
4. Sin cambiar `weeklyStage.js` / `weeklyStageStructure.js` reglas.
5. Sin STAGE-3 (`/review` «Etapa» = Trend Template) · sin MH-FILL.

## Criterios

1. Filas con estructura `n/a` no callan: muestran motivo legible (dudoso / histórico corto / no aplica).
2. Vitest OK · smoke orquestador en mesa.

Sin commit/push.

