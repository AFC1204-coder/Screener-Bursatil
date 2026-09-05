# Ticket activo — Superposición limpia RS en el gráfico

**Estado:** Cerrado · verify tests · **smoke visual pendiente (sin sesión local)**  
**Rama:** `cursor/rs-overlay-clean-8262` → PR contra `codex/statsedge-ui-polish`  
**Modelo:** Composer

## Problema

Con RS global, país y tema activos a la vez, la superposición no se veía limpia: cada línea usaba una escala overlay invisible distinta (`rs-rating`, `rs-country`, `rs-theme`) con los mismos márgenes, desalineando coordenadas y duplicando referencias.

## Hecho

- `app/chartNativeAdapter.js`: una sola escala `rs-rating` compartida por las tres líneas percentil 1-99; referencia 50 una vez; RS país con trazo discontinuo (`LineStyle.Dashed`) para distinguirse de global y tema.
- Tests: `chartNativeAdapterTokens` actualizado + caso multi-RS activos simultáneos.
- Subset `npm test -- chartNativeAdapter chartSeriesModel chartController` → 54 passed.

## Antes / después

| Antes | Después |
|---|---|
| 3 escalas overlay invisibles con mismos márgenes | 1 escala `rs-rating` compartida |
| Líneas potencialmente desalineadas en la banda inferior | Misma coordenada Y para percentiles comparables |
| Referencia 50 repetida por serie | Referencia 50 una sola vez |
| País y global ambos sólidos | País discontinuo; global `--traza`; tema `--rs-theme` |

## LO QUE NO VERIFIQUÉ (completo)

- Líneas RS visibles con datos reales (≥8 semanas): el entorno cloud no tiene Supabase/RS semanal hidratado; OKTA y MSFT muestran «Sin línea RS».
- Vista rápida / review con toggles y líneas dibujadas.

## Smoke parcial (Playwright :3300)

- Ficha `/stock/OKTA` carga; toggles RS / RS país / RS tema presentes; gráfico TradingView renderiza.
- Sin series RS semanales → no se pudo confirmar superposición visual de líneas.
- Screenshot: `artifacts/screenshots/okta-chart-rs-toggles-no-data.png`

## Siguiente

Orquestador: smoke visual con hard-reload + toggles RS; `./vfc` si aplica; commit/merge tras smoke OK.
