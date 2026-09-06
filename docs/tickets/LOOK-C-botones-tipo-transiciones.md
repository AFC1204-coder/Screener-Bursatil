# LOOK-C — Botones, escala tipográfica y transiciones

**Estado:** cerrado (smoke orquestador OK 2026-09-06)  
**Rama:** `codex/statsedge-ui-polish` (o rama `cursor/look-c-…` si Cloud; **no merge** sin smoke)  
**Modelo:** Composer 2  
**Análisis:** `docs/analisis-ux-look-redisenio-2026-09-05.md` (oleada LOOK-C)  
**Depende:** LOOK-A ✅ · LOOK-B ✅ (tokens `--control-*`, `--t-*`, `--text-xxs` ya en `tokens-v2.css`)  
**Tipo:** CSS (+ JSX mínimo solo si «Limpiar»→✕ en input exige markup) · sin commit/push desde Agent.

## Contexto

Lienzo v2.3 ya está. Lo que sigue oliendo a «lab» es escala tipográfica caótica (54 `font-size`), alturas de control irregulares (26/28/32), `transition: all`, uppercase por doquier. **Familias tipográficas no se tocan.**

## Alcance (hacer)

### 1. Controles — alturas y estados

Consumir tokens ya definidos:

| Token | Uso |
|---|---|
| `--control-s` 28 | mesa, pager, keycaps desktop |
| `--control-m` 32 | default (⏻, Abrir, chips, toolbar) |
| `--control-l` 40 | CTA / drawer; en `≤760` sustituye `-m` donde aplique |
| CTA móvil | 44 px |

- `.btn*`, `.compactSeg`, keycaps Rango/Temporalidad/`3M|6M|12M`: alturas vía tokens; retirar 26 y 34–38.
- Estados por intensidad (Fable §Botones): reposo / hover / activo (`--senal-dim`+`--line3`) / disabled / focus. Sin `translateY`, sin `#fff`/`#f3f4f6` en toggles.
- `!important` → 0 en `.btn*` y `.compactSeg` (solo esos en esta oleada).

### 2. Transiciones (máx 3)

- Sustituir `transition: all` y variantes sueltas por `--t-state` / `--t-enter` / `--t-layout`.
- Fundir keyframes de entrada a uno (`fadeIn`); retirar `brandShimmer`, `pulseAuditar/Riesgo/Traza/Subtle` si no hay consumidor real (dejar `pulseVigilar` solo si hay uso).
- `@media (prefers-reduced-motion: reduce)` global corto en `base.css`.
- Curva de Etapa: **no tocar** (firma).

### 3. Escala tipográfica — colapso

Mapa Fable (px sueltos → tokens). Prioridad de archivos: `components.css`, `screener.css`, `stock.css` (chrome), `base.css`.  
Objetivo: `font-size: Npx` fuera de `tokens-v2.css` → 0 salvo `clamp()` de héroes.

| Rango px | Token |
|---|---|
| 6.5–8.5 | `--text-xxs` |
| 9–10.5 | `--text-xs` (xxs solo en `td` densas desktop) |
| 11–11.5 | `--text-xs` |
| 12–13 | `--text-s` |
| 13.5–15 | `--text-m` |
| 16–18 | `--text-l` / `--data-m` |
| ≥19 | data/display |

- Completar escala en `tokens-v2.css` si falta algún escalón (`--text-s` 12.5, etc. — verificar y alinear).
- `≤760`: suelo `--text-xs`; inputs `--text-l` (16px, anti-zoom iOS).
- **Uppercase + tracking** solo: cabecera de sección, cabecera de tabla, micro-label de métrica grande. Meta de tarjeta / hints / «5 reglas» → sentence case.
- Pesos: preferir 400/500/600/700; retirar 650/800/900 donde sea mecánico.

### 4. «Limpiar» móvil (si cabe sin abrir LOOK-F)

Si el botón «Limpiar» a ancho completo sigue en el fold: ✕ dentro del input (JSX mínimo). Si requiere refactor grande de search bar → documentar y dejar para LOOK-F.

## Fuera de alcance

- LOOK-D (piel aside / modal familia anatomía) · LOOK-E/F  
- SHELL cerebro · scoring · chart motor · Mini/GHA  
- Cambiar familias tipográficas  
- Kill-list hex completa (era LOOK-B; solo tocar hex si aparece en botones que editas)  
- Commit/push / merge a polish

## Tests / verificación Agent

```bash
rg 'transition:\s*all' styles/          # objetivo 0
rg 'font-size:\s*[0-9]' styles/ --glob '!tokens-v2.css'   # objetivo ~0 (salvo clamp)
# muestreo btn heights / !important en .btn*
npm test -- tests/stockDecisionRailCss.test.js tests/stockFire1MobileFold.test.js 2>/dev/null || true
./vfc archivos tocados
```

Smoke visual: **orquestador** (home + `/stock/AAPL`, 1440 y 390).

## Criterio de aceptación

1. Controles sin altura &lt; 28 desktop / &lt; 40 móvil en superficies primarias (btn, hunt rail, toolbar).  
2. `transition: all` = 0.  
3. `font-size` px sueltos fuera de tokens ≈ 0 en CSS tocados (documentar excepciones `clamp`).  
4. Sin regresión grave de lectura en mesa/ficha.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
