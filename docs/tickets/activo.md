# Ticket activo — MH-FILL-1

**Estado:** activo programación  
**Rama:** `codex/statsedge-ui-polish`  
**Ticket:** `docs/tickets/MH-FILL-1-etapa-estructural-mercado.md`  
**Modelo:** Composer  
**Tipo:** market-health paridad etapa · sin commit/push  
**Informe:** `docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md`

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/tickets/MH-FILL-1-etapa-estructural-mercado.md
@docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md

Rama: codex/statsedge-ui-polish
Modelo: Composer

Alcance (solo esto):
1. Paridad de criterio: índices/sectores en /market-health usan weeklyStageStructureForBars (+ display Pre-fuga/Con fuga) como la mesa.
2. Borrar stageLabel muerto del payload de /api/market-health.
3. Tests + ./vfc tocados.

Sin MH-FILL-3/5, STAGE-2, scoring, régimen regional.
Sin commit ni push.

Al terminar, resume con la plantilla de retorno (Resumen / Archivos / Tests / LO QUE NO VERIFIQUÉ).
```

## Criterios de aceptación (orquestador)

1. Smoke `/market-health`: calificador coherente.  
2. Tests OK.
