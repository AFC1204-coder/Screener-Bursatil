# STAGE-3 — `/review`: «Etapa» = Weinstein, no Trend Template

**Estado:** Activo  
**Prioridad:** P1  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md` A-3  
**Tipo:** review · mal nombrado · sin decisión de producto nueva

## Problema

En `app/review/page.jsx` (`evidenceRows`), la fila rotulada **«Etapa»** muestra `objectiveStage(row)` (`lib/scoring.js`) — Trend Template diario («Precio > SMA50 > SMA150 > SMA200»), no la etapa Weinstein de `stageDisplayForRow`. Misma palabra, otro significado (lección C-15).

## Alcance

1. Fila «Etapa» en `/review` usa `stageDisplayForRow` (palabra + calificador Pre-fuga/Con fuga/Dudoso/…).
2. Conservar `objectiveStage` con **otro rótulo** honesto (p. ej. «Estructura diaria» / «Trend Template»), no bajo «Etapa».
3. Tests del panel de evidencia / review tocados + `./vfc`.
4. Sin cambiar `weeklyStage.js` / scoring de régimen · sin MH-FILL · sin MET-7.

## Criterios

1. En `/review`, «Etapa» coincide semánticamente con la mesa para el mismo símbolo.
2. La lectura SMA50/150/200 sigue visible bajo nombre no «Etapa».
3. Vitest OK · smoke orquestador `/review`.

Sin commit/push.
