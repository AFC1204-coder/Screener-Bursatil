# Ticket activo — STAGE-3

**Estado:** activo programación  
**Rama:** `codex/statsedge-ui-polish`  
**Ticket:** `docs/tickets/STAGE-3-review-etapa-weinstein.md`  
**Modelo:** Composer  
**Tipo:** review naming · sin commit/push  
**Informe:** `docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md` A-3

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/tickets/STAGE-3-review-etapa-weinstein.md
@docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md

Rama: codex/statsedge-ui-polish
Modelo: Composer

Alcance (solo esto):
1. En /review, la fila «Etapa» usa stageDisplayForRow (Weinstein + calificador), no objectiveStage.
2. Conservar objectiveStage bajo un rótulo honesto (estructura diaria / Trend Template), no «Etapa».
3. Tests + ./vfc tocados.

Sin weeklyStage.js, scoring de régimen, MH-FILL, MET-7, STAGE-4.
Sin commit ni push.

Al terminar, resume con la plantilla de retorno (Resumen / Archivos / Tests / LO QUE NO VERIFIQUÉ).
```

## Criterios de aceptación (orquestador)

1. Smoke `/review`: «Etapa» = mesa; SMA bajo otro nombre.  
2. Tests OK.
