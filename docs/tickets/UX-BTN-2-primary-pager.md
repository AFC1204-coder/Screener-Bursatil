# UX-BTN-2 — Primary CTA, Ghost & Pager

**Estado:** Activo · programación en Agent chat aparte  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  
**Brief:** `docs/analisis-ux-btn-acabados-2026-08-29.md` · familia 1 · reglas 1, 4, 5, 6, 7

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/analisis-ux-btn-acabados-2026-08-29.md
@styles/tokens-v2.css

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5

Ticket UX-BTN-2 — Primary / Ghost / Pager (familia 1 del brief). UX-BTN-1 (segmented) ya cerrado: no reabrir compactSeg.

Problema verificado:
- styles/components.css ~6778 `.btnPrimary` usa linear-gradient(#f6f8fc→#dde3ed) !important
  y hover con translateY(-0.5px) !important — contradice Pizarra/Tiza.
- Ya existe acabado correcto en screener.css `.screenerTerminalPage .btnPrimary` con
  --cta-bg / --cta-fg; hay que unificar el global, no dejar dos looks.
- Pager ‹ › (`.resultPagerStep` u homólogos) desalineados vs select de página.

Objetivo (tokens-v2):
1. `.btnPrimary` (global): fondo sólido `--cta-bg`, texto `--cta-fg`, borde `--cta-border`
   o `--line2`. SIN gradient, SIN translateY, SIN inset highlight plateado.
2. Hover primary: mismo CTA o leve `--surface` wash — sin rebote ni glow.
3. `.btn` / `.btnGhost` / `.btnSmall`: altura 36px base / 32px small-toolbar;
   radio `--radius` (6px); ghost = transparente o `--surface2` + borde `--line`;
   hover `--line2` + `--text`. Disabled: `--ghost` / opacity ~0.40, sin hex #626b78.
4. `.resultPagerStep` (y botones pager del screener): caja 32×32, centrados, mismo
   acabado ghost/secondary. No tocar lógica de paginación.
5. Reducir `!important` en este bloque si puedes sin pelear cascadas antiguas;
   si hace falta uno para ganar al gradient legacy, documenta en comentario breve.
6. NO tocar: `.compactSeg` / `.chartSegmented` (UX-BTN-1), chart nav (BTN-3),
   hunt rail (BTN-5), marketChip (BTN-6), decision rail stock (BTN-4).

Tests: fuente CSS — components.css `.btnPrimary` no contiene linear-gradient ni
translateY; usa --cta-bg (o equivalente tokens). Suite ligera nueva o extensión
de tests/segmentedKeycapsCss.test.js → mejor tests/btnPrimaryCss.test.js.

Smoke lo hace el orquestador (Revisar / CTA screener + pager ‹›).

Fuera: commit/push, JSX de lógica, UX-BTN-3…6.

Plantilla de retorno. Sin commit ni push.
```

## Objetivo

CTA primary = tiza sólida invertida; ghost/pager sobrios y cuadrados; sin gradient `!important` legado.

## Alcance

| # | Cambio |
|---|---|
| 1 | Reescribir `.btnPrimary` (+ hover) a tokens CTA |
| 2 | Alinear `.btn` / `.btnGhost` / `.btnSmall` alturas/radios |
| 3 | Pager steps 32×32 |
| 4 | Test fuente anti-gradient |

## Fuera

Segmented · chart nav · hunt · chips · stock decision · commit/push

## Archivos probables

- `styles/components.css` (~6773+)
- `styles/screener.css` (solo si hay conflicto con `.screenerTerminalPage .btnPrimary`)
- `tests/btnPrimaryCss.test.js` (nuevo)

## Retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
