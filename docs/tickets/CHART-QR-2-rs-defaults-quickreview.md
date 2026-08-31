# CHART-QR-2 — RS país/tema OFF por defecto en vista rápida y review

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  
**Origen:** feedback dueño 2026-08-31 (badge RS país 0 + banda «Sin línea RS país…» casi siempre)  
**Depende de:** nada (puede ir en paralelo a CHART-QR-1 si no tocan los mismos archivos; si colisiona, después de QR-1)  
**Copia activa:** tras CHART-QR-1

## Problema

`DEFAULT_CHART_SETTINGS.indicators` tiene `rsCountryLine: true` y `rsThemeLine: true`. En vista rápida/review la mayoría de símbolos **no tienen** serie semanal país/tema → badge `0` + franja de aviso en el chart. Parece error de carga.

## Objetivo

En **QuickReviewModal** y **`/review`** solamente:

- Al montar / scope `quickReview` o equivalente: **RS global ON**, **RS país OFF**, **RS tema OFF** por defecto (sin borrar preferencia del usuario en ficha si usa scope distinto).
- El usuario puede reactivarlos desde ChartPreferences si quiere.
- Ficha `/stock/[symbol]` **sin cambio** de defaults globales salvo que el scope ya lo separe (preferir scope `quickReview` en `lib/chartSettings.js` / storage).

## Alcance

- Scope o preset de chart settings para modal + review.
- Tests de normalización de settings por scope.
- Smoke: abrir vista rápida → toggles RS país/tema off; sin banda «Sin línea RS país» salvo que el usuario los active.

## Fuera

- Quitar overlays RS país/tema de la ficha.
- Backfill datos MET-2b/3b.
- commit/push.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
