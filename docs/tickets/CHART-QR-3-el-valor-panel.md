# CHART-QR-3 — Vista rápida: panel «El valor» vacío

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  
**Origen:** captura dueño 2026-08-31 (AMPL vista rápida: card «El valor» sin Etapa/RS/Cap visibles; «Sostén de la tendencia» sí con datos)  
**Depende de:** CHART-QR-1/2 opcional (mismo modal)  
**Copia activa:** tras CHART-QR-2

## Problema

En `QuickReviewModal.jsx` el bloque «El valor» renderiza siempre:

```jsx
<div className="profileRow"><span>Etapa</span><b>{stageWord(activeModalRow)}</b></div>
// RS, Capitalización, Dist. máx 52s
```

En captura del dueño el **header** del card se ve pero las filas parecen vacías (mientras otros cards del mismo `profileSide` sí muestran texto).

## Objetivo

Reproducir y corregir: Etapa, RS, Cap y Dist. 52s **legibles** en todo viewport desktop (≥1024) y móvil modal.

Causas a investigar (no asumir):

- CSS (`profileRow`, overflow, color, z-index, grid del modal).
- Fila sin datos (`"-"` invisible por contraste — improbable: `b` es `#fff`).
- Hidration / timing (card montada antes de `activeModalRow` completo).
- Scroll del `profileSide` que oculta filas (menos probable si el header está visible).

## Alcance

- Fix mínimo en JSX/CSS del modal.
- Test estático opcional: render `QuickReviewModal` con fila mock → assert Etapa/RS en HTML.
- Smoke Browser Use: vista rápida AMPL u otro → panel «El valor» con texto no vacío.

## Fuera

- Nuevos campos en el panel.
- `/review` salvo que comparta el mismo bug.
- commit/push.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
