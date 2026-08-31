# MET-4c — Muletas en vista rápida

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  
**Specs:** `docs/spec-muletas-tendencia.md` (MET-4 aceptado) · campos ya en scan vía MET-4b (`weeksAboveSma*`, avance, volumen)  
**Copia activa:** `docs/tickets/activo.md`  
**MIGRATE:** fuera (aparcado)

## Objetivo

Superficie siguiente del track muletas: en **vista rápida** (`QuickReviewModal`), mostrar el bloque **«Sostén de la tendencia»** con las mismas tres lecturas que la ficha (persistencia MA, aceleración, volumen) — mismos textos / ausencias, sin reinventar.

## Alcance

1. Reutilizar `buildTrendSupportLines` / campos de fila ya proyectados (`weeksAboveSma30w`, etc.). Preferir datos de la fila del scan; si faltan barras en modal, no inventar.
2. UI en `app/components/screener/QuickReviewModal.jsx` (o hijo): bloque compacto trader-facing; sin semáforos; sin colorear por rango.
3. Tests: render con campos presentes / ausencia con motivo; scoring untouched; sin columna tabla.
4. Smoke visual: orquestador (Browser Use) — abrir vista rápida de un líder Etapa 2.

## Fuera (este ticket)

- Filtro hunt de persistencia / salud (ticket propio si el dueño lo pide).
- «Salud de etapa» en vista rápida (MET-5 superficie futura).
- Columna de tabla, scoring, `weeklyStage.js`, MIGRATE, commit/push.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
