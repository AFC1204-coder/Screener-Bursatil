# Rediseño de la pantalla principal (Screener) — propuesta 2026-11

Fecha: 2026-11-06 · rama `codex/statsedge-ui-polish` · dev server `:3320` (no tocado)
Maqueta navegable: `research/redesign-2026-11/index.html` (abrir con `open index.html` o servir la carpeta; sin dependencias salvo Google Fonts).
Capturas: `capturas/actual/` (producto real, Playwright + Chrome local, sesión dev) y `capturas/propuesta/` (maqueta).

Convención de este documento: **[M]** = medido (DOM, captura o código); **[S]** = supuesto o juicio de diseño sin medir.

---

## (a) Diagnóstico de lo actual

### Screener (`/`) — `capturas/actual/screener-1440-full.png`, `screener-1024.png`

| Hallazgo | Evidencia |
|---|---|
| **La primera fila de la cola empieza a 720 px del borde superior** a 1440 y también a 1024. Por encima: topbar 50 + hero 148 + aviso 40 + tarjeta de búsqueda/fichas 181 + cabecera «Resultados» 63 + «Más filtros» + Caza/Auditoría + pista de teclado + cabecera de tabla. **A 1024×768 solo se ve 1 fila sin desplazar.** | [M] `getBoundingClientRect` vía Playwright: `firstRow.y = 720` en ambos anchos; `screener-1024.png` |
| El nombre de la vista aparece **cinco veces**: h1 «Líderes Etapa 2», pestaña activa del rail, «Ajustar ficha · Líderes Etapa 2», línea de verdad «pasan «Líderes Etapa 2»» y «Ficha «Líderes Etapa 2» deja 937 de 3287». | [M] `screener-1440-full.png`, `screener-1024-disclosures.png` |
| La barra lateral de 272 px contiene tres controles (Diario/Expert, «EE. UU. 1/27», «Ajustar ficha») y 188 px de alto; el resto del raíl queda vacío. | [M] `sidebar: w 272 h 188` |
| El aviso «Precios del 15 oct» usa borde `--risk` (óxido) y etiqueta en óxido para un problema de **infraestructura/dato**. Contradice la regla 7 de `docs/design/DIRECCION-VISUAL.md` («alertas de infraestructura jamás señal ni óxido»). | [M] `styles/screener.css:333` `border:1px solid var(--risk)`; captura |
| Entre «Resultados» y la primera fila hay **cuatro filas de control** (Más filtros · Caza/Auditoría + Compacto/Cómodo · pista j/k · cabecera). Dos de ellas son preferencias persistentes que no cambian a diario. | [M] captura; `ResultPagerTable.jsx` + `HuntTapeView.jsx` |
| Valores ausentes se escriben como texto («Sin RS», «Sin VCP») en la mayoría de filas: en la captura, 20 de 21 filas dicen «Sin VCP». El ruido tipográfico de la ausencia pesa más que el dato presente. Los tokens ya prevén `--ghost` para esto. | [M] captura; `HuntTapeView.jsx:259` |
| La cinta pinta **las 937 filas en el DOM** (no está virtualizada). Cada fila lleva un SVG de sparkline. | [M] `rowCount: 937` (`.huntTapeRow`) |
| `screener.css` usa dos tokens que **no existen** en `tokens-v2.css`: `--surface-raised` (hover de fila, `:11081`) y `--ok` (línea MM del spark, `:11133/:11148`). Efecto: el hover de fila no se ve y la media móvil del spark no se pinta. | [M] grep sin definición en `styles/` |
| El menú «⋯» agrupa plantillas, «Más bases de filtro», Traer datos frescos, Resetear, CSV, Guardar y JSON audit: un cajón de sastre sin jerarquía. | [M] `screener-1440-menu-mas.png` |
| Modo **Expert** despliega «Qué aplica esta ficha» y «¿Qué recorta?» en línea y empuja la tabla ~250 px más abajo. | [M] `screener-1440-expert.png` |
| Buscador a ancho completo (1 088 px) sobre las fichas; su uso real es puntual (ticker → ficha). | [M] captura; [S] frecuencia de uso |
| La cabecera semanal («Desde el vie 9 oct · Etapa 2: 51 entradas, 49 salidas · Máximos…») es información valiosa pero vive como frase en el hero, no como algo que se pueda abrir como cola. | [M] `WeeklyChangesLine`; decisión A de agosto pedía absorberla en el raíl |
| Tabla **Auditoría**: filas de 66 px (estrella + logo + ticker + bandera + nombre en dos líneas + spark + chip «Etapa 2 / Dudoso» con borde). Ocho columnas caben sin scroll a 1440 y a 1024, pero la densidad es la mitad que en Caza. | [M] `screener-1440-auditoria.png` (filas a y=392, 458) |

### Vistas hermanas — `lists-1440.png`, `sectors-1440.png`, `review-1440.png`, `research-desk-1440.png`, `market-health-1440.png`, `stock-KO-1440.png`

| Hallazgo | Evidencia |
|---|---|
| **Cada página repite una botonera de navegación cruzada** bajo su título (Listas: Screener/Vista rápida/IPO Radar/Research/Sectores; Sectores: Screener/Listas/Vista rápida/Research/Recargar local; Research: seis botones; Review: cuatro). Duplican la topbar y cada una en un orden distinto. | [M] las cinco capturas |
| **Tarjetas KPI por acumulación**: Listas muestra dos filas de tiles (55 / 0 / «Precios del 15 oct» / «18 oct 2026», luego Global / 55 / 98 / 6 / Ranking en vivo) más cuatro tiles de «Trazabilidad review»; Review vacío muestra **ocho ceros** en tiles; Sectores, cuatro tiles. Un dato de fecha («18 oct 2026») en tipografía de métrica grande es un número que no cambia. | [M] capturas |
| Tres tratamientos de título distintos: Screener/Listas/Sectores/Research en Instrument Sans 30 px/900; Mercado en Archivo display mayúsculas («SALUD DE MERCADO»); la ficha en Archivo 50 px para el ticker. | [M] lista de fuentes por ruta en el log de captura: Archivo solo en `market-health` y `stock` |
| Cada página tiene su propia «franja de cobertura/estado» plegable con etiqueta distinta («Listas · cobertura», «Sectores · cobertura», «Research · estado», «Datos · cobertura»). | [M] capturas |
| **Ficha** (`/stock/KO`): tres tarjetas apiladas (cabecera 220 px, «Tu clasificación» 55 px, tarjeta de gráfico con su propio buscador) antes del lienzo; el gráfico empieza a ~620 px. La tarjeta de identidad dentro del lienzo (iteración 4 del 21-ago) está bien y no se toca. | [M] `stock-KO-1440.png`; memoria `cuadro-grafico-medicion` |
| `/lists` a 1440 pintó una vez sin CSS (FOUC con overlay «Rendering…» del dev server); en la recaptura con más espera está bien. | [M] `lists-1440.png` (segunda captura); [S] artefacto del dev server, no de producto |
| `/market-health` tardó 23–37 s hasta `networkidle` frente a 4–6 s el resto. | [M] log de captura; [S] causa (RPC/series), fuera de alcance |

### Lo que se contradice

- La dirección visual dice «ticket fino arriba, no es un hero» (§4) y el screener tiene un hero de 148 px.
- Los principios dicen «menos superficie» (§2) y «cinco cosas» (§4), y el screener tiene cinco superficies para explicar el filtro (badge Balanceado, chip RS 925/937, «Qué aplica esta ficha», línea de verdad, «¿Qué recorta?»).
- Los tokens dicen que lo ausente «pierde tinta» (`--ghost`) y la cinta lo escribe en palabras.
- Alertas de infraestructura en óxido (regla 7).

---

## (b) Principios de diseño de esta propuesta

1. **La tabla desde el primer píxel útil.** Todo lo que no sea cola o control directo de la cola baja a un clic. Objetivo: primera fila a <200 px a 1440 y a 1024.
2. **Una cosa, un sitio.** El nombre de la vista se escribe una vez (es el título). El filtro vivo se lee en las fichas sobre la tabla y en ningún otro lado: «lo que no está en las fichas, no está filtrando» (maqueta A, agosto).
3. **Presupuesto de información fijo.** Seis columnas en Caza, ocho en Auditoría. Nada entra sin sacar algo.
4. **Lo ausente pierde tinta; lo del usuario gana marca.** «—» en `--ghost` para RS/VCP ausentes; ★ y la resolución (●/◐/○) del usuario sí se ven en la fila (cierra el pendiente del 12-ago).
5. **La infraestructura no compite con el mercado.** Avisos de datos en una línea tiza/humo, sin color; el estado de datos vive en un punto de la topbar.
6. **Memoria muscular.** El raíl, el orden de columnas y las teclas no cambian entre vistas ni entre páginas hermanas.
7. **Implementable con la base actual.** Solo tokens de `tokens-v2.css` (más cuatro propuestos), componentes existentes reordenados, sin librerías nuevas.

### Qué conservo y qué descarto de la maqueta A/B de agosto

| Elemento | Decisión | Por qué |
|---|---|---|
| A · raíl de vistas (nocturnas + mías) | **Conservado** y ampliado con el grupo «Esta noche» | Es el corazón de A; 250 mañanas al año premian el mismo gesto |
| A · tabla desde el primer píxel | **Conservado**, ahora medido (160 px a 1440) | Era la promesa; hoy no se cumple (720 px) |
| A · fichas de filtro sobre la tabla | **Conservado** | Resuelve las cinco explicaciones del filtro |
| A · «pulso de mercado en franja fina» | **Descartado como franja**; queda una línea al pie del raíl («Mercado US · favorable →») | La franja era información de otra página (`/market-health`); una línea basta para no saltar |
| B · constelación de etapas en cabecera | **Descartado** | Roza el principio 1 (el sistema jerarquizando) y cuesta 72 px por mañana |
| B · «El cambio de esta noche» como bloque | **Descartado como bloque; absorbido como grupo de vistas** | Lo mismo que recomendé en agosto: el delta es una cola más, no un parte |
| Glifo «Curva de etapa» en la fila | **No entra en la fila**; va en el panel lateral | Presupuesto: la fila ya dice «2 · sem. 10»; el glifo aporta en lectura, no en barrido |

---

## (c) Qué cambia por zona (antes → después)

Capturas de referencia: antes `capturas/actual/screener-1440-full.png`; después `capturas/propuesta/propuesta-1440-caza.png`, `-peek.png`, `-auditoria.png`, `-filtros.png`, `-retrasados.png`, `-vacio.png`, `-claro.png`, `propuesta-1024-*.png`.

### Cabecera
- **Antes**: topbar 50 px + hero 148 px (eyebrow «STATSEDGE · SCREENER», h1 30 px, «1 mercado», frase semanal) + aviso 40 px.
- **Después**: topbar 48 px (marca, nav, punto de estado de datos con «corte 18 oct · 05:00», cuenta) + **ticket 44 px**: nombre de la vista como título desplegable, chip de ámbito «EE. UU. 1/27», verdad corta «937 de 3.287 pasan · ordenado por Rend. 3M», buscador compacto (260 px, tecla `/`), CTA «Revisar 937» y «⋯». El eyebrow desaparece (la nav ya dice dónde estás). **−152 px** [M en maqueta].

### Selector de mercados
- **Antes**: tarjeta en la barra lateral («EE. UU. 1/27») que despliega presets + rejilla de 27 chips; en Expert, rejilla fija de 7 presets.
- **Después**: un chip en el ticket que abre el mismo popover (presets Global / EE. UU. / US+Core intl / Core intl / Europa / Asia / HK + personalizar). Mismo componente `MarketPresetBar` + `MarketCustomizeDetails`, nuevo anclaje. Foco de mercados US/HK/Europa: SG y ZA siguen fuera (no aparecen en presets ni en la cola).

### Presets y filtros
- **Antes**: rail horizontal de 5 fichas (38 px) + badge Balanceado + chip RS + disclosure «Qué aplica esta ficha» + línea de verdad + «¿Qué recorta?» + barra lateral «Ajustar ficha» con familias.
- **Después**: **raíl izquierdo de 208 px** con tres grupos: *Del análisis nocturno* (las 5 fichas actuales, con conteo), *Esta noche* (Entradas E2 51 · Salidas E2 49 · Nuevos máximos 2 · A <5 % del máximo 80 — los cuatro datos de `WeeklyChangesLine` convertidos en vistas) y *Mis vistas* (plantillas guardadas + favoritos + «Guardar vista actual»). Sobre la tabla, una **barra de 40 px**: Caza/Auditoría · fichas del filtro vivo («Etapa 2 mín.», «RS ≥ 50 ×», «Liquidez ×») · «+ Filtro» que abre el popover de familias (`FilterArchitecturePanel` reubicado) con el recorte por familia («−2.250», «−41», «−59», «3.287 → 937») · a la derecha «937 en cola», densidad y columnas. Las explicaciones largas («Qué aplica esta ficha», «¿Qué recorta?», auditoría del laboratorio) viven dentro del popover, no en la página. Diario/Expert desaparece como toggle: Expert = popover abierto.

### Tabla (cinta)
- **Antes**: 6 columnas, 37 px/fila, cabecera 28 px, «Sin RS»/«Sin VCP», spark 112×28, `--surface-raised`/`--ok` sin definir, sin indicador de favoritos/resolución, Auditoría con filas de 66 px.
- **Después**: mismas 6 columnas en Caza (Ticker+nombre en humo · Semanal 12M · Etapa «2 · sem. 10 · dudoso» · RS · VCP huella `XW Y/Z NT` · Máx 52s), **32 px/fila** (40 en cómodo), ausentes como «—» ghost, marca del usuario a la izquierda del ticker (★ favorito, ● candidata, ◐ vigilar, ○ descartar en humo), mercado no-US como sufijo mono («ARLN DE»), «Máx 52s» a <3 % en tiza plena (umbral por pantalla, regla 3 de la dirección visual). Auditoría: 8 columnas (Ticker · Tema · RS · Etapa · VCP · Rend. 3M · Máx 52s · Cap.) a **32 px/fila**, sin logo ni estrella ni chip de etapa con borde. Pista de teclado como pie de 26 px con posición «3 / 937» (sustituye a «937 en cola · compacto» y a la pista actual).

### Ficha lateral (nuevo: panel de lectura)
- **Antes**: `Enter` o clic abre `/stock/SYM` (navegación completa); «Revisar» abre `QuickReviewModal`.
- **Después**: **`Space` / `→` / clic** abre un panel de 372 px a la derecha sin perder la cola ni las teclas j/k: ticker + nombre, precio y fecha de cierre, **glifo de curva de etapa** (geometría §5 de la dirección visual, ya existente como `StageCurveChip`), gráfico semanal 12M con MM30 y línea RS, VCP con T1–Tn, Máx 52s, cap./tema, **Tu clasificación** (Candidata / Vigilar / Descartar — el mismo `StockUserClassification`), ★ Favorito y «Abrir ficha ↵». Reutiliza el contenido limpio de `QuickReviewModal` (tras el 24-ago) pero como panel acoplado, no modal. A 1024 se superpone a la tabla con `--shadow-float`.

### Avisos
- **Antes**: `.snapshotFreshnessNotice` de 40 px en óxido; `scanStaleNotice`, guardrails y cola de banners (≤1 hard + ≤1 soft + cajón «Estado de datos»).
- **Después**: **una línea de 30 px** bajo el ticket, superficie `--surface`, etiqueta «DATOS» en humo, texto en `--soft`, enlace «Traer datos frescos», × para ocultar: «Precios del 15 oct · 15 sesiones sin actualizar · los resultados valen para esa fecha.» Además el punto de la topbar pasa a humo con texto «precios 15 oct · retrasados». La cola de banners se mantiene (lógica en `screenerBannerQueue.js`), solo cambia la piel; los hard (sesión caducada, mercados desalineados) siguen siendo bloqueantes y usan la misma línea con botón.

### Estado vacío
- **Antes**: `MesaEmptyCard` (tarjeta centrada con eyebrow «Mesa») para «sin escaneo»; para «0 pasan» un `huntTapeEmpty` con texto.
- **Después**: el área de la tabla muestra el tramo de Etapa 1 de la curva (línea plana, estado derivado §5), título «Nada pasa «Cerca de pivot» en Europa esta noche», causa con cifras («Corte 18 oct · 1.902 analizadas · 0 pasan») y dos salidas: aflojar la familia que más recorta y cambiar de ámbito. El empty contractual del Hito 1 (sin escaneo / legacy invisible) conserva su copy; solo cambia el contenedor.

### Vistas hermanas (coherencia)
- Mismo **ticket de 44 px** en Listas, Sectores, Research, Review y Mercado: título 20 px, chips de ámbito/fuente, verdad corta, acciones a la derecha. Fuera las botoneras cruzadas (la topbar ya navega), fuera los tiles de KPI que no sean una métrica que cambie (Listas pasa de 13 tiles a una línea; Review vacío, de 8 ceros a un estado vacío con dos salidas).
- Una sola **franja de calidad de dato** compartida (`QualityStrip` ya existe en `app/components/ui/`) con la misma etiqueta en todas: «Datos · corte 18 oct · RS 27 sept n=5.593».
- Título siempre en `--font-body` 20 px/650 (`--display-m`); Archivo display se reserva a los tres usos de la dirección visual (ticker de la ficha, régimen en Mercado, cabeceras de sección).
- Ficha: la cabecera de tres tarjetas se funde en el ticket + la tarjeta del lienzo que ya existe; «Tu clasificación» pasa a la fila del ticket (a la derecha). El gráfico sube ~300 px [S].

### Teclado (sin cambios de significado, dos teclas nuevas)
`j`/`k` mover · `Enter` abrir ficha · `Esc` cerrar panel / quitar foco (ya existen) · **`Space`/`→` panel lateral** · **`/` buscador** · **`f` filtros**. Las teclas no actúan con foco en inputs (misma guarda que `HuntTapeView`).

---

## (d) Qué NO se añade y por qué (presupuesto de información)

| Candidato | Decisión | Motivo |
|---|---|---|
| Columna «Δ noche» (cambio de etapa/RS desde ayer) | No | Ya es una vista del raíl («Esta noche»); como columna sería la séptima y la mitad de filas estarían vacías [S] |
| Glifo de curva por fila | No (va en el panel) | +40 px por fila y repite «2 · sem. 10» |
| Precio y % diario en la fila | No | El % de la serie servida no es el diario (`useChartController.js:124`, medido 21-ago) y el swing trader semanal no decide por el día; está en el panel |
| Score compuesto / composite / A-D | No | Principio 1: la tabla clasifica por hechos; los scores son juicio interno (retirados el 12-ago y el 24-ago) |
| RS país / RS tema en la fila | No | `rsCountryPct == rsGlobalPct` en universo mono-US (medido 21-ago); dos cifras que son una |
| Logo y bandera | No en Caza, no en Auditoría | 24 px de ancho y una petición por fila; el sufijo de mercado en mono dice lo mismo |
| Constelación / pulso de mercado | No | Es `/market-health`; una línea al pie del raíl |
| Chips de veredicto («Auditar antes», «Esperar confirmación») | No | Retirados el 24-ago; no vuelven por la puerta del panel |
| Diario/Expert | No | Dos modos = dos interfaces que mantener; Expert pasa a ser «popover abierto» |
| Toggle Compacto/Cómodo visible | Icono, no segmento | Preferencia persistente, no gesto diario |
| Eyebrow «STATSEDGE · SCREENER» y «1 mercado» | No | La nav y el chip de ámbito ya lo dicen |

---

## (e) Tokens propuestos (mapeados a `styles/tokens-v2.css`)

La maqueta copia los valores de `tokens-v2.css` tal cual (pizarra `#141A17`, tiza `#EDE8DA`, humo `#8A918B`, señal `#E0A93F`, traza `#93B8CE`, óxido `#C4614C`, superficies `--pizarra-0/-2/-3`, líneas `.10/.26/.45`, fuentes Instrument Sans / Spline Sans Mono / Archivo, escala de texto 10–16 px, espaciado 4–32 px, radios 3/6, sombras `--shadow-panel`/`--shadow-float`, transiciones 140/180 ms, geometría de curva `--curve-*`).

**Nuevos (4), a añadir en `tokens-v2.css`:**

| Token | Valor | Uso |
|---|---|---|
| `--surface-raised` | `var(--pizarra-3)` | Hover de fila. Hoy `screener.css:11081` lo usa sin que exista |
| `--row-h` / `--row-h-comfort` | `32px` / `40px` | Altura de fila de la cinta (hoy 36–37 px hardcodeados en `min-height`) |
| `--rail-w` / `--peek-w` | `208px` / `372px` | Ancho del raíl y del panel lateral (hoy sidebar 272 px por grid) |
| `--top-h` / `--ticket-h` | `48px` / `44px` | Altura de topbar y ticket; sticky offsets derivan de ellas |

**Corrección (1):** `--ok` (`screener.css:11133,11148`) → `var(--humo)` para la MM del spark (serie descendente/auxiliar nunca gana color, regla «--serie-baja»).

**Tema claro (barato):** solo redefinir las primitivas bajo `:root[data-theme="light"]` (ver bloque en `index.html`: pizarra `#F2F0E9`, pozo `#FBFAF6`, panel `#FFFFFF`, tiza `#1B211D`, humo `#6B736D`, señal/traza/óxido oscurecidos para contraste AA, líneas en alpha de tinta). Todos los alias semánticos (`--bg`, `--surface`, `--text`, `--line`, `--cta-*`, `--*-dim`) se derivan solos. Coste: ~20 líneas de CSS + un atributo en `<html>`. Verificado en la maqueta (`propuesta-1440-claro.png`): el CTA invertido y las fichas activas siguen legibles [M en maqueta]; contraste AA de `--humo` sobre blanco no medido [S].

**Tipografía:** título de pantalla `--display-m` 20 px/650 en `--font-body` (hoy 30 px/900); micro-etiquetas 10–11 px `--track-label`; números siempre `--font-data` con `tabular-nums` (regla 2 de tokens). Spark: trazo `--soft` 1.4 px, relleno `--line`, MM `--humo`; la fila activa pasa el trazo a `--senal` (único color en reposo de la tabla, como hoy).

---

## (f) Plan de implementación (pasos pequeños, ordenados por impacto/riesgo)

Cada paso cabe en un ticket, se verifica con hard-reload en `:3300`/scratchpad (regla dura #2) y se comitea solo. Nada de esto toca motor, datos ni API.

| # | Paso | Impacto | Riesgo | Archivos probables |
|---|---|---|---|---|
| 1 | **Tokens**: añadir `--surface-raised`, `--row-h*`, `--rail-w`, `--peek-w`, `--top-h`, `--ticket-h`; cambiar `--ok`→`--humo`. | Arregla hover y MM invisibles | Nulo | `styles/tokens-v2.css`, `styles/screener.css` (3 líneas) |
| 2 | **Aviso de una línea**: `.snapshotFreshnessNotice`/`.scanStaleNotice` a 30 px, sin `--risk`, etiqueta «Datos», enlace en vez de botón; punto de estado en topbar. | Quita el óxido y 10 px; cumple regla 7 | Bajo (solo CSS + un span) | `styles/screener.css:327-420,609-670`, `ScreenerShell.jsx:1020-1043`, `app/layout.jsx` (punto) |
| 3 | **Cinta**: fila a `--row-h`, «—» ghost en vez de «Sin RS»/«Sin VCP», marca del usuario antes del ticker (★ de `favoriteSymbols`, resolución de `screenerDecisionResolutions`), nombre en humo tras el ticker, sufijo de mercado. | La tabla se lee de un vistazo; cierra el pendiente del 12-ago | Medio: `lib/screenerHuntTape.jsx` tiene tests (`tests/screenerHuntTape.test.js`) que fijan los textos de ausencia → actualizar | `lib/screenerHuntTape.jsx`, `app/components/screener/HuntTapeView.jsx`, `styles/screener.css:11032-11300`, tests |
| 4 | **Hero → ticket**: sustituir `.screenerHeroBar` por la fila de 44 px (título, chip de ámbito, verdad corta, buscador compacto, Revisar, ⋯). `WeeklyChangesLine` deja de pintar frase (ver paso 6). | **−152 px** sobre la cola; la primera fila sube a ~160 px | Medio: `recordTruthLinePaint` y E2E que buscan `.screenerTruthLine` → mantener la clase en el ticket | `ScreenerShell.jsx:952-967,1085-1142`, `styles/screener.css:7337-7400`, `lib/screenerTruthLine.js` (variante corta), `tests/e2e/filters.e2e.mjs` |
| 5 | **Barra de filtros sobre la tabla**: mover `ResultFilterChips` + Caza/Auditoría a una sola fila de 40 px; «+ Filtro» abre popover con `FilterArchitecturePanel`; densidad y columnas como iconos; retirar `HuntCardModeStrip`, `screenerFilterBreakdown` y el toggle Diario/Expert (su contenido pasa al popover). | Quita 3 filas de control y 5 explicaciones del filtro | Medio-alto: `screenerChromeMode.js` (persistencia Diario/Expert) y `tests/resultFilterChips.test.js` | `ResultFilterBar.jsx`, `ResultPagerTable.jsx:88-101`, `ScreenerShell.jsx:1109-1141,1285-1318`, `ScreenerSidebar.jsx`, `lib/screenerChromeMode.js`, `styles/screener.css:6306-6470` |
| 6 | **Raíl de vistas**: `ScreenerSidebar` pasa a raíl de 208 px con tres grupos; `HuntCardRail` se vuelve vertical; las cuatro cifras de `WeeklyChangesLine` se vuelven vistas (`/api/weekly-changes` ya devuelve entradas/salidas/máximos); plantillas guardadas (`savedFilterTemplates`) como «Mis vistas». A <1100 px, raíl de iconos. | Cumple A; memoria muscular | Alto: nuevas vistas «Esta noche» necesitan que `applyHuntCard` acepte una cola externa (símbolos del delta) → ticket aparte de `lib/screenerHuntCards.js` + `useResultViewModel.js` | `ScreenerSidebar.jsx`, `HuntCardRail.jsx`, `WeeklyChangesLine.jsx`, `lib/screenerHuntCards.js`, `app/page.jsx`, `styles/screener.css:3-30,4715-4770,6960-7050` |
| 7 | **Panel lateral**: nuevo `HuntPeekPanel.jsx` a partir del cuerpo limpio de `QuickReviewModal` (identidad, etapa con `StageCurveChip`, `RowPreviewChart` semanal, RS, VCP, clasificación `StockUserClassification`); `Space`/`→` en `HuntTapeView`; grid `.body` con tercera columna `--peek-w`. | Revisión sin salir de la cola | Alto: estado de foco compartido con el modal (`activeModalRow`), prefetch de chart (`scansChartPreviewHydrate`) por fila enfocada | `app/components/screener/HuntPeekPanel.jsx` (nuevo), `HuntTapeView.jsx:137-176`, `QuickReviewModal.jsx`, `useQuickReviewSession.js`, `styles/screener.css` |
| 8 | **Vacío**: `MesaEmptyCard` y `huntTapeEmpty` comparten contenedor (curva plana + título + causa + dos salidas); copys del Hito 1 intactos. | Coherencia | Bajo | `MesaEmptyCard.jsx`, `lib/mesaEmptyState.js`, `styles/empty-states.css` |
| 9 | **Hermanas**: ticket compartido (`app/components/ui/PageTicket.jsx` nuevo), retirar botoneras cruzadas y tiles no-métrica en Listas/Review/Research/Sectores; `QualityStrip` con la misma etiqueta. | Sensación de plataforma | Medio: E2E `listsRetiredSections`, `listsRsAndDateStrip`, `reviewStockContext` | `app/lists/page.jsx`, `app/review/page.jsx`, `app/research-desk/page.jsx`, `app/sectors/page.jsx`, `styles/lists.css`, `styles/review.css` |
| 10 | **Ficha**: fundir las tres tarjetas de cabecera en ticket + lienzo; «Tu clasificación» a la fila del ticket. | Gráfico ~300 px más arriba [S] | Medio: `tests/fichaRetiradas.test.js`, `descriptiveStrip.test.js` | `app/stock/[symbol]/StockClient.jsx`, `styles/stock.css` |
| 11 | **Tema claro** (opcional, al final): bloque `:root[data-theme="light"]` + toggle en cuenta. | Marketing/ficha compartible | Bajo, pero cada hardcode de hex fuera de tokens se verá: auditar `components.css` (`#7f8794` en `screener.css:7373`, p. ej.) | `styles/tokens-v2.css`, `app/layout.jsx` |
| 12 | **Virtualizar la cinta** (si el paso 3 no basta): ventana de ~60 filas con `rows.slice` + spacer; la hidratación por viewport ya existe (`scansChartPreviewHydrate`). | Scroll y filtro instantáneos con 937+ | Medio: j/k y `scrollIntoView` sobre filas no montadas | `HuntTapeView.jsx`, `lib/screenerHuntTapeDensity.js` |

Orden sugerido: 1 → 2 → 3 → 4 → 5 (ya se nota «profesional» con cinco tickets, sin tocar lógica) → 8 → 6 → 7 → 9 → 10 → 12 → 11.

---

## (g) Riesgos y cómo medir que no empeora el rendimiento

**Riesgos de producto**
- *Raíl de iconos a 1024* (paso 6): los glifos del raíl son crípticos sin etiqueta; mitigación: tooltip + el título del ticket abre la misma lista. Si el dueño prefiere, a 1024 el raíl puede plegarse del todo y vivir solo en el desplegable del título.
- *Panel lateral + modal*: dos superficies de lectura rápida si `QuickReviewModal` sigue existiendo para «Revisar»; propuesta: «Revisar» recorre la cola con el panel abierto (misma pieza), el modal se retira en el paso 7.
- *Vistas «Esta noche»*: dependen de `scan_symbol_history` con dos nocturnos del mismo motor (memoria `que-cambio-semana-v1`); si falta el par, el grupo se pinta con «—» y no desaparece (empty contractual).
- *Tests que fijan copys* («Sin RS», «Sin VCP», `.screenerTruthLine`, botoneras de Listas): cada paso lista sus tests; no se cambia copy sin cambiar test en el mismo commit.
- *Tema claro*: hexes hardcodeados fuera de tokens (`#7f8794` en `screener.css:7373`, `rgba(126,176,255,…)` en `:11126`) se harán visibles. Es trabajo mecánico, no bloqueante.

**Rendimiento: presupuesto y medición** (la interfaz debe reaccionar rápido)
- Métrica 1 — *pintura de la primera fila*: `performance.mark` ya existente `recordTruthLinePaint` (`lib/screenerHuntPerf.js`); añadir marca `firstRowPaint`. Presupuesto: no peor que hoy en warm (203 ms extended, `docs/backlog-activo.md`).
- Métrica 2 — *cambio de vista* (clic en el raíl): tiempo entre `applyHuntCard` y `truthLinePaint`; hoy se mide con `isHuntTransitionPending`. Presupuesto: ≤ hoy; objetivo <120 ms con la cola en memoria.
- Métrica 3 — *abrir panel lateral*: `Space` → panel pintado. Presupuesto <80 ms con chart ya hidratado (la hidratación por viewport ya trae las ~20 filas visibles); sin chart, esqueleto inmediato y chart al llegar.
- Métrica 4 — *nodos DOM de la cinta*: hoy 937 `li` × ~9 nodos. Con fila de 32 px caben 21 filas a 1440×900 [M en maqueta]; si el paso 3 sube el coste de render por fila (marca + nombre), virtualizar (paso 12) antes de que el filtro tarde más de 16 ms. Medir con `tests/e2e` + `performance.now()` alrededor de `setFocus`.
- Métrica 5 — *peso de CSS*: `screener.css` tiene 11 881 líneas; los pasos 4–6 deben **retirar** las reglas de hero, rail horizontal, mode strip y breakdown (≈600 líneas) [S], no añadir encima. Comprobación: `wc -l styles/screener.css` antes/después en cada PR.
- Protocolo: cada ticket repite la captura de `research/redesign-2026-11/capturas/` con el mismo script (Playwright + Chrome local, 1440 y 1024, `firstRow.y`, `rowCount`) y adjunta las cifras al commit. Reproducible con el script de captura usado aquí (sesión dev vía `/api/auth/session`, como `scripts/e2e/run.mjs`).

---

## Anexo — medidas de la maqueta (Playwright sobre `index.html`)

| | Actual 1440 | Propuesta 1440 | Actual 1024 | Propuesta 1024 (con aviso) |
|---|---|---|---|---|
| Topbar | 50 | 48 | 50 | 48 |
| Hero / ticket | 148 | 44 | 148 | 44 |
| Aviso | 40 | 0 (30 si hay) | 40 | 30 |
| Hasta la primera fila (y) | **720** | **160** | **720** | **190** |
| Filas visibles sin scroll | ~17 (900 alto) | 21 | **1** (768 alto) | 15 |
| Columnas Caza / Auditoría | 6 / 8 | 6 / 8 | 6 / 8 | 6 / 8 |
| Alto de fila Caza / Auditoría | 37 / 66 | 32 / 32 | 37 / 66 | 32 / 32 |

Todo lo de la columna «propuesta» está medido sobre la maqueta, no sobre producto; el producto puede desviarse por fuentes cargadas y por el contenido real de los avisos.
