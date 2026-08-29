# UX-BTN-3 — Chart navigation & floating tools

**Estado:** Activo · programación en Agent chat aparte  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  
**Brief:** `docs/analisis-ux-btn-acabados-2026-08-29.md` · familia 5 · reglas 1, 2, 5, 6

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/analisis-ux-btn-acabados-2026-08-29.md
@styles/tokens-v2.css

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5

Ticket UX-BTN-3 — Chart floating nav / icon tools (familia 5 del brief).
No tocar UX-BTN-1 (segmented) ni UX-BTN-2 (Primary/Ghost/Pager).

Problema verificado (styles/components.css ~1298+):
- `.universalChartNavButton` en reposo: border `--accent`, background `--senal-dim`,
  color `--accent`, font-weight 850 → parece activo todo el tiempo.
- Disabled/hover con hex (#626b78, #eff6ff); `.accent` variant usa `#f8d999`.
- Icon buttons ya tienen `.icon` 32px; brief pide ~30×30 y radio `--radius-s` (3px).

Objetivo (Pizarra y Tiza):
1. Reposo: borde `--line2`, fondo flotante sobrio (p.ej. `rgba(23,41,31,.85)` o
   `--surface2` / pozo), color `--soft`, font-weight normal (~510–650). SIN ámbar
   `--senal-dim` ni `--accent` en reposo.
2. Hover: color `--text` / `--tiza`, borde `--line3` si existe (si no `--line2`).
3. Activo / `aria-pressed=true` / modo dibujo: ya usa `--active-bg` + `--active-border`
   + `--active-fg` — conservar; no pintar ámbar de mercado.
4. Disabled: color `--ghost`, opacity ~0.40, sin hex #626b78; hover disabled sin salto.
5. `.universalChartNavButton.icon`: 30×30 (o 32×32 si 30 rompe hit-target del chart;
   documenta la elección), padding 0, radio `--radius-s`, place-items center.
6. Quitar hexes `#eff6ff`, `#f8d999`, `#626b78` de este bloque; tokens o soft/ghost.
7. Si el grupo nav tiene contenedor (`.universalChartNavGroup`), alinear gap/padding
   sin rediseñar el chart controller ni la lógica de pan/zoom.

Fuera: JSX de chart controller, CHART-NAV lógica, hunt rail, marketChip, decision
rail stock, Primary CTA, segmented, commit/push.

Tests: fuente CSS — `.universalChartNavButton` bloque base no usa `--senal-dim` ni
`--accent` en reposo; no contiene esos hex; activo sigue con `--active-bg`.
Archivo sugerido: `tests/chartNavButtonCss.test.js`.

Smoke lo hace el orquestador en /stock/AAPL (chevrons/zoom en reposo ≠ activo).

Plantilla de retorno. Sin commit ni push.
```

## Objetivo

Nav flotante del chart en reposo sobrio (pizarra/línea); activo solo cuando corresponde; sin falso “siempre seleccionado”.

## Alcance

| # | Cambio |
|---|---|
| 1 | Reposo/hover/disabled de `.universalChartNavButton` |
| 2 | Icon 30×30 o 32×32 + `--radius-s` |
| 3 | Hex → tokens |
| 4 | Test fuente |

## Fuera

Lógica pan/zoom · BTN-1/2/4/5/6 · commit/push

## Archivos probables

- `styles/components.css` (~1298–1345)
- `tests/chartNavButtonCss.test.js`

## Retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
