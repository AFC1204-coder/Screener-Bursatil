# Ticket activo — VCP-4-screener-panel

**Estado:** verify orquestador OK (2026-09-01 noche) — pendiente commit dueño  
**Spec:** `docs/tickets/VCP-4-screener-panel.md`

## Verificación ✓

- Tests VCP-4: **84/84** · `tests/screenerFilter`: **79/79**
- Familia `vcp` en `OPTIONAL_LAYER_KEYS` → **off** por defecto
- Columna **VCP** tras Etapa; etiquetas `2C`, `2C·form`, `2C·PV-2%`
- Presets Minervini / en formación / Apagado solo capa `vcp`
- Sin `minPatternQualityScore` en familia vcp

## Para ver en la app

1. `STATSEDGE_VCP_UNIFIED=1` en entorno del scan (ya en tu `.env.local`)
2. **Refrescar análisis** (scan cacheado no tiene `vcpCandidate` nuevo)
3. Más filtros → familia **VCP** → preset «Minervini» o «en formación»

## Pendiente

- Smoke columna VCP en navegador (orquestador)
- Commit si dueño dice OK

## Cola

— (cerrar VCP-4 tras commit)
