# LOOK-B — Tokens v2.3 «pizarra apagada» + higiene CSS

**Estado:** preparado (pendiente Agent + smoke A/B hex v2.3)  
**Rama trabajo:** `cursor/look-b-tokens-1ac6` (candidatos A/B; **no mergear a polish** hasta smoke OK)  
**Base:** `codex/statsedge-ui-polish` @ post LOOK-A  
**Modelo:** Composer  
**Análisis:** `docs/analisis-ux-look-redisenio-2026-09-05.md` (oleada LOOK-B)  
**Tipo:** tokens + búsqueda-reemplazo CSS mecánico · un commit lo hace el **orquestador** tras smoke A/B y tests.

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/LOOK-B-tokens-v23-pizarra-apagada.md

Rama: cursor/look-b-tokens-1ac6 (partir de ahí o de codex/statsedge-ui-polish si la rama no existe localmente).
Modelo: Composer.

Alcance: LOOK-B — aplicar tokens v2.3 «pizarra apagada» (5 primitivas), nuevos tokens de control/transición/serie, higiene kill-list, --accent→--line3, themeColor, borrar tokens.css v1, actualizar DIRECCION-VISUAL §2. Sin tipografía/escala (LOOK-C), sin layout aside (LOOK-D), sin JSX estructural.

Tests: npm test -- chartNativeAdapterTokens (actualizar fallbacks si cambian primitivas); rg de aceptación del ticket.
./vfc si aplica.

Sin commit ni push.
```

## Contexto

UX-LOOK-1 (Fable) cerró dirección: **enmendar Pizarra y Tiza, no sustituir**. El verde molesto viene de las cinco primitivas de lienzo (`--pizarra`, `-0`, `-2`, `-3`, `--humo`) demasiado cromáticas. v2.3 «pizarra apagada» = lienzo casi neutro con resto de verde (tinte, no matiz). Familias tipográficas intactas. SHELL (mapa filtros) cerrado.

LOOK-A (layout P0) ya está en polish. Esta oleada es **solo valores de token + higiene hex**; máximo impacto visual con riesgo medio (toda la app hereda `:root`).

**Pendiente smoke A/B hex v2.3:** los candidatos de la tabla siguiente son punto de partida. El orquestador compara captura 1440 home/aside/`/stock/AAPL`/`/market-health` — rama `cursor/look-b-tokens-1ac6` vs `codex/statsedge-ui-polish` — antes de commit a polish.

## Alcance (hacer)

### 1. Primitivas v2.3 «pizarra apagada» (`styles/tokens-v2.css`)

| Token | v2 hoy | v2.3 candidato | Nota |
|---|---|---|---|
| `--pizarra` (lienzo) | `#17291F` | `#141A17` | resto verde perceptible solo junto a negro puro |
| `--pizarra-0` (pozo) | `#101D15` | `#0F1412` | tabla densa |
| `--pizarra-2` (panel) | `#2C4C39` | `#1D2521` | +7 pts sobre lienzo; contorno hace el resto |
| `--pizarra-3` (hover/chrome) | `#365A44` | `#262F2A` | top bar y bottom nav dejan de dominar |
| `--humo` | `#7E8B82` | `#8A918B` | menos verde; contraste ≥ 4.5:1 sobre `--pizarra-2` para `--text-s` |

- `--tiza`, `--senal`, `--traza`, `--oxido`, `--rs-theme`, alias de superficie, tintes dim, CTA: **sin cambio**.
- Actualizar comentario obsoleto líneas 3–4 («NO importado todavía») — falso desde migración global.
- Bloque comentado con valores v2 originales para revert rápido en DevTools (opcional pero útil).

### 2. Nuevos tokens (definir en `tokens-v2.css`; consumo completo en LOOK-C salvo `--serie-*`)

| Token | Valor inicial | Uso |
|---|---|---|
| `--text-xxs` | `10px` | suelo absoluto (tabla densa desktop) |
| `--control-s` | `28px` | mesa, pager, keycaps desktop |
| `--control-m` | `32px` | default: ⏻, Abrir, chips |
| `--control-l` | `40px` | CTA drawer; en `≤760` sustituye `-m` (LOOK-C) |
| `--t-state` | `140ms ease` | `background-color, border-color, color, opacity` |
| `--t-enter` | `180ms cubic-bezier(.2,.8,.2,1)` | drawer, modal, dropdown |
| `--t-layout` | `200ms ease` | colapso aside, `details` |
| `--serie-alza` | auditar origen actual (`#22c55e` mesa terminal, `var(--decision-vigilar)` en spark genérico) → unificar en verde semántico ~`#3dba7a` o el que el dueño elija tras A/B | sparklines, velas alcistas |
| `--serie-baja` | `var(--humo)` o `var(--tiza)` atenuado | descendente; **no rojo** (convención 29 mercados) |

### 3. `--accent` → `--line3`

- En `tokens-v2.css`: `--accent: var(--line3);` (hoy `var(--tiza)`).
- Revisar ~107 usos (`components.css` 56, `screener.css` 49, `review.css` 2): estado activo genérico debe quedar `--senal-dim` + `--line3` + tiza 600 donde el análisis lo pide; CTA y focus siguen con reglas propias.
- `--accent2`: eliminar o dejar deprecated apuntando a `--pizarra-3` sin nuevos usos.

### 4. Kill list (búsqueda-reemplazo en `styles/*.css` salvo `tokens-v2.css`)

| Patrón | Acción |
|---|---|
| `#22c55e`, `#4ade80`, `#f87171`, `#fbbf24`, `#f59e0b` | → tokens v2 (`--serie-alza`, `--oxido`, `--senal`, etc.) |
| `var(--warn, …)` | → `--soft` + `--line-stale` (calidad de dato, no alerta) |
| `rgba(255,255,255,…)` en `components/screener/review/lists` | → `rgba(237,232,218,…)` equivalente |
| Gradientes negros `.stockPreview`, `.mobileSidebarHeader` | → `--pizarra` / `--surface` |
| `themeColor: "#09090b"` en `app/layout.jsx` | → `#141A17` (o `var(--pizarra)` vía meta si Next lo permite) |

Inventario HEAD (orientativo): kill-list hex ×6 en `screener.css`/`components.css`; `var(--warn` ×4; `rgba(255,255,255` ×25 en CSS de app; `tokens.css` v1 existe pero **no importado** — borrar fichero y referencias en `scripts/css-refactor/` si solo legacy.

### 5. `docs/design/DIRECCION-VISUAL.md` §2

- Retirar «debe leerse verde, no negro».
- Sustituir por: «oscuro y neutro-frío con resto de pizarra; el verde cromático es solo semántico (series alcistas)».
- Tabla de primitivas: hex v2.3 candidatos (marcar «pendiente validación A/B» hasta smoke).

### 6. Tests y fallbacks chart

- `tests/chartNativeAdapterTokens.test.js`: actualizar fallback `pizarra2` si cambia `--pizarra-2`.
- `app/chartNativeAdapter.js`: fallbacks hardcoded alineados con tokens-v2.
- `lib/trendlinePrimitive.js`: `read("--pizarra", …)` fallback al nuevo lienzo.

## Fuera de alcance

- LOOK-A (hecho), LOOK-C (tipografía/escala/transiciones consumo), LOOK-D (piel aside), LOOK-E/F  
- SHELL cerebro (mapa Mercados+familias, ⏻/−N/intensidad, modal campos, `FILTER_FIELDS`)  
- Cambiar familias tipográficas (Archivo / Instrument Sans / Spline Sans Mono)  
- Scoring, nocturno, auth, datos, licencia, Mini/GHA  
- Motor `chartNativeAdapter` / `lightweight-charts` (solo tokens/fallbacks y chrome CSS)  
- Merge a `codex/statsedge-ui-polish` / `main` desde este Agent

## Tests / verificación Agent

```bash
npm test -- chartNativeAdapterTokens
rg '#[0-9a-f]{3,8}' styles/*.css --glob '!tokens-v2.css'   # objetivo: 0 (hex sueltos)
rg 'var\(--warn' styles/                                     # objetivo: 0
rg "rgba\\(255,\\s*255,\\s*255" styles/components.css styles/screener.css styles/review.css styles/lists.css  # objetivo: 0
```

- `./vfc` si el script cubre archivos tocados.
- Smoke visual: **orquestador** (Browser Use), no el dueño — ver criterio 3.

## Criterio de aceptación

1. `rg` kill-list = 0 según comandos arriba (hex fuera de `tokens-v2.css`, `--warn`, blanco frío en CSS de app).  
2. `body` / lienzo **no** se lee verde perceptible en captura 1440 junto a la actual (prueba «menos verde» del análisis).  
3. **Pendiente smoke A/B hex v2.3** cerrado por orquestador: home, aside modal familia, `/stock/AAPL`, `/market-health` — sin regresión grave en `stock.css` / `market-health.css`.  
4. `chartNativeAdapterTokens` verde (tests pasan con fallbacks actualizados).  
5. `styles/tokens.css` v1 eliminado; comentario `tokens-v2.css` corregido; `themeColor` alineado con `--pizarra`.

## Rama A/B (orquestador)

- Rama `cursor/look-b-tokens-1ac6`: candidatos v2.3 aplicados en `tokens-v2.css` + nuevos tokens definidos (sin kill-list completa).  
- Comparar contra `codex/statsedge-ui-polish` en `:3300` o instancia aislada; ±2 pts luminosidad aceptable; **croma no debe subir**.  
- Si el dueño pide ajuste fino de hex tras A/B, actualizar tabla y re-smoke antes de merge.

## Plantilla de retorno

```
## Resumen
(1–4 bullets)

## Archivos
(lista real)

## Tests
(comando + resultado)

## LO QUE NO VERIFIQUÉ
(…)

Sin commit ni push.
```
