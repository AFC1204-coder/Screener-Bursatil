# Ticket activo — STAGE-2

**Estado:** activo programación  
**Rama:** `codex/statsedge-ui-polish`  
**Ticket:** `docs/tickets/STAGE-2-motivo-calificador.md`  
**Modelo:** Composer  
**Tipo:** stageDisplay honestidad · sin commit/push  
**Informe:** `docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md` A-2

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/tickets/STAGE-2-motivo-calificador.md
@docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md

Rama: codex/statsedge-ui-polish
Modelo: Composer

Alcance (solo esto):
1. Cuando weeklyStageStructure es n/a, pintar el motivo ya calculado (weeklyStageStructureDetail / ausencia descriptiva) vía lib/stageDisplay.js — no silencio «Etapa 2» a secas.
2. Herencia a mesa/ficha/vista rápida por el mismo helper.
3. Tests stageDisplay + ./vfc tocados.

Sin tocar reglas de weeklyStage.js / weeklyStageStructure.js.
Sin MH-FILL-3/5, STAGE-3 (/review Trend Template), scoring, régimen regional.
Sin commit ni push.

Al terminar, resume con la plantilla de retorno (Resumen / Archivos / Tests / LO QUE NO VERIFIQUÉ).
```

## Criterios de aceptación (orquestador)

1. Mesa: filas stage2 sin calificador muestran motivo (dudoso / histórico corto / no aplica).  
2. Tests OK · smoke orquestador.
