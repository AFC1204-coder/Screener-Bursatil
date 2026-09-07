# STAGE-2 — Motivo de ausencia del calificador estructural

**Estado:** prep (siguiente tras MH-FILL-1)  
**Prioridad:** P1  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md` A-2  
**Tipo:** mesa / stageDisplay · dato ya existe

## Problema

Cuando `weeklyStageStructure === "n/a"`, la mesa muestra «Etapa 2» (u otra) **sin motivo**, aunque `weeklyStageStructureDetail` ya distingue dudoso / histórico corto / no aplica.

## Alcance (cuando se active)

1. En `lib/stageDisplay.js` (patrón ausencia descriptiva): pintar el motivo cuando el calificador no aplica.
2. Herencia automática a mesa/ficha/vista rápida vía el mismo helper.
3. Tests `stageDisplay` + `./vfc`.
4. Sin cambiar `weeklyStage.js` / `weeklyStageStructure.js` reglas.

Sin commit/push hasta activación.
