# UX-BTN-1 — Segmented controls & keycaps unificados

**Estado:** Activo · programación en Agent chat aparte  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  
**Brief:** `docs/analisis-ux-btn-acabados-2026-08-29.md` · reglas 1–3, 7

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/analisis-ux-btn-acabados-2026-08-29.md
@styles/tokens-v2.css

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5

Ticket UX-BTN-1 — segmented controls / keycaps (familia 2 del brief).

Problema verificado:
- Reglas globales agrupan `.compactSeg button` con `.btn` (p.ej. styles/components.css
  ~4421, ~4943, ~6367) e inyectan borde/altura/fondo a cada tecla, rompiendo la cápsula.
- Activos usan hex claros (#f4f4f5 etc. en ~4976+) o overrides huérfanos.

Objetivo visual (Pizarra y Tiza / tokens-v2):
1. Contenedor `.compactSeg` (y equivalentes screener period picker / chartSegmented si
   comparten patrón): pozo `--surface-inset` o `--surface2`, padding ~2px, radio `--radius` (6px).
2. Teclas hijas: transparentes, SIN borde propio, tipografía `--font-data` si existe,
   radio `--radius-s` (3px), altura coherente (~26–28px internas).
3. Tecla `.active` / `[aria-pressed=true]`: fondo `--surface`, borde `--line2`,
   texto `--tiza` (o `--text`), micro-sombra de tecla `0 1px 2px rgba(0,0,0,.35)`.
   NO #fff / #f4f4f5 / azul !important.
4. Desacoplar: quitar `.compactSeg button` de selectores agrupados con `.btn*`.
   Preferir reglas específicas `.compactSeg button { … }` sin !important nuevos.
5. Cubrir también variantes chart: `.chartPrefs .compactSeg`, `.stockPage .compactSeg`,
   `screenerPeriodPicker` / period 3M·6M·12M si usan compactSeg o clase hermana —
   mismo acabado, no tres looks distintos.

Fuera de este ticket:
- UX-BTN-2 (Primary/Ghost/Pager) — no tocar .btnPrimary gradient aún salvo que sea
  imprescindible para no romper el desacople (evitar alcance).
- UX-BTN-3…6, UX-23, CLEAN-2, JSX de lógica, commit/push.

Verificación:
- rg "compactSeg button" styles/ — ya no debe aparecer en listas junto a .btn,
  .btnSmall, .btnGhost, .btnPrimary (salvo comentarios).
- npm test — suite UI/CSS existente que toque screener si hay; si no, no inventar
  suite enorme. Añadir test de fuente opcional: components.css no agrupa
  `.btn, …, .compactSeg button` en la misma regla de min-height/borde.
- Smoke lo hace el orquestador (3M/6M/12M + chart TF en /stock/AAPL).

Plantilla de retorno. Sin commit ni push.
```

## Objetivo

Cápsulas segmented coherentes en screener (rendimiento 3M/6M/12M) y ficha chart (rangos/TF), sin herencia `.btn`.

## Alcance

| # | Cambio |
|---|---|
| 1 | Desacoplar `.compactSeg button` de reglas `.btn*` globales |
| 2 | Pozo + tecla activa con tokens v2 |
| 3 | Alinear variantes chart/stock/screener period |
| 4 | Test fuente opcional anti-regresión agrupación |

## Fuera

Primary CTA · chart nav flotante · hunt rail · market chips · commit/push

## Archivos probables

- `styles/components.css`
- `styles/screener.css` / `styles/stock.css` si hay overrides period picker
- `tests/*` fuente CSS opcional

## Retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
