# Ticket activo — pendiente commit bridge + cola VCP-4

**Código WIP:** VCP-3-prod-bridge (motor unificado) — verify OK, **sin commit**  
**Flag local:** `STATSEDGE_VCP_UNIFIED=1` en `.env.local` (dueño probando ficha)

## Siguiente trabajo (orden dueño)

1. **Commit** paquete bridge cuando dueño diga (tras smoke opcional).
2. **VCP-4-screener-panel** — sección VCP con criterios Minervini (% y nº contracciones), columna código, sin score. Spec: `docs/tickets/VCP-4-screener-panel.md`
3. **UX-FILTERS-8** — defaults y duplicados en filtros (en paralelo o antes de VCP-4 UI). Spec: `docs/tickets/UX-FILTERS-8-coherencia-defaults.md`

## Prompt Agent — VCP-4 (copiar cuando bridge esté commiteado)

```
@docs/tickets/VCP-4-screener-panel.md
@docs/rubrica-vcp-producto-2026-09-01.md
@lib/screenerFilterCatalog.js
@lib/screenerFilterLayers.js
@lib/screenerColumns.jsx
@lib/vcpEngine.mjs

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5

Panel familia VCP en Más filtros: umbrales concretos (contracciones, % pivot, volumen, vcpCandidate motor unificado). Columna tabla con etiqueta Minervini (2C, form, PV). Sin minPatternQualityScore ni hunt nueva. Familia off por defecto. Tests label+filtro. Sin commit ni push.
```

## Prompt Agent — UX-FILTERS-8 (puede ir antes, otro chat)

```
@docs/tickets/UX-FILTERS-8-coherencia-defaults.md
@lib/screenerFilterCatalog.js
@lib/screenerFilterLayers.js

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5

Auditoría defaults/duplicados filterLayers; familias opcionales off en frío; preset hunt no activa pattern/VCP sin usuario; test auditoría. Sin commit ni push.
```
