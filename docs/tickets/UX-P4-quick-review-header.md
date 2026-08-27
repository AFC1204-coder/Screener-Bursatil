# UX-P4 — Cabecera Vista rápida: navegación + triage nítidos

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-ux-producto-final-2026-08-27.md` · Día 3 · P2  
**Principio:** clasificar (Reabrir / Candidata / Vigilar / Descartar) y navegar (Anterior · N/M · Siguiente · Ficha · TV · Cerrar) son **dos grupos**; contraste suficiente; sin resucitar paneles retirados el 24-08.

## Problema

En `QuickReviewModal`, la franja `quickReviewResolveRail` tiene contraste apagado y `quickReviewActions` alinea navegación + enlaces externos en un solo bloque plano.

## Objetivo

1. **Agrupar** acciones de cabecera:
   - Grupo A — navegación de cola: Anterior · contador · Siguiente  
   - Grupo B — salida: Ficha · TradingView · Cerrar  
   Separación visual (gap / wrapper), sin cambiar handlers.
2. **Triage** (`reviewResolveRail`): badges/botones con contraste claro; estado `active` inequívoco al clasificar; `Reabrir` solo cuando hay resolución (ya disabled).
3. Feedback al clasificar: si ya hay clase `active` / badge en cola, reforzar CSS; no añadir scores ni paneles de origen.
4. No tocar RS canónico, chart, métricas de negocio, ni hotkeys salvo que ya existan y solo falte polish visual (hotkeys = nice-to-have, no bloqueante).

## Alcance

### Dentro

- `app/components/screener/QuickReviewModal.jsx`
- CSS de `quickReviewHeader` / `quickReviewActions` / `quickReviewResolveRail` en `styles/screener.css` (o el archivo que ya los estilice)
- Tests existentes `vistaRapidaRetiradas` / smoke render si aplica
- Sin commit ni push

### Fuera

- UX-7 chips.
- Reintroducir ScreenerOriginPanel, ScoreAudit, rails de veredicto retirados.
- Cambiar contrato de `STOCK_DECISION_ACTIONS`.

## Verificación (orquestador)

1. Tests + `./vfc` con alcance del diff.  
2. Browser Use: Revisar → modal; grupos visibles; clic Candidata/Vigilar marca activo; Anterior/Siguiente; Cerrar.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
