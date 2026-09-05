# UX-LOOK-1 — Retorno Fable: rediseño visual general (2026-09-05)

Fuente: brief `docs/tickets/UX-LOOK-1-fable-redisenio-visual.md`.  
Modelo: Fable 5.1. Sin código. HEAD citado: `530a7e2` (`codex/statsedge-ui-polish`).  
Evidencia: lectura de `styles/*.css`, `app/layout.jsx`, `docs/design/DIRECCION-VISUAL.md`; hard-reload en `http://127.0.0.1:13000/` (home, aside, modal familia, `/stock/AAPL`) a 1440×900 y 390×844 (emulación CDP).

**Decisión orquestador:** pendiente.

---

## Resumen

1. **Corrección de premisa:** el brief dice que `tokens-v2.css` «aún no está migrado en bloque». Es falso en HEAD: `app/layout.jsx:3` importa `tokens-v2.css` como única fuente global y `tokens.css` v1 **no lo importa nadie** (solo lo leen scripts de `scripts/css-refactor/`). El verde que molesta al dueño **es** «Pizarra y Tiza» ejecutado: `body` = `rgb(23,41,31)` (`--pizarra`), aside = `--pizarra-2`, top bar y bottom nav = `--pizarra-3` (`#365A44`, el verde más saturado del sistema, en las dos barras de chrome permanentes).
2. **Veredicto sobre v2:** **enmendar, no sustituir.** La disciplina (roles tiza/humo/señal/traza/óxido, dos intensidades, CTA invertido, doctrina de elevación, tres familias tipográficas con roles) es buena y ya está pagada en `stock.css` y `market-health.css`. Lo que falla son **cinco primitivas** (`--pizarra`, `-0`, `-2`, `-3`, `--humo`) demasiado cromáticas para un lienzo que ocupa el 90 % del píxel. Propongo **v2.3 «pizarra apagada»**: mismo sistema, lienzo casi neutro con un resto de verde (tinte, no matiz).
3. Lo que se ve «viejo / lab» no es la paleta sola: es **restos v1 sin migrar** (negro `.stockPreview`, cabecera del drawer `rgba(5,5,6,.96)`, verdes/ámbares Tailwind `#22c55e #4ade80 #f87171 #fbbf24 #f59e0b`, `var(--warn)` que **no existe** en v2), **54 tamaños de fuente distintos** (71 usos de 9 px, 31 por debajo de 9 px), **509 `!important`**, tiza sólida como borde de «activo» en 105 sitios, y **tres bugs de layout** visibles hoy (tarjetas de familia rotas, bottom nav en dos filas, filtros inalcanzables en móvil tras scroll).
4. Dirección de look: **no tocar familias tipográficas** (Archivo / Instrument Sans / Spline Sans Mono están cargadas y son distintivas); sí colapsar la escala a 8 tokens con suelo de 10 px (11 px en móvil). Lienzo neutro-frío con resto verde; verde cromático solo en series alcistas del gráfico/sparkline (tokenizado). Tres alturas de control (28 / 32 / 40; 44 CTA móvil). Tres transiciones con nombre y nada más.
5. Filtros primero en la piel, con el mapa SHELL intacto: anatomía de tarjeta de familia arreglada, chips de mercado sin truncar, modal compacto sin checkboxes verdes; ⏻/−N/intensidad y el modal como único editor **no cambian**.
6. Seis oleadas acotadas (A P0 fixes visibles → B tokens v2.3 → C botones/transiciones → D aside → E mesa + chrome `/stock` → F móvil). Ninguna reescribe JSX de estructura; A y B son las que más cambian la percepción por menos riesgo.

## Diagnóstico (por qué se ve viejo / verde / lab)

**Verde**
- `--pizarra #17291F` (lienzo), `--pizarra-2 #2C4C39` (aside, paneles), `--pizarra-3 #365A44` (top bar, bottom nav, chips, tarjetas anidadas). En la home caza se apilan **tres verdes** en 272 px: aside `--surface` → tarjeta `--surface2` → ⏻ `--surface`. El delta es de matiz+luminosidad, no de contorno, y el ojo lee «todo verde».
- Las dos superficies fijas más grandes de la app (`.appTopBar` y `.bottomNav`) usan el verde **más saturado** del sistema (`rgb(54,90,68)`). Es lo primero y lo último que se ve en cada pantalla.
- Sparklines y velas alcistas en verde `~#3dba7a` sobre lienzo verde: la señal se camufla con el fondo en vez de destacar (mesa de resultados, gráfico `/stock`).
- Doctrina v2 §2 exige que la pizarra «se lea verde, no negro». Esa frase es la que hay que enmendar: el lienzo debe leerse **oscuro y calmado**, y el verde quedar como recuerdo (tinte ≤ 4 pts de croma), no como color.

**Lab / acumulado**
- Restos v1 sin migrar en superficies visibles: `.stockPreview` `linear-gradient(rgba(17,16,13,.88), rgba(5,5,5,.9))` (`screener.css:2337`, la tarjeta negra de búsqueda que ocupa el fold en móvil); `.mobileSidebarHeader` `rgba(5,5,6,.96)` (cabecera negra del drawer); `themeColor: "#09090b"` en `app/layout.jsx`.
- Hex huérfanos: `components.css` 201, `screener.css` 120, `lists.css` 17, `review.css` 11. Entre ellos `#22c55e`, `#4ade80` (checkboxes verdes del modal de familia), `#f87171`, `#fbbf24`, `#f59e0b` ×2, y `var(--warn, #f59e0b)` ×3 — `--warn` **no está definido** en v2, así que siempre cae al ámbar Tailwind (`.layerCoverageWarning`, `.filterFamilyCoverage`).
- `rgba(255,255,255,…)` ×31 en `components.css`/`screener.css`/`review.css` (blanco frío) mezclado con `rgba(237,232,218,…)` (tiza). Dos temperaturas de borde en la misma pantalla.
- `--accent` = tiza usado 105 veces como borde/inset de «activo» (`.layerPowerToggle.on`, `.decisionRailItem.active`, `.marketChip.active`…). Resultado: docenas de contornos blanco-crema a plena tinta compitiendo con el CTA, que por doctrina debía ser el único elemento tiza sólido.
- `!important`: 322 en `components.css`, 185 en `screener.css`. Síntoma de capas apiladas (cf. UX-BTN §Resumen). No es objetivo borrarlos todos; sí los que contaminan botones y tarjetas.

**Tipografía**
- 54 valores distintos de `font-size`. Distribución: 11 px ×161, 10 px ×159, 12 px ×127, **9 px ×71**, 13 px ×49, 8 px ×23, 9.5 ×13, 10.5 ×13, 8.5 ×5, 7 ×4, 6.5 ×4. Los tokens de escala (`--text-xs/s/m/l`, `--data-*`) se usan **150 veces** frente a **~800 px sueltos**. Los keycaps de Rango/Temporalidad en `/stock` están en 9–10 px; ilegibles en móvil.
- 194 `text-transform: uppercase` (85 solo en `screener.css`). El micro-label mayúscula con tracking se ha convertido en el estilo por defecto de cualquier meta, no en un acento de sección. Uppercase + 9–10 px + humo sobre verde = la sensación «panel de laboratorio».
- Familias: bien elegidas y realmente cargadas (`document.fonts`: Archivo 500–700, Instrument Sans 400–700, Spline Sans Mono 400–700). Display Archivo se usa 13 veces en toda la app (5 screener, 6 stock, 2 market-health): dentro de doctrina. No es un problema de fuente sino de **escala y de dónde se usa mayúscula**.

**Botones / interacción**
- Tras UX-BTN 1–6 quedan tres alturas de facto en desktop (26 px toolbar «Revisar/Guardar/Copia», 28 px hunt rail, 32 ⏻/Abrir) y ninguna crece en móvil: a 390 px medí hunt rail **28 px**, toolbar **26 px**, «Filtros» 42×38, chips de mercado 44×38 con texto en dos líneas («Core intl», «US+Cor» truncado).
- Transiciones: 42 declaraciones, 20 combinaciones distintas de duración/propiedad (`.12 .14 .15 .16 .18 .2s`), 7 `transition: all`. Keyframes: `brandShimmer`, 4 pulsos (`pulseVigilar/Auditar/Riesgo/Traza`), `pulseSubtle`, `spin`, 3 fades. Ninguna está tokenizada.
- Bugs de layout visibles en HEAD (medidos):
  - **Tarjetas de familia rotas** (`.layerControlRow` sin `.hasIntensity`): grid `auto minmax(0,1fr) 24px auto` con `.infoHint { grid-row: 1/-1 }` sin columna → el algoritmo coloca ⓘ en la columna 2 (1fr), el cuerpo cae a la columna 3 (**24 px**) y «Abrir ▸» a la 4 con 24 px de ancho. Se ve: ⓘ centrado, título aplastado a la derecha, «Abrir» pisando el título. Ocurre en Tendencia, Liquidez, Momentum, Scores, Cercanía; RS se salva por `.hasIntensity .layerOpenBtn { grid-column: 4 }`. Igual en desktop (272 px) y drawer móvil.
  - **Bottom nav en dos filas**: `.bottomNav` es `grid` de **5 columnas** (68.8 px) con **6** ítems → «Mercado» cae a una segunda fila (y = 798 vs 760) y la barra mide 82 px pisando el contenido.
  - **Filtros inalcanzables en móvil**: el único disparador es `.btn.btnMobileOnly` «Filtros» (42×38) en la cabecera no-sticky; tras 50 px de scroll queda fuera de pantalla (`y = -42`). El bottom nav no lo lleva.

**Móvil ≤ 480 (390×844 medido)**
- Fold de la home: `ESTADO` (1 fila) + `FUSIÓN PARCIAL` (2 filas de texto) + input búsqueda + **«Limpiar» a ancho completo** (370×34, acción secundaria ocupando una fila) + «Buscar» + tarjeta negra AAPL de **429 px**. La ficha activa, la verdad y los resultados quedan por debajo del fold.
- Hunt rail en scroll horizontal sin afordancia (5.º chip cortado en «Radar I…»).
- Drawer de filtros: `position: fixed` bajo el `.appTopBar` sticky (el título de la página se ve por detrás), cabecera negra v1, y el bottom nav (fixed, `bottom: 6px`) se superpone al contenido del drawer.
- `body { padding-bottom: 116px + safe-area }` para una nav que debería medir ~56 px.
- Inputs a 14 px → Safari iOS hace zoom al enfocar; `maximumScale: 1` en `viewport` intenta evitarlo (iOS lo ignora desde 10 y es un problema de accesibilidad).
- Fragmentación de breakpoints: 760 ×44, 620/640/680/700/720 ×18, 480/430/420/390 ×18. Tres «móviles» distintos según el archivo.

## Dirección visual

### Tipografía (familias + escala)

- **Familias: sin cambio.** Archivo (display, 125 %, mayúscula, ≤ 3/vista), Instrument Sans (cuerpo), Spline Sans Mono (datos, `tabular-nums`). Cambiar de fuente sería el gesto agresivo que el brief descarta y no ataca la causa.
- **Escala cerrada a 8 tokens de cuerpo/dato + 2 de display**, y **prohibido `font-size` en px fuera de `tokens-v2.css`**:
  - `--text-xxs 10px` (nuevo; suelo absoluto — tabla densa desktop, nada más) · `--text-xs 11px` · `--text-s 12.5px` · `--text-m 14px` · `--text-l 16px`.
  - `--data-s 12.5` · `--data-m 17` · `--data-l 26` · `--data-xl 38`.
  - `--display-s 13` · `--display-m 20`.
  - En `≤ 760` el suelo sube a `--text-xs` (nada por debajo de 11 px) y los inputs a `--text-l` (16 px, evita el zoom iOS).
- **Mapa de colapso** (para la oleada): 6.5–8.5 → `--text-xxs`; 9–10.5 → `--text-xs` (o `--text-xxs` solo en `td` de la mesa); 11–11.5 → `--text-xs`; 12–13 → `--text-s`; 13.5–15 → `--text-m`; 16–18 → `--text-l`/`--data-m`; ≥ 19 → escala data/display. Los `clamp()` de héroes se conservan.
- **Mayúscula con tracking solo en tres sitios:** cabecera de sección (display-s), cabecera de tabla, y micro-label de una métrica grande. Meta de tarjeta, hints, «5 reglas», nombres de familia, copy de estado → **sentence case** en `--text-s`/`--text-xs` humo. Esto solo ya quita la mitad del olor a laboratorio.
- **Pesos:** 400 cuerpo, 500 énfasis, 600 título/activo, 700 solo números mono. Retirar 650/800/900.

### Color (paleta; qué pasa con pizarra-verde v2)

- **Se conserva v2 entero salvo las primitivas de lienzo.** Roles, alias, dos intensidades, CTA tiza invertido, elevación por contorno, calidad de dato (`--ghost`, `--line-stale`), curva de etapa: intactos. Se retira la frase «debe leerse verde, no negro» de `DIRECCION-VISUAL.md §2` y se sustituye por «oscuro y neutro-frío con resto de pizarra; el verde cromático es solo semántico».
- **Candidatos v2.3 «pizarra apagada»** (a validar en pantalla; ±2 pts de luminosidad es aceptable, el croma no debe subir):

  | Token | v2 hoy | v2.3 candidato | Nota |
  |---|---|---|---|
  | `--pizarra` (lienzo) | `#17291F` | `#141A17` | resto verde perceptible solo junto a un negro puro |
  | `--pizarra-0` (pozo) | `#101D15` | `#0F1412` | tabla densa |
  | `--pizarra-2` (panel) | `#2C4C39` | `#1D2521` | +7 pts sobre lienzo; el contorno hace el resto |
  | `--pizarra-3` (hover/anidada/chrome) | `#365A44` | `#262F2A` | top bar y bottom nav dejan de ser el color dominante |
  | `--humo` | `#7E8B82` | `#8A918B` | menos verde; contraste ≥ 4.5:1 sobre `--pizarra-2` para `--text-s` |
  | `--tiza` / `--senal` / `--traza` / `--oxido` / `--rs-theme` | — | sin cambio | siguen siendo la única fuente de color |

- **Verde semántico:** v2 ya prohíbe rojo/verde como veredicto y eso se mantiene (29 mercados, convención invertida en Asia). Sí se tokeniza el verde que **ya existe** en series alcistas de gráfico/sparkline como `--serie-alza` (valor actual, no nuevo) y el descendente como `--serie-baja` (humo o tiza, no rojo) — para que dejen de ser hex sueltos y para que, sobre lienzo neutro, el verde vuelva a significar «sube» en vez de ser el color del fondo.
- **Tiza sólida = solo CTA y focus.** Estado activo de UI genérica (⏻ on, chip seleccionado, rail activo, celda activa) = fondo `--senal-dim` + borde `--line3` + texto tiza 600 (ya es la regla 6; lo que cambia es dejar de usar `--accent` sólido como borde). `--accent` pasa a alias de `--line3`; `--accent2` se elimina.
- **Kill list de hex**: `#22c55e #4ade80 #f87171 #fbbf24 #f59e0b`, `var(--warn, …)` (→ `--soft` con `--line-stale`, es lenguaje de calidad de dato, no alerta), `rgba(255,255,255,…)` → `rgba(237,232,218,…)`, gradientes negros `.stockPreview`, `.mobileSidebarHeader`, `themeColor` → `--pizarra`. Borrar `styles/tokens.css` v1 (muerto) y actualizar el comentario de `tokens-v2.css:3-4` que aún dice «NO importado todavía».
- **Prueba de aceptación visual** (la que responde a «menos verde»): captura de home a 1440 → el histograma de matiz del lienzo+paneles no debe leerse como verde a simple vista junto a la captura actual; y el único verde saturado visible son sparklines/MA.

### Botones e interacción

- **Tres alturas tokenizadas:** `--control-s 28px` (mesa, pager, keycaps desktop), `--control-m 32px` (default: ⏻, Abrir, chips de mercado, toolbar), `--control-l 40px` (CTA, drawer, `≤ 760` todo lo que sea `-m`). CTA en móvil 44 px. Se retiran las alturas 26 y 34–38 medidas hoy.
- **Estados por intensidad, no por matiz** (cierra UX-BTN regla 2–3): reposo `--surface2` + `--line`; hover `--surface2` + `--line2`; activo `--senal-dim` + `--line3` + tiza 600; disabled `--ghost` 40 %; focus `--focus-ring` 2 px. Sin `translateY`, sin gradientes, sin `#fff`/`#f3f4f6` en `.layerPowerToggle`.
- **⏻ de familia:** off = ghost (borde `--line`, glifo humo, tarjeta `opacity .72` → mejor: solo el texto en humo, la tarjeta no se desvanece); on = `--senal-dim` + `--line3`. El estado lo comunica el toggle, no toda la tarjeta.
- **Keycaps (Rango/Temporalidad `/stock`, 3M/6M/12M mesa):** `--text-xs` mínimo, `--control-s`, contenedor pozo `--surface-inset` + tecla activa `--surface` + `--line2` (ya definido en UX-BTN-1); en `≤ 760` las dos filas de `/stock` se convierten en una fila scrollable de `--control-l` o un `select` nativo.
- **«Limpiar» en móvil** deja de ser fila completa: icono ✕ dentro del input.
- `!important`: quitar solo en `.btn*`, `.compactSeg`, `.layerControlRow`, `.bottomNav`, `.mobileSidebarHeader`. El resto no es de esta oleada.

### Transiciones (máx 3 tipos útiles)

1. **Estado** `--t-state: 140ms ease` → `background-color, border-color, color, opacity`. Sustituye las 20 variantes y los `transition: all`.
2. **Entrada de superficie** `--t-enter: 180ms cubic-bezier(.2,.8,.2,1)` → drawer, modal, dropdown, popover de búsqueda (`opacity + translateY(6px)`). Un solo keyframe (`fadeIn`); `slideDropdown`/`fadeInSubtle` se funden.
3. **Plegado** `--t-layout: 200ms ease` → colapso de aside desktop, `details` de «Otras familias», plegado de tarjeta de identidad en `/stock` (`grid-template-rows`/`opacity`).

Se retiran: `brandShimmer`, `pulseAuditar/Riesgo/Traza/Subtle` (queda `pulseVigilar` solo si hay un consumidor real, un máximo por vista), `translateY` de pulsación. Todo bajo `@media (prefers-reduced-motion: reduce) { * { transition-duration: 0ms; animation: none } }`. La animación de trazo de la Curva de Etapa (§5 doctrina) queda fuera de este límite porque es firma, no UI.

### Móvil (calidad de uso)

Principios (no «que quepa»):

1. **Fold útil a 390×844** = app bar (50) + franja de estado en **una** línea con disclosure (`FUSIÓN PARCIAL · 11 mercados ▸`) + ficha activa (rail o selector) + verdad (1 línea) + las **tres primeras filas** de la mesa. La búsqueda es un campo; su popover es flotante sobre la página, nunca contenido en flujo de 429 px.
2. **Filtros siempre alcanzables**: sub-barra sticky bajo el app bar en la home (`Filtros (3) · Líderes Etapa 2 ▾ · Revisar`) — no se toca el IA del bottom nav.
3. **Targets:** ≥ 44 px CTA y nav; ≥ 40 px controles; ≥ 36 px con 8 px de separación en filas densas. Hunt rail 28 → 40. Toolbar 26 → 40 o al menú ⋯ (SHELL-B ya lo movió en parte).
4. **Scroll:** un solo scroll vertical por pantalla; horizontal solo en hunt rail y mesa, con máscara de degradado en el borde como afordancia. Drawer de filtros a pantalla completa (`inset: 0`) sobre app bar y bottom nav, con su propia cabecera tiza/pizarra y CTA «Listo» 44 px pegado abajo con `safe-area-inset-bottom`.
5. **Teclado:** inputs 16 px, `inputmode="numeric"` en umbrales del modal, quitar `maximumScale: 1`.
6. **Chrome:** bottom nav 56 px + safe-area, 6 columnas, sin `bottom: 6px` flotante; `body padding-bottom` = altura real de la nav.
7. **Un solo breakpoint móvil** (`≤ 760`) más uno de teléfono estrecho (`≤ 400`) para densidad; los 620/640/680/700/720 se consolidan al escribir cada oleada, no en un barrido aparte.

## Filtros: piel sin tocar el cerebro SHELL

**Cambia (visual):**
- **Tarjeta de familia** — anatomía fija en grid explícito: `[⏻ 32] [cuerpo 1fr: nombre --text-s 600 + meta sentence case --text-xs humo] [ⓘ 24] [Abrir ▸ ghost --control-s]`; con intensidad, la barra ocupa la fila 2 a lo ancho. Altura de reposo ~52 px; en móvil ⏻ y Abrir a 40 px. Fondo tarjeta = `--surface` + `--line2` + `--shadow-panel` (panel), y el **aside pasa a lienzo** (`--bg`), no a `--surface`: se rompe el apilado de tres verdes.
- **Chips de mercado** — 272 px no caben 4 columnas con «US+Core intl»: 2 columnas con etiqueta completa o una fila scrollable; «Personalizar mercados (28/28)» pasa a link `--text-xs` bajo los chips. Punto rojo junto a `MERCADOS` → punto `--senal` solo cuando hay selección ≠ mesa (es el uso legítimo de un `--senal` fuera de resultados).
- **Intensidad** — pista `--line2`, relleno `--soft`, tirador tiza 16 px (24 táctil); «PERSONALIZADO» ámbar → «Personalizado» tiza 600 `--text-xs`; el hint «Mover la barra restablece…» pasa a tooltip de ⓘ.
- **Modal de familia** — inputs numéricos de 2 dígitos a `width: 6ch` alineados en una fila con su label a la izquierda (hoy 3 columnas a ancho completo); checkboxes `#22c55e/#4ade80` → caja `--line3` con check tiza; chips «Exigencia» muestran el activo con `--senal-dim` + `--line3`; cabecera «FAMILIA DE FILTRO / TENDENCIA» → nombre de familia en display-s, «Tendencia» como subtítulo sentence case (la lavanda `--rs-theme` no es color de familia; se retira de ahí).
- **Drawer móvil** — cabecera tiza/pizarra (fuera el negro), a pantalla completa, «Listo» 44 px abajo.

**No cambia:** mapa Mercados + familias de la ficha activa (SHELL-C), semántica ⏻ / −N / intensidad / cobertura, contenido y campos del modal (`FILTER_FIELDS`, capas v2), plomería en ⋯ (SHELL-B), «Otras familias» plegado, `ScreenerSidebar.jsx`/purga CSS (SHELL-D sigue siendo su propio ticket).

## Oleadas

| ID | Título | Prio | Zona | Riesgo | Criterio aceptación |
|---|---|---|---|---|---|
| **LOOK-A** | Fixes de layout visibles: grid `.layerControlRow` explícito (cuerpo col 2, ⓘ col 3, Abrir col 4); `.bottomNav` 6 columnas / 56 px; disparador «Filtros» sticky en `≤ 760` | P0 | `screener.css` (5590–5713), `components.css` (`.bottomNav` 4270+), `ScreenerShell` solo si el sticky exige un wrapper | Bajo | A 272 px y 390 px: ningún «Abrir» solapa el título; ⓘ entre título y Abrir; nav en una fila con 6 ítems, y ≥ 44 px; «Filtros» visible tras scroll de 600 px en home 390 |
| **LOOK-B** | Tokens v2.3 «pizarra apagada» + higiene: 5 primitivas; `--text-xxs`, `--control-s/m/l`, `--t-state/enter/layout`, `--serie-alza/baja`; `--accent`→`--line3`; kill list hex/`--warn`/`rgba(255,…)`/negros; borrar `tokens.css`; `themeColor`; comentario `tokens-v2.css` | P0 | `tokens-v2.css`, `DIRECCION-VISUAL.md §2`, `app/layout.jsx`, búsqueda-reemplazo en `components/screener/stock/lists/review.css` | Medio (afecta a toda la app; solo valores) | `rg '#[0-9a-f]{3,8}' styles/*.css` fuera de `tokens-v2.css` = 0; `rg 'var\(--warn'` = 0; `body` bg ≠ verde perceptible en captura 1440 junto a la actual; `stock.css`/`market-health.css` sin regresión visual (smoke); test `chartNativeAdapterTokens` verde |
| **LOOK-C** | Botones, escala tipográfica y transiciones: mapa de colapso 54→10 tamaños; uppercase solo en 3 roles; alturas 28/32/40(44); estados por intensidad; 3 transiciones; retirar keyframes sobrantes; `prefers-reduced-motion` | P1 | `components.css` (`.btn*`, `.compactSeg`, keycaps), `base.css` keyframes, barrido `font-size` en todos los CSS | Medio | `rg 'font-size:\s*[0-9]' styles/*.css` fuera de tokens = 0 (excepto `clamp`); `rg 'transition:\s*all'` = 0; ningún control < 28 px desktop ni < 40 px móvil (medición CDP en home y `/stock`); `!important` en `.btn*`/`.compactSeg` = 0 |
| **LOOK-D** | Aside piel: anatomía tarjeta de familia, aside sobre lienzo, chips de mercado 2 col, intensidad, modal compacto (inputs `6ch`, checks tiza, chip activo), drawer móvil a pantalla completa con cabecera tiza | P1 | `screener.css` (aside, `.filterFamilyModal`, `.mobileSidebarHeader`), `components.css` (`.marketChip`) | Medio | Sin cambios en `settings`/claves; captura aside 272 px: 2 superficies máximo (lienzo + panel); ningún texto truncado en chips; modal Tendencia cabe en 844 px de alto sin scroll interno hasta «Ajustes finos»; drawer cubre app bar y bottom nav |
| **LOOK-E** | Mesa + chrome `/stock`: cabecera/pozo sobre nuevo lienzo, sparkline y MA en `--serie-*`, pager legible (`--soft`, no humo·.6), `.stockPreview` sin gradiente negro y como popover flotante, tarjeta héroe y rail Candidata/Vigilar/Descartar en `--control-m`, filas de keycaps en `--text-xs` | P2 | `screener.css` (mesa, `.stockPreview`), `stock.css` (chrome, no el motor del chart ni `chartNativeAdapter`) | Medio-bajo | Contraste texto mesa ≥ 4.5:1 (celda `--text-xxs` sobre pozo); popover de búsqueda no empuja el flujo; ninguna regresión en tests de chart; smoke `/stock/AAPL` 1440 y 390 |
| **LOOK-F** | Móvil calidad de uso: fold (estado 1 línea con disclosure, popover flotante, «Limpiar» dentro del input), sub-barra sticky Filtros·ficha·Revisar, hunt rail 40 px con máscara, inputs 16 px + `inputmode`, quitar `maximumScale`, `body padding-bottom` = nav real, consolidar breakpoints tocados | P2 | `screener.css` `@media`, `components.css` (`.searchBar`, hunt rail), `app/layout.jsx` viewport, JSX mínimo de la sub-barra | Medio | A 390×844 sin scroll: estado + ficha activa + verdad + ≥ 3 filas de mesa visibles; todos los targets primarios ≥ 44 px (medición CDP); Safari iOS no hace zoom al enfocar (manual dueño o BrowserStack) |

Orden: **A → B** (percepción máxima, riesgo mínimo; B con smoke de las cuatro rutas migradas) → **C ∥ D** (C toca `components.css`, D `screener.css` aside; coordinar por archivo) → **E → F**. Cada oleada = un ticket, un commit, smoke Browser Use antes de commit según la regla de orquestación.

## Qué no tocar

- Mapa del aside (Mercados + familias de la ficha activa), ⏻/−N/intensidad/cobertura, modal como único editor, SHELL-C/D (siguen siendo sus tickets).
- Mesa de vistas (rail de 5 fichas), `HuntCardModeStrip`, semántica de settings/sesión v4, `FILTER_FIELDS`, capas v2.
- Scoring, umbrales, hunt semantics, nocturno, motor VCP/etapa, `chartNativeAdapter`/`lightweight-charts` (solo el chrome alrededor).
- Familias tipográficas, curva de etapa, roles semánticos v2 (`--senal/--traza/--oxido/--humo/--tiza`), regla «sin rojo/verde como veredicto», doctrina de elevación por contorno.
- Tape (`docs/prototypes/tape/`): su paleta `#0e1116/#151a21` es evidencia del gusto del dueño (oscuro neutro-frío, sin verde de lienzo), **no** una implementación a importar.
- Mini/GHA, auth, datos, licencia.

## LO QUE NO VERIFIQUÉ

- Los hex candidatos v2.3 **no** se han visto en pantalla; son punto de partida, no valores cerrados. Validar en LOOK-B con captura A/B antes de commit.
- Contraste WCAG real de `--humo` nuevo sobre `--pizarra-2` nuevo (calculado a ojo, no medido).
- `market-health.css` y `research-desk`/`review`/`lists`/`sectors` en navegador (solo leí CSS). LOOK-B necesita smoke en esas rutas.
- Safari iOS real (zoom de inputs, `safe-area`, `100vh` del drawer): la emulación CDP en Chrome no lo reproduce.
- Cuántos de los 105 `var(--accent)` son borde de «activo» vs. otro uso; el reemplazo `--accent → --line3` puede necesitar excepciones (focus, CTA).
- Origen exacto del verde de sparklines/MA (si viene de JS del chart adapter o de CSS) para el token `--serie-alza`.
- Coste de retirar `pulse*`: no busqué consumidores en JSX.
- Nada de esto se ha probado con datos completos «3319 analizadas»; el smoke fue con la mesa cargando 28 mercados.
