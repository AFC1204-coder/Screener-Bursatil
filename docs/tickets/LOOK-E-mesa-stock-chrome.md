# LOOK-E — Mesa + chrome `/stock`

**Estado:** cerrado (smoke orquestador OK 2026-09-06; hotfix keycaps desktop/móvil + cards héroe)  
**Rama:** `codex/statsedge-ui-polish` (o `cursor/look-e-…` si Cloud; **no merge** sin smoke)  
**Modelo:** Composer 2  
**Análisis:** `docs/analisis-ux-look-redisenio-2026-09-05.md` (oleada LOOK-E)  
**Depende:** LOOK-A…D ✅ (lienzo v2.3, controles, aside)  
**Tipo:** CSS (+ JSX mínimo solo si `.stockPreview` popover flotante exige wrapper) · sin commit/push desde Agent.

## Contexto

Aside ya no apila verdes. Quedan restos «lab» en **mesa de resultados** y **chrome de ficha** `/stock`: preview de búsqueda con gradiente negro v1, sparklines/MA en hex sueltos, pager apagado, keycaps de Rango/Temporalidad ~22 px / 9–10 px, rail Candidata/Vigilar/Descartar fuera de `--control-m`.

**No tocar** motor del chart (`chartNativeAdapter`, lightweight-charts), scoring, hunt semantics, SHELL, LOOK-F (fold móvil completo).

## Alcance (hacer)

### 1. Mesa (screener)

- Cabecera / pozo de tabla sobre lienzo v2.3: fondos `--bg` / `--surface` / `--surface-inset` (tokens), bordes `--line`/`--line2`. Sin pozos negros v1 ni `rgba(5,7,10,…)` si aparecen en filas/cabecera tocadas.
- Celdas densas: `--text-xxs` o `--text-xs` según mapa LOOK-C; contraste legible sobre pozo (objetivo ≥ 4.5:1 a ojo / medición CDP).
- Pager: color `--soft` (no `humo` al 60 %); targets `--control-s` (ya de LOOK-C si aplica; alinear si queda residual).
- Keycaps **3M / 6M / 12M** de mesa: `--text-xs`, `--control-s`, pozo `--surface-inset`, activo `--surface` + `--line2`.

### 2. `.stockPreview` (búsqueda)

- Quitar gradiente negro `linear-gradient(rgba(17,16,13…), rgba(5,5,5…))` → panel tokens (`--surface` + `--line2` + `--shadow-panel` / elevación v2).
- Comportamiento: **popover flotante** sobre la página (absolute/fixed), **no** empuja el flujo del fold (sobre todo móvil). JSX mínimo OK si el markup actual es in-flow.
- No reescribir la lógica de resolución/preview; solo piel + posicionamiento CSS (± wrapper).

### 3. Chrome `/stock` (`stock.css`)

- Tarjeta héroe / identidad: superficies tokens; sin negros v1 sueltos en chrome tocado.
- Rail **Candidata / Vigilar / Descartar** (+ afines del strip): altura `--control-m` (desktop); en `≤760` alinear a `--control-l` o 44 px CTA si ya es patrón LOOK-C.
- Keycaps **Rango / Temporalidad** (1D…ALL, etc.): mínimo `--text-xs`, altura `--control-s` desktop; contenedor pozo como mesa. Residual ~22 px medido en LOOK-C → corregir aquí.
- Sparklines / trazos MA en CSS (si el color vive en CSS): `--serie-alza` / `--serie-baja` (ya en `tokens-v2.css`). **No** cambiar JS del adapter salvo un mapeo trivial de color a token si el test `chartNativeAdapterTokens` lo exige y es 1–2 líneas; si el color solo sale del adapter y requiere refactor → documentar y dejar.

### 4. Fuera / cuidado

- No tocar Curva de Etapa, familias tipográficas, aside (LOOK-D), fold completo / viewport (LOOK-F).
- No kill-list global de hex (era LOOK-B); solo hex negros/verdes de series en zonas que editas.
- `!important`: no barrer; solo si bloquea alturas de keycaps/rail en archivos tocados.

## Fuera de alcance

- LOOK-F · SHELL cerebro · scoring · nocturno · Mini/GHA  
- `chartNativeAdapter` / motor velas (salvo color token trivial)  
- Commit/push / merge a polish

## Tests / verificación Agent

```bash
rg 'linear-gradient\(rgba\(17,\s*16,\s*13|rgba\(5,\s*5,\s*5' styles/screener.css styles/components.css || true
rg 'var\(--serie-alza\)|var\(--serie-baja\)' styles/ stock/ lib/ 2>/dev/null | head
npm test -- tests/lookCControlsCss.test.js tests/lookDAsideCss.test.js tests/stockDecisionRailCss.test.js tests/stockFire1MobileFold.test.js tests/chartNativeAdapterTokens.test.js 2>/dev/null || true
./vfc archivos tocados
```

Smoke visual: **orquestador** (home mesa + preview búsqueda; `/stock/AAPL` 1440 y 390 — keycaps + rail).

## Criterio de aceptación

1. `.stockPreview` sin gradiente negro; no empuja el fold (popover).  
2. Keycaps mesa y `/stock` ≥ `--text-xs` / `--control-s` (desktop).  
3. Rail clasificación ≥ `--control-m`.  
4. Series CSS usan `--serie-*` donde tocadas; tests chart sin regresión.  
5. Smoke `/stock/AAPL` 1440 + 390 OK.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
