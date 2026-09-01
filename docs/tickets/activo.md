# Ticket activo — VCP-4-screener-panel

**Último cerrado:** UX-FILTERS-8 (verify orquestador 2026-09-01) — **pendiente commit**  
**Spec:** `docs/tickets/VCP-4-screener-panel.md`

## Verificación UX-FILTERS-8 ✓

- Tests filtro: **79/79** (bloque UX-FILTERS-8: **67/67**)
- Defaults v3: núcleo on, opcionales (`pattern`, `ipo`, etc.) **off**
- Hunt E2 (`balanced`, `nearPivot`, …) **no** activan `pattern`
- `FILTER_LAYERS_CONTRACT_VERSION` = **3** (sesiones v1/v2 → defaults nuevos)

## Prompt para Agent chat — VCP-4 (copiar tal cual)

```
@docs/tickets/VCP-4-screener-panel.md
@docs/rubrica-vcp-producto-2026-09-01.md
@lib/screenerFilterCatalog.js
@lib/screenerFilterLayers.js
@lib/screenerColumns.jsx
@lib/vcpEngine.mjs

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5

Panel familia VCP en Más filtros: umbrales concretos (contracciones, % pivot, volumen, vcpCandidate motor unificado). Columna tabla etiqueta Minervini (2C, form, PV). Sin minPatternQualityScore ni hunt nueva. Familia vcp off por defecto (OPTIONAL). Tests label+filtro. Sin commit ni push.
```

---

Pendiente: commit UX-FILTERS-8 si dueño dice OK · smoke Browser Use filtros (orquestador).
