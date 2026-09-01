# UX-FILTERS-8 — Coherencia de filtros y defaults

**Estado:** deuda producto (dueño 2026-09-01 noche)  
**Relacionado:** VCP-4 (nueva familia VCP debe nacer limpia)

## Problema (dueño)

- A veces parece que **todo está seleccionado** o que al cambiar preset se **activan familias de golpe**.
- **Duplicación**: el mismo criterio en chip, familia «patrón», preset hunt y sliders de intensidad.
- **Falta de coherencia**: toggle dice una cosa y el impacto −N otra; restore de sesión reencende capas no deseadas.

## Objetivo

Una regla = un sitio. Defaults **conservadores** (familias opcionales off). Cambiar preset **no** debe silenciosamente duplicar umbrales en dos capas activas.

## Alcance sugerido

1. **Auditoría** de `filterLayers` + `QUALITY_DEFAULTS` + presets hunt: mapa campo → familia única.
2. **Defaults:** al cargar sin sesión guardada, familias `pattern` / futura `vcp` / IPO intensidad = off o mínimo; solo capas «mesa» (mercado, etapa si hunt E2) on.
3. **Preset → capas:** documentar y testear que `balanced` / `nearPivot` no activan `pattern: true` sin acción explícita.
4. **UI:** si dos controles mueven el mismo campo, **fusionar** o deshabilitar el redundante con hint.
5. **Restore:** `resolveStoredFilterConfig` no reactiva familias borradas en versión nueva (migración suave).

## No hacer en este ticket

- Rediseño visual completo (ya UX-FILTERS 1–7).
- Cambiar scoring objetivo.

## Gate

- Script o test de auditoría: cada `settings` key pertenece a una sola familia activa.
- Smoke Browser Use: abrir screener frío → contar familias on; cambiar a Líderes E2 → no enciende patrón/VCP sola.
