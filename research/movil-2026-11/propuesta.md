# StatsEdge en móvil: auditoría y propuesta (2026-11)

Fecha: 2026-11-06 · rama `codex/statsedge-ui-polish` (árbol con cambios sin comitear de otros agentes) · dev server `next dev` en `:3320` contra la Postgres local `127.0.0.1:55432/statsedge_local` (solo SELECT). No se ha tocado código del repo: todo lo escrito está en `research/movil-2026-11/`.

Prototipo: `research/movil-2026-11/prototipo/index.html` (abrir con `open`; sin dependencias externas). Capturas: `capturas/actual/` (producto) y `capturas/propuesta/` (prototipo). Scripts reproducibles: `scripts/`.

Convención: **[V]** = verificado (medido con Playwright, API, base de datos o captura) · **[C]** = confirmado leyendo código, sin reproducir · **[S]** = supuesto o juicio de diseño sin medir.

---

## Resumen ejecutivo

1. **A 390 px, el screener enseña 1 fila sin desplazar** [V]. La primera tarjeta empieza en y=338 y cada una mide 253-264 px: 50 tarjetas son 15,6 pantallas de scroll. Con la propuesta se ven **11 filas** a 390×844 y 9 a 360×740 [V en prototipo].
2. **La ficha no muestra el gráfico sin desplazar**: el lienzo empieza en y=884, por debajo de los 844 px del viewport [V]. En el prototipo, el gráfico empieza en y=82.
3. **Lo que se ve puede engañar en cuatro sitios** [V]: (a) el gráfico de la vista rápida pinta «RS global **0**» cuando el valor no tiene RS (TJGC); (b) en el nocturno, `price` es el cierre del **16-oct** pero `lastDate` dice **15-oct** (4 de 4 símbolos comprobados), así que el rótulo «Precios del 15 oct» no corresponde al precio; (c) en la lista móvil la antigüedad del RS (semana 39, 27-sep) no aparece en ningún sitio; (d) la tarjeta móvil usa otras columnas y otra notación que la cinta de escritorio («Sin VCP», chip «Etapa 2 / Dudoso», Tema, Cap.) en lugar de «2 · sem. 10» y la huella `Y/Z NT`.
4. **Peso**: cada carga del screener descarga `/api/scans` **dos veces completo** (2.297 KB + 2.337 KB con gzip, 14,2 MB de JSON sin comprimir cada vez) [V]. Una proyección de lista con 22 campos pesa **295 KB gzip (−87 %)** y se parsea en 4 ms en vez de 88 ms [V, cálculo sobre la respuesta real].
5. **Con CPU ×4 y 4G** (emulado), la primera fila tarda 5,2 s y el scroll tiene tareas largas de hasta 1,2 s; el heap JS llega a 151 MB [V en dev; en producción será menor, [S]].
6. **Táctil**: en el screener, 124 de 139 controles miden menos de 44 px. La barra inferior pone 5 iconos de 57×36 en una rejilla de 6 columnas (el sexto hueco queda vacío) y **oculta las etiquetas por debajo de 391 px** [V].
7. **Texto**: el 59 % de los textos del screener móvil mide menos de 12 px (11 px y 10 px). Review usa 9 px [V].
8. **Propuesta**: lista de una línea (56 px) con 4 datos y miniatura (*Valor · 12M · Etapa · RS · Máx 52s*), vistas como pestañas deslizables, filtros en hoja inferior, vista rápida en hoja inferior con la clasificación al alcance del pulgar, ficha con el gráfico arriba y secciones plegables, y barra inferior con etiqueta (Screener · Listas · Sectores · Mercado · Más).
9. **Descartado**: gestos de deslizar fila, *pull-to-refresh*, carrusel de vistas por gesto, tabla horizontal con scroll y menú hamburguesa. Los motivos están en §2.
10. **Plan**: 12 pasos pequeños. Los 4 primeros (bug del RS 0, fecha del precio, una sola descarga de `/api/scans` y la barra inferior) son de esfuerzo S y no cambian el diseño. Al final quedan 7 decisiones para ti.

---

## 1. Auditoría del estado actual

### 1.1 Método

- Script `scripts/auditar.mjs`: Playwright + Chrome local, sesión dev con `POST /api/auth/session` (el token se lee de `.env.local` sin imprimirse), 9 rutas × 3 tamaños (390×844 y 360×740 con emulación móvil táctil; 768×1024). Mide desborde horizontal, objetivos táctiles <44 y <24 px, textos <12 px, cromos fijos, filas visibles, tiempo hasta el primer contenido útil, peticiones y KB (CDP `encodedDataLength`) y jank (desplazar 3 pantallas en 1,5 s con rAF + `longtask`). Resultado completo: `capturas/actual/auditoria.json`.
- Script `scripts/estres-movil.mjs`: screener a 390 sin limitar y con CPU ×4 + red 9 Mbps / 60 ms (CDP).
- Las capturas `*-390.png` son el primer viewport; las `*-390-completa.png`, la página entera.

**Advertencia de medida.** Es un servidor de desarrollo: JS sin minificar (6,5 MB en el screener), compilación bajo demanda, doble efecto de StrictMode y otros agentes editando el árbol. Los **tiempos absolutos y los KB de JS no representan producción**. Sí valen las cuentas de peticiones, los KB de API, la geometría y los comportamientos. `/market-health` a 390 no terminó de cargar en 5 s (en la pasada a 360 sí), así que para Mercado uso las cifras de 360.

### 1.2 Tabla de medidas (390×844 salvo indicación)

| Pantalla | 1.er contenido | Pantallas de scroll | Controles <44 / total | <24 px | Textos <12 px | API (KB) | Observación clave |
|---|---|---|---|---|---|---|---|
| Screener | 1,2 s | **15,6** | 124 / 139 | 57 | 670 / 1.138 (59 %) | **4.695** | **1 fila visible**; primera en y=338 |
| Ficha AAPL | 2,6 s (lienzo) | 7,6 | 66 / 95 | 4 | 176 / 393 | 11 | **Lienzo en y=884** (fuera de pantalla) |
| Listas | 3,8 s | 1,1 | 10 / 12 | 1 | 27 / 69 | 12 | Vacía: «0 acciones · 0 listas» con 937 en el screener |
| Research | 1,9 s | 1,6 | 16 / 27 | 2 | 43 / 92 | 123 | `/api/favorites/snapshots` pedido 4 veces |
| Review | 2,4 s | 3,7 | 24 / 33 | 1 | 28 / 90 (13 a **9 px**) | 61 | 9 botones antes del valor |
| Sectores | 1,9 s | 1,8 | 19 / 19 | 1 | 76 / 281 | 85 | La fila «Fuerza» se corta («Mu… débi…») |
| Mercado (360) | 1,4 s | **11,6** | 13 / 44 | 3 | 440 / 812 | **3.488** | `/api/market-leadership` 1.673 KB **sin comprimir**, ×2 |
| IPO radar | 8,6 s | 1,5 | 18 / 19 | 1 | 17 / 32 | 0 | La barra inferior desaparece (`ipo-radar.css:54`) |
| 404 | 2,0 s | 1,1 | 8 / 13 | 0 | 3 / 15 | 0 | Correcta |
| Screener 360×740 | 0,9 s | 17,8 | 124 / 139 | 57 | 670 | 4.695 | 1 fila visible |
| Screener 768×1024 | 4,1 s | 1,0 | 158 / 1.999 | 34 | 2.042 / 5.925 | 4.702 | Rama escritorio (corte en 760 px): **937 filas en el DOM**, 26 visibles |

No hay desborde horizontal de página en ninguna pantalla ni ancho (`scrollWidth == innerWidth`) [V]. Sí hay desbordes internos: los segmentos de Sectores y Mercado (cortados), y en 768 la botonera de IPO radar llega a x=810.

Nota sobre «<44»: el contador incluye elementos de menús `<details>` cerrados que el navegador mide con caja (p. ej. «Traer datos frescos» de 14×58). Los ejemplos citados abajo son todos visibles en las capturas.

### 1.3 Hallazgos

| # | Sev. | Pantalla | Hallazgo | Evidencia | Archivo:línea |
|---|---|---|---|---|---|
| M1 | **Alta** | Screener | Tarjeta de 253-264 px por valor, con 7 pares etiqueta/valor (Tema, RS, Etapa, VCP, Rend. 3M, Dist. máx 52s, Capitaliz.) y miniatura: **1 fila visible**, 50 por página = 15,6 pantallas | [V] `01-screener-390.png`, `altoFila [264,253,…]` | `lib/screenerMobile.jsx:47-72` (`MobileResultRow` pinta todas las `screenerVisibleColumns`), `styles/screener.css:4433,4478,4835,4860` (cuatro definiciones de `.mobileResultRow`) |
| M2 | **Alta** | Screener | La rama móvil **no usa la cinta de escritorio** (`HuntTapeView`/`lib/screenerHuntTape.jsx`): escribe «Sin VCP» en texto, la etapa como chip «Etapa 2 / Dudoso» y omite la huella `Y/Z NT` y «sem. N». Todo lo que se arregló en escritorio (pasos 3 y 6 del rediseño) no llega al móvil | [V] captura frente a `paso-9/01-screener-despues-1440.png` | `lib/screenerMobile.jsx:58` frente a `lib/screenerHuntTape.jsx:79-125, 147, 173-191` |
| M3 | **Alta** | Vista rápida / Review | «RS global **0**» para un valor **sin RS** (TJGC). `Number(null)` es 0 y `Number.isFinite(0)` es `true`. El mismo patrón está en las insignias de RS país y RS tema | [V] `01-screener-390-vista-rapida.png`, `05-review-390.png`; [C] causa | `app/UniversalPriceChart.jsx:221-223` (y 226-229, 232+), con `app/RowPriceChart.jsx:185` |
| M4 | **Alta** | Datos (todas) | En el nocturno del 18-oct, `row.price` es el cierre del **16-oct** y `row.lastDate` dice **2026-10-15** (MRNA 218,01; AAPL 343,46; TEAM 207,82; IOVA 13,62; los cuatro coinciden con `daily_bars` del 16-oct). El aviso «Precios del 15 oct» y cualquier «cierre 15 oct» rotulan mal el precio | [V] API `/api/scans` + `SELECT … from daily_bars` | Fuera de la UI: materialización del nocturno (`scripts/scan-universe.mjs` / `lib/materializedScanner`, no auditado). Causa sin cerrar |
| M5 | Media | Datos | La antigüedad del RS (semana 39, 27-sep: 6 semanas antes de hoy) no aparece en la lista móvil. La única fecha visible es la de precios, que además está mal (M4). La ficha AAPL dice «cierre 6 nov» mientras el screener dice «Precios del 15 oct»: son dos fuentes de barras distintas sin explicación | [V] capturas `01-screener-390.png`, `02-ficha-AAPL-390.png` | `ScreenerShell.jsx:1215-1226` (`MobileStatusFold`), `app/stock/[symbol]/page.jsx` |
| M6 | **Alta** | Rendimiento | `/api/scans?includeRows=1&rowsLimit=6000` se descarga **dos veces** por carga (2.297 + 2.337 KB gzip). La respuesta lleva 3.287 filas × 152 campos = 14,2 MB de JSON. La lista móvil usa unos 20 campos | [V] `auditoria.json` (`api`), `scans.json` medido | `app/api/scans/route.js`, `lib/scansApiCache.js` (no auditado a fondo: puede ser StrictMode más una rehidratación `hydrateRs`; el tamaño distinto apunta a dos peticiones diferentes) |
| M7 | Media | Rendimiento | Con CPU ×4 + 4G: primera fila a 5,2 s, tareas largas de 1.219/911/1.132 ms durante el scroll y heap de 151 MB. Sin limitar, pero desplazando 4 s después de cargar: 8 fotogramas >33 ms y tareas largas de 288-697 ms. En la pasada con 5 s de reposo antes de desplazar, 0. El jank depende de si la hidratación de fondo sigue en marcha | [V] `capturas/actual/estres.json` | `/api/scans/chart-preview`, `weekly-changes` y la rehidratación RS compiten con el scroll; 48 nodos por tarjeta |
| M8 | Media | Navegación | Barra inferior: 5 enlaces en `grid-template-columns:repeat(6,…)`, con un hueco vacío a la derecha; objetivos de 57×36; **etiquetas ocultas a ≤390 px** (solo iconos: estrella = «Research» se confunde con favoritos). `.bottomNav` se redefine en unas 15 reglas y `.navLabel` en 10 | [V] `navItems: 57x36 sin-etiqueta` | `styles/components.css:4464-4473` (6 columnas), `:7733-7737` (oculta etiquetas), `app/BottomNav.jsx:7-13` |
| M9 | Media | Screener | 104 px de cromo fijo arriba (topbar 50 de marca + sub-barra 54 *flotante* encima del contenido con sombra) + cabecera de lista pegajosa de 34 + barra inferior de 54. Debajo hay 4 franjas más antes de la primera fila: verdad, buscador a todo el ancho (40 px), aviso de datos y «937 RESULTADOS · 1-50 · RE…» (truncado) con select de 26 px, «Revisar» repetido (está también en la sub-barra) y «⋯» de 16×16 | [V] `chrome` en `auditoria.json`; captura | `ScreenerShell.jsx:1078-1116`, `styles/screener.css:96-125`, `lib/screenerMobile.jsx:94-117` |
| M10 | Media | Filtros | «Filtros (5)» abre un cajón a pantalla completa con **dos controles** («EE. UU. 1/27» y «Ajustar ficha») y 1.300 px vacíos. Las familias y sus recortes están detrás de otro desplegable. El cajón tapa la lista: no se ve cuánto queda al cambiar algo | [V] `01-screener-390-filtros.png` | `app/components/screener/ScreenerSidebar.jsx:173`, `ScreenerShell.jsx:1256-1283` |
| M11 | Baja | Filtros | El filtro «Resolución» vive en un tercer sitio: el desplegable «+ FILTROS · Sin filtros» dentro de la lista. Son tres superficies de filtro en móvil (sub-barra, cajón y desplegable) | [V] captura | `lib/screenerMobile.jsx:126-132` |
| M12 | Media | Vista rápida | Cabecera rota a 390: «Siguiente» cortado («Siguien…»), «TradingView» y «Cerrar» montados uno sobre otro. Selector de temporalidad con **1m/5m/15m/30m/1H/4H**, y la app trabaja con barras diarias. 4 filas de controles (Rango, Temporalidad, Velas/Precio/Log/%, RS/RS tema/Indicadores/Notas) antes del gráfico. Tarda 0,96-1,14 s en abrir | [V] `01-screener-390-vista-rapida.png`; [S] que no haya datos intradía en producto | `app/components/screener/QuickReviewModal.jsx`, `lib/chartSettings.js:16-18` |
| M13 | **Alta** | Ficha | El gráfico empieza en y=884: por encima van la cabecera, «Screener/Web oficial», un buscador, una tarjeta «Review 579/937» (contexto de la cola filtrado a la ficha), «Salida/Edad», «Tu clasificación / Elegir / Nota / + lista» y «Comparar vs SPY». Dentro del lienzo, la tarjeta de identidad y la botonera de 6 botones siguen tapando la parte superior (auditoría del gráfico, H14) | [V] `02-ficha-AAPL-390.png`, `grafico.yAbs = 884` | `app/stock/[symbol]/StockClient.jsx`, `app/UniversalPriceChart.jsx:271-323` |
| M14 | Media | Ficha horizontal | A 844×390, el lienzo mide 747×462 en un viewport de 390 de alto (no cabe), la topbar de 50 px sigue y la tarjeta de identidad (con la tabla de crecimiento trimestral) tapa más de la mitad superior del gráfico | [V] `02-ficha-AAPL-844x390-horizontal.png` | `UniversalPriceChart.jsx`, `styles/stock.css` (sin `@media (orientation:landscape)`) |
| M15 | Media | Ficha | `/api/similar` y `/api/social-sentiment` se piden dos veces al cargar (StrictMode en dev [S]) y **siempre**, aunque estén al final de la página | [V] `api` de la ficha | `StockClient.jsx` |
| M16 | Media | Review | 13 textos a 9 px; botonera de 9 botones (Cola/Snapshot/Favoritos, Anterior/Siguiente, Favorito/Revisada, Ocultar/Ver ocultas, Mostrar cola) antes del valor; el paginador flotante «1/937» tapa la insignia «RS global» | [V] `05-review-390.png` | `app/review/page.jsx`, `styles/review.css` |
| M17 | Media | Mercado | 11,6 pantallas a 360; `/api/market-leadership` = **1.673 KB sin compresión**, pedido 2 veces; 440 textos <12 px | [V] (360) | `app/api/market-leadership/route.js` (sin `compressedJsonResponse`), `app/market-health/page.jsx` |
| M18 | Baja | Sectores | La cabecera dice «0 grupos · 0 favoritos agrupados» y debajo enseña el estado sectorial. «Market score 90» y «Riesgo favorable / mercado alcista» son juicios del sistema en tipografía de métrica. La fila «Fuerza» se corta | [V] `06-sectores-390.png` | `app/sectors/page.jsx` |
| M19 | Baja | Listas | Estado vacío «Sin listas disponibles», con «0 favoritos» y una CTA a «ejecutar un análisis en el screener», cuando el screener tiene 937 resultados. Para el usuario, Listas no tiene nada que ver con lo que acaba de marcar | [V] `03-listas-390.png` | `app/lists/page.jsx` (fuente `/api/discovery`) |
| M20 | Baja | Búsqueda | La tarjeta de resultado de búsqueda (`PreviewCard variant="search"`) pinta `objectiveScore`, `totalScore`, `rsRating`, A/D y EPS proxy: los scores compuestos retirados del producto el 12 y el 24 de agosto | [C] (no se abrió la búsqueda en la auditoría) | `lib/screenerMarket.jsx:357-366` |
| M21 | Baja | Global | `useScreenerMobileViewport` arranca en `false`: en un móvil real, el primer pintado es la rama de escritorio y luego cambia (comentado en el propio hook). Con 937 filas de cinta, ese primer pintado es caro | [C] | `lib/useScreenerMobileViewport.js:17-28` |
| M22 | Info | Tablet 768 | Entre 761 y ~1024 px se sirve la rama de escritorio: correcto en geometría (26 filas visibles), pero **las 937 filas están en el DOM** (5.925 textos, 1.999 controles) | [V] | `HuntTapeView.jsx` (sin virtualizar; paso 12 del rediseño de escritorio) |

**Lo que funciona y no hay que tocar** [V]: ningún desborde horizontal de página; el desplegable de vistas tiene objetivos de 202×44; en reposo, el scroll del screener va a 60 fps (p95 16,7 ms); la página 404 está bien; la ficha no pide `/api/chart` en 1A (usa las barras del SSR).

---

## 2. Diseño por pantalla: alternativas y elección

Principios (los del rediseño de escritorio, aplicados al pulgar):

1. **La cola desde el primer píxel útil.** Objetivo: más de 10 filas a 390×844.
2. **Una cosa, un sitio, y la misma que en escritorio.** Mismas columnas y misma notación que la cinta (`2·41`, `—` en `--ghost`, huella `Y/Z NT`). Memoria muscular entre dispositivos.
3. **Lo que se ve no engaña.** Cada número lleva su fecha a un toque o menos; lo ausente es «—», nunca 0; la fecha del precio es la de la barra.
4. **Zona del pulgar.** Las acciones frecuentes (cambiar de vista, clasificar, siguiente, abrir ficha) caen en el tercio inferior o en la franja de vistas. Lo raro va en «⋯».
5. **Presupuesto fijo**: 4 datos + miniatura por fila; nada entra sin sacar algo.
6. **Mínimos de accesibilidad**: objetivos de 44×44 (con área ampliada si el visual es menor), texto de 12 px o más, contraste de los tokens v2 sin cambios.

### 2.1 Screener: lista

**Alternativas comparadas**

| Opción | Filas a 390×844 | Pros | Contras | Decisión |
|---|---|---|---|---|
| A. Tarjeta actual (7 pares + spark) | 1 [V] | Todo a la vista | 15,6 pantallas; no se compara nada con nada | Descartada |
| B. Tabla de escritorio con scroll horizontal (6-8 columnas) | ~14 [S] | Idéntica a escritorio | Scroll en dos ejes; ticker fijo + 5 columnas no caben; el gesto horizontal choca con el «atrás» de iOS | Descartada |
| C. **Fila de una línea de 56 px: ticker+nombre · 12M · Etapa · RS · Máx 52s** | **11** [V prototipo] | Se barre como la cinta; los 4 datos que deciden un swing E2 en un vistazo | Sin VCP ni tema en la fila | **Elegida** |
| D. Fila de 40 px sin nombre ni spark | ~15 [S] | Más densidad | Sin forma del gráfico, que es lo primero que mira un trader de Weinstein; ticker sin nombre en HK/Europa (códigos numéricos) | Variante «compacta» opcional (decisión 3) |

**Por qué estos 4 datos y en este orden** (para un swing trader de Minervini/Weinstein):
1. **Miniatura 12M semanal**: la forma (base, escalón, extensión) es el filtro más rápido. Es la que ya hidrata `/api/scans/chart-preview` (12 KB gzip medidos [V]). Se atenúa si el precio de la fila va atrasado (misma regla que `huntTapeSparkWrapProps`).
2. **Etapa `2·41` + calificador en una segunda línea («fuga», «dudoso»)**: notación de la cinta (`huntTapeStageLine`). «Semana 41 de E2» le dice si llega tarde.
3. **RS** (canónico semanal, `canonicalRs`): número o «—» en ghost; la fecha va en la cabecera (ver 2.6).
4. **Máx 52s**: distancia al máximo; tiza plena a menos del 3 %, como en escritorio.

Al menos hoy, la **huella VCP** se queda fuera de la fila: en el nocturno solo la tienen 2.835 de 3.287 filas, le falta el segmento de semanas (`lib/screenerHuntTape.jsx:105-117`) y es un dato de lectura, no de barrido. Vive en la vista rápida y en la ficha. Si la quieres en la fila, la columna 4 puede elegirse entre Máx 52s, VCP y Rend. 3M (decisión 2).

**Marca del usuario** (★ ● ◐ ○) a la izquierda del ticker, igual que la cinta (`huntTapeUserMark`). El sufijo de mercado (`MRNA` frente a `0700 HK`) va en mono humo.

**Rendimiento**: con filas de 56 px hacen falta muy pocos nodos (unos 12 por fila frente a los 48 de hoy [V]). La paginación de 50 se sustituye por **ventana virtual** (unas 30 filas montadas) con «se cargan más al bajar». Las miniaturas se hidratan por viewport con el mismo `/api/scans/chart-preview` que ya existe, sin peticiones nuevas.

### 2.2 Vistas: pestañas deslizables y no desplegable

| Opción | Pros | Contras | Decisión |
|---|---|---|---|
| Desplegable en la sub-barra (actual) | Compacto | 2 toques y lectura de un menú; no muestra conteos; hoy hay que adivinar qué otras vistas existen | Descartada |
| **Pestañas en fila con scroll horizontal y conteo** (`Líderes E2 937 · Cerca de pivot · … │ Entradas E2 51 · Salidas E2 49 · Nuevos máx. 2 │ ★ Favoritos`) | 1 toque; mismo orden y grupos que el raíl de escritorio (nocturnas │ esta noche │ mías); el conteo explica sin texto | 44 px de alto | **Elegida** |
| Carrusel de vistas deslizando la lista a izquierda y derecha | Gesto rápido | Choca con el scroll horizontal de las pestañas, con el «atrás» del sistema y con el pan del gráfico; cambiar de vista sin querer es caro (pierde la posición) | Descartada |

### 2.3 Filtros: hoja inferior frente a cajón lateral

| Opción | Pros | Contras | Decisión |
|---|---|---|---|
| Cajón a pantalla completa (actual) | Ya existe | 2 controles en una pantalla vacía [V]; tapa la lista; las familias van detrás de otro desplegable | Descartada |
| Cajón lateral | Patrón conocido en Android | Lejos del pulgar si entra por la izquierda; no deja ver la lista; vertical, pierde ancho para los recortes | Descartada |
| **Hoja inferior (≈85 %) con: mercados · familias con interruptor y recorte (`−2.250`, `−41`, `−59`, `3.287 → 937`) · tu clasificación · botón fijo «Ver 937 valores»** | Al alcance del pulgar; los recortes por familia a la vista (es la pregunta «¿qué me quita resultados?»); un solo sitio para todo lo que filtra, incluida «Resolución» (cierra M11) | Hay que reutilizar `FilterArchitecturePanel` en otro contenedor | **Elegida** |

En la lista, el filtro vivo se lee en **una línea** (`Filtros ③ Etapa 2 · RS ≥ 50 · Liquidez · Rend. 3M ▾`). Es la regla de escritorio: «lo que no está en las fichas no está filtrando».

### 2.4 Vista rápida: hoja inferior, no modal ni navegación

| Opción | Pros | Contras | Decisión |
|---|---|---|---|
| Modal a pantalla completa (actual) | Ya existe | 4 filas de controles antes del gráfico, cabecera rota [V], temporalidades intradía, 1 s para abrir [V] | Descartada como está |
| Ir a la ficha | Toda la información | Se pierde la cola; mucho más pesado (SSR de unos 300 KB en AAPL, según la auditoría del gráfico) | Para «Abrir ficha» |
| **Hoja inferior** con: ticker, precio y fecha de la barra; gráfico semanal 12M con MM10s **a partir de la miniatura que ya está en memoria** (sin petición); Etapa · RS (con semana y fecha) · VCP (huella) · Máx 52s · Rend. 3M · Cap.; **Tu clasificación** (3 botones de 48 px); ★ y + Lista; abajo `‹ 2/937 ›` y «Abrir ficha» | Abre al instante (no pide nada); clasificar y pasar al siguiente con el pulgar sin moverse; mismo contenido que el panel de lectura de escritorio (paso 7) | Con velas diarias, la decisión fina se toma en la ficha | **Elegida** |

### 2.5 Gestos

| Gesto | Decisión | Motivo |
|---|---|---|
| Deslizar fila para ★ o clasificar | **Descartado en v1** | Invisible (nadie lo descubre), se dispara sin querer al hacer scroll vertical y choca con el «atrás» de iOS. La clasificación ya queda a 2 toques en la hoja (toque en la fila → botón), con confirmación visual. Revisable si hay uso real |
| *Pull-to-refresh* | **Descartado** | Los datos son nocturnos: tirar no trae nada nuevo y daría a entender que los datos son «de ahora» (engaña). La acción real («Traer datos frescos») solo existe cuando hay algo que traer y va en la línea de datos |
| Pellizco y arrastre en el gráfico | **Se mantiene** | Ya funciona sin tirones (auditoría del gráfico, H16-H17) |
| Deslizar horizontalmente en la vista rápida para pasar al siguiente | **Opcional** (decisión 5) | Es un contexto de paginación, sin scroll horizontal que lo contradiga; los botones ‹ › siguen ahí |
| Arrastrar la hoja hacia abajo para cerrarla | **Sí** | Patrón nativo; × visible también |

### 2.6 Frescura: el indicador mínimo que no engaña

- **Cabecera de cada pantalla**: `937 de 3.287 · precios 16 oct · RS 27 sept`, en humo y con subrayado punteado (`--line-stale`) que se abre al tocar. Son dos fechas, porque son dos datos distintos (barras y ranking semanal), y hoy el RS va 6 semanas por detrás del precio.
- **Si el precio va atrasado** (umbral de `rowDataAgeMark`): una línea de 36 px «DATOS · Precios del 16 oct · 15 sesiones sin actualizar · Traer», en `--surface`, sin `--risk` ni `--senal` (regla 7 de la dirección visual). Mismo texto que el aviso de escritorio.
- **Por fila**: miniatura atenuada si su precio es más viejo que el del corte (ya existe en escritorio).
- **Requisito previo**: corregir M4. Mientras `lastDate` y `price` no coincidan, cualquier rótulo de fecha estará mal. El prototipo rotula con la fecha de la barra.

### 2.7 Ficha

| Opción | Decisión | Motivo |
|---|---|---|
| Página larga actual (gráfico en y=884) | Descartada | El gráfico es la razón de abrir la ficha |
| **Gráfico arriba (300 px) + lectura de cursor en una línea + rangos en una fila de 48 px fuera del lienzo + «Tu clasificación» + secciones plegables** (Etapa abierta; RS, VCP, Máx 52s/Rend., Notas y noticias cerradas) | **Elegida** | Gráfico en y=82 [V prototipo]; la línea `25 ago · C 158,83 · MM50 71,57 · RS — sin dato` resuelve H4 de la auditoría del gráfico y dice cuándo el RS no existe en esa fecha (solo hay 5 semanas del motor fijado, W35-W39 [V DB]); sin tarjeta de identidad ni botonera tapando el lienzo |
| Pestañas (Gráfico / Datos / Notas) | Descartada | Esconde la clasificación detrás de una pestaña; con secciones plegables se ve todo de un vistazo y se abre solo lo que interesa |
| Temporalidades intradía | **Fuera en móvil** | No hay datos intradía; ofrecerlas engaña (M12). Solo D / S |
| Noticias, similares y sentimiento | **Al desplegar** | Hoy se piden siempre al cargar (M15); así se ahorran dos peticiones por ficha |

**Modo horizontal**: al girar el teléfono, o con el botón ⤢, el gráfico ocupa la pantalla (844×310 + lectura de cursor + rangos), sin topbar, barra inferior ni tarjeta de identidad. Hoy el lienzo no cabe (747×462 en 390 de alto) y la tarjeta tapa la mitad [V]. Se implementa con `@media (orientation: landscape) and (max-height: 500px)` sobre la ficha, sin JS.

### 2.8 Navegación global: barra inferior con etiqueta

| Opción | Pros | Contras | Decisión |
|---|---|---|---|
| Barra actual (5 iconos sin etiqueta, 57×36, hueco vacío) | Ya existe | Iconos ambiguos (★ = Research); objetivos de 36 px; rejilla mal | Corregir |
| Menú superior o hamburguesa | Libera la parte de abajo | Lejos del pulgar; esconde la navegación; un toque más | Descartada |
| **Barra inferior de 56 px con etiqueta de 12 px: Screener · Listas · Sectores · Mercado · Más** (Más = Review, Research, IPO radar, Estado de datos, Ajustes) | Pulgar; etiquetas legibles; 5 destinos como dicen las guías de iOS y Android; Sectores y Mercado (régimen y grupos líderes) son de uso diario en el método | Research y Review pasan a 2 toques | **Elegida** (decisión 1: ¿Research o Sectores en la barra?) |

Además, la **topbar de marca (50 px) desaparece en móvil**: cada pantalla tiene su propia cabecera de 52 px (título + subtítulo de frescura + 1-2 acciones). La sub-barra flotante (54 px), el buscador a todo el ancho y el «Revisar» duplicado se van: la búsqueda pasa a un icono que abre una hoja, y «Revisar» es tocar la primera fila (la hoja ya pagina).

### 2.9 Resto de pantallas

- **Listas**: la misma fila y las mismas columnas que el screener (memoria muscular), con pestañas `★ Favoritos · ● Candidatas · ◐ Vigilar · listas propias`. Sale de las marcas del usuario (`favoriteSymbols`, `screenerDecisionResolutions`), no de `/api/discovery`, así que deja de estar vacía cuando el usuario ya ha marcado valores (M19). Las miniaturas, con `/api/chart/batch` (ya existe y comprime).
- **Review**: se funde con la hoja de vista rápida (es la misma acción: recorrer una cola y clasificar). En «Más» queda como «Review · cola de clasificación» y abre la hoja sobre la cola elegida.
- **Sectores**: lista de una línea (grupo · miniatura · RS del grupo · nº en E2), sin tiles de «Market score». Los selectores Fuente/País/Agrupar van a una hoja de filtros como la del screener.
- **Mercado**: una línea de régimen y la lista de índices (US, Europa, HK primero, según el foco). La tabla de liderazgo se carga al desplegar (1,6 MB hoy, M17), y hay que comprimirla.
- **IPO radar**: conservar la barra inferior (hoy se oculta, `ipo-radar.css:54`); formularios a 44 px de alto.
- **Estados**: *carga* = esqueleto con la geometría exacta de la fila (sin saltos); *vacío* = curva plana + causa con cifras + dos salidas (mismo contenedor que escritorio, paso 8); *error de datos* = la línea de datos con acción; *sesión caducada* = bloqueante, igual que hoy.

### 2.10 Densidad, accesibilidad y tablet

- **Cómoda por defecto (56 px)** y compacta opcional (40 px, sin nombre). Es una preferencia, no un control visible.
- Objetivos de 44 px: las pestañas de 32 px visibles tienen un área táctil ampliada a 44 con `::after` (técnica ya válida en WCAG 2.5.8).
- Texto de 12 px o más en todo el móvil (hoy, 11 px en `--text-xs` y 9-10 px en Review y Mercado). Propuesta: en `@media (max-width:760px)`, `--text-xs: 12px` y `--text-xxs: 12px`.
- `prefers-reduced-motion`: sin animación de esqueleto (ya contemplado en el prototipo).
- **Tablet 768-1024**: rama de escritorio sin cambios, pero con la cinta virtualizada (paso 12 del rediseño de escritorio). No hace falta una tercera interfaz.

---

## 3. Prototipo

`research/movil-2026-11/prototipo/index.html` + `data.js` (generado por `scripts/extraer-datos.mjs`) + `fonts/` (Instrument Sans y DM Mono, licencia OFL incluida).

- **Pantallas** (índice a la derecha en escritorio; `?capture` lo oculta): 1 Screener · 2 Filtros (hoja) · 3 Vista rápida (hoja) · 4 Ficha · 5 Ficha horizontal (844×390) · 6 Listas · 7 Más · estados Carga, Vacío y Datos retrasados. Toca una fila para la vista rápida; en el gráfico, arrastra para mover el cursor.
- **Datos reales** de la base local: los 40 primeros valores **en el orden exacto que pinta hoy la lista móvil** (leído del DOM), con nombre, tema, RS canónico (W39), etapa, semana, estructura, huella VCP desde `contractionNDepthPct`, Máx 52s, Rend. 3M, capitalización y precio; miniaturas con el cierre semanal de `daily_bars` (52 semanas); ficha de MRNA con 252 barras diarias, SMA50/200 calculadas y las **5 semanas reales del motor RS fijado** (la línea de lectura dice «— sin dato» antes del 30-ago).
- **Ilustrativo, no real**: clasificaciones y favoritos de ejemplo; recortes por familia (copiados de la barra de escritorio medida en el paso 5); el estado vacío «Europa · 1.902 analizadas»; los conteos de vista que no se han medido van **sin cifra** (no se inventan). 937 y 51/49/2 sí son medidos.
- **Tokens**: copiados tal cual de `styles/tokens-v2.css`. Desviación tipográfica: Spline Sans Mono no está instalada en local y la regla era no usar dependencias externas, así que el prototipo usa `local("Spline Sans Mono")` y, si no está, **DM Mono** (métrica parecida). Archivo no se usa.
- **Fecha del precio**: el prototipo rotula con la fecha de la barra (16-oct) y deja comentado por qué (M4).

### Actual frente a propuesta (medido con `scripts/capturar-prototipo.mjs`; producto con `auditar.mjs`)

| Medida | Actual 390×844 | Propuesta 390×844 | Actual 360×740 | Propuesta 360×740 |
|---|---|---|---|---|
| Cromo antes de la lista | topbar 50 + sub-barra 54 + 4 franjas → 1.ª fila en **y=338** | cabecera 52 + vistas 44 + filtro 40 + columnas 26 → **y=162** | y=338 | y=162 |
| Filas visibles sin desplazar | **1** | **11** | **1** | **9** |
| Objetivos <44 px en primer plano | 124 / 139 (incl. menús) | **0** | 124 | 0 |
| Textos <12 px | 670 (59 %) | **0** | 670 | 0 |
| Desborde horizontal | no | no | no | no |
| Ficha: y del gráfico | **884** (fuera) | **82** | — | — |
| Ficha horizontal: lienzo | 747×462 en 844×390 (no cabe, tapado) | 844×310 completo | — | — |

Capturas: `capturas/actual/01-screener-390.png` ↔ `capturas/propuesta/screener-390.png`; `…-filtros.png` ↔ `filtros-390.png`; `…-vista-rapida.png` ↔ `peek-390.png`; `02-ficha-AAPL-390.png` ↔ `ficha-390.png`; `02-ficha-AAPL-844x390-horizontal.png` ↔ `ficha-h-844.png`; `03-listas-390.png` ↔ `listas-390.png`; además `carga-390.png`, `vacio-390.png`, `retrasados-390.png`, `screener-360.png` y `mas-390.png`.

Las medidas de la propuesta son **del prototipo, no de producto**: las fuentes reales, los avisos y la hidratación pueden mover unos píxeles.

---

## 4. Plan de implementación

Cada paso es un ticket. Se verifica con hard-reload en instancia aislada (`:3300`/scratchpad; regla dura #2) a 390 y 360 con `scripts/auditar.mjs` (se adjuntan `firstRowY`, `filasVisibles`, `menos44`, `texto12`, KB de API y jank) y se comitea solo. Ninguno toca el motor ni el cálculo de RS, etapa o VCP.

| # | Paso | Impacto | Esfuerzo | Riesgo | Archivos | Cómo medir que no empeora |
|---|---|---|---|---|---|---|
| 1 | **RS 0 → «Sin dato»**: `Number.isFinite(Number(x))` → `x != null && Number.isFinite(Number(x))` en las 3 insignias. Test con `rsMainScore: null` | Alto (correctitud) | XS | Nulo | `app/UniversalPriceChart.jsx:221-235`, test nuevo | Captura de la vista rápida de TJGC: «Sin dato» |
| 2 | **Fecha del precio = fecha de la barra**: investigar por qué `lastDate` va una sesión por detrás de `price` en el nocturno y corregirlo en la materialización, o derivar la fecha de la última barra. Test de contrato `price == close(lastDate)` | Alto (correctitud, también en escritorio) | S-M | Medio (toca el nocturno; coordinar con quien lleve `scan-universe`) | `scripts/scan-universe.mjs`, `lib/materializedScanner*` (por confirmar) | SELECT de muestra: 0 discrepancias en 100 símbolos |
| 3 | **Una sola descarga de `/api/scans`** (deduplicar o encadenar la rehidratación RS sobre la misma respuesta) | Alto (−2,3 MB por carga) | S | Bajo-medio | `lib/scansApiCache.js`, `app/page.jsx`/`ScreenerShell.jsx` | `auditoria.json`: 1 petición `/api/scans` |
| 4 | **Barra inferior**: rejilla de 5, 56 px, etiqueta de 12 px siempre (quitar `components.css:7733-7737`), consolidar las ~15 reglas `.bottomNav` en una; «Más» con Review, Research, IPO y Datos; no ocultarla en IPO radar | Medio | S | Bajo (solo CSS + `BottomNav.jsx`) | `app/BottomNav.jsx`, `styles/components.css`, `styles/ipo-radar.css:54` | `navItems` ≥ 44 de alto y con etiqueta; `wc -l components.css` baja |
| 5 | **Proyección de lista móvil**: `/api/scans?projection=list` con ~22 campos; el detalle de fila (vista rápida) sale de los mismos campos | Alto (2,3 MB → 295 KB gzip; parse de 88 → 4 ms medidos en M-series) | M | Medio: consumidores que leen campos de la fila completa (CSV, JSON audit) → piden la proyección completa al exportar | `app/api/scans/route.js`, `lib/pgPostgrestAdapter.js`/proyecciones, `useResultViewModel.js` | KB de API y `primeraFilaMs` con CPU ×4 (`estres-movil.mjs`) |
| 6 | **Fila móvil = cinta**: nuevo `MobileTapeRow` que reutiliza las funciones puras de `lib/screenerHuntTape.jsx` (`huntTapeStageLine`, `huntTapeRsDisplay`, `huntTapeDist52w`, `huntTapeUserMark`, `huntTapeSparkWrapProps`) a 56 px; retirar `MobileResultRow`, las cuatro definiciones de `.mobileResultRow` y «Sin VCP» | **Muy alto** (1 → 11 filas) | M | Medio: tests que fijan copys móviles; `onReview` y `onFavorite` | `lib/screenerMobile.jsx`, `styles/screener.css:4433-4870`, tests | `filasVisibles ≥ 10` a 390; nodos por fila ≤ 15 |
| 7 | **Cabecera móvil**: quitar topbar de marca, sub-barra flotante, buscador a todo el ancho, «Revisar» duplicado y la cabecera «937 RESULTADOS…»; poner la cabecera de 52 px con frescura doble (precio · RS) y la barra de filtro de 40 px | Alto | M | Medio: `recordTruthLinePaint` y E2E que buscan `.screenerTruthLine` → mantener la clase en el subtítulo | `app/layout.jsx` (topbar solo ≥761), `ScreenerShell.jsx:1078-1226`, `styles/screener.css:25-125` | `firstRowY ≤ 170` |
| 8 | **Vistas como pestañas** (mismas fuentes que `HuntCardRail`: fichas, `weeklyViews`, favoritos, plantillas) | Medio | S-M | Bajo (reutiliza `applyHuntCard`/`applyHuntQueue`) | `ScreenerShell.jsx:1088-1106`, componente nuevo `MobileViewTabs.jsx` | Cambio de vista en ≤ lo de hoy (`isHuntTransitionPending`) |
| 9 | **Filtros en hoja inferior**: `ScreenerSidebar` móvil → `MobileFilterSheet` con mercados, `FilterArchitecturePanel` (recortes) y «Resolución»; retirar `HuntCardModeStrip` móvil y el desplegable de la lista | Alto | M | Medio: foco, scroll y bloqueo del body; `tests/resultFilterChips.test.js` | `ScreenerSidebar.jsx`, `lib/screenerMobile.jsx:126-132`, `HuntCardModeStrip.jsx` | Abrir y cerrar sin perder el scroll; 0 controles <44 |
| 10 | **Vista rápida en hoja**: `MobilePeekSheet` (reutiliza el contenido del panel de lectura de escritorio del paso 7 y `StockUserClassification`); gráfico desde `chartPreview` en memoria; sin intradía | Alto | M-L | Medio-alto: estado compartido con `QuickReviewModal`/`useQuickReviewSession` | componente nuevo, `QuickReviewModal.jsx`, `lib/chartSettings.js` (filtrar `intraday` en móvil) | Apertura en <100 ms sin red [objetivo]; 0 peticiones al abrir |
| 11 | **Ficha móvil**: gráfico arriba, lectura de cursor (P2 de la auditoría del gráfico), rangos fuera del lienzo, secciones `<details>`, noticias y similares al desplegar, horizontal con `@media (orientation:landscape)` | Muy alto | L | Alto: `StockClient.jsx` es grande; tests `fichaRetiradas`, `descriptiveStrip` | `app/stock/[symbol]/StockClient.jsx`, `UniversalPriceChart.jsx`, `styles/stock.css` | `grafico.yAbs ≤ 100`; peticiones de la ficha −2 |
| 12 | **Virtualizar** la lista móvil (y la cinta de tablet/escritorio, paso 12 del rediseño) + `useScreenerMobileViewport` con `matchMedia` síncrono o CSS-first para evitar el primer pintado de escritorio | Medio | M | Medio: j/k y `scrollIntoView` con filas no montadas | `HuntTapeView.jsx`, `lib/useScreenerMobileViewport.js` | Jank con CPU ×4: 0 tareas >200 ms al desplazar; heap −30 % [objetivo] |

Pasos de segunda ola (no bloquean): Listas con la misma fila (S), Sectores y Mercado en lista de una línea (M), comprimir y diferir `/api/market-leadership` (S), `--text-xs: 12px` en móvil (S, pero hay que revisar toda la UI), retirar los scores compuestos de `PreviewCard search` (S).

**Orden sugerido**: 1 → 2 → 3 → 4 (correctitud y peso; ninguno cambia el diseño) → 6 → 7 (aquí se nota el cambio: 11 filas) → 8 → 9 → 10 → 5 → 11 → 12.

**Presupuesto anti-ruido** (cada PR lo cumple o justifica): ningún dato nuevo en la fila; nada nuevo en la cabecera salvo la fecha del RS; `wc -l styles/screener.css styles/components.css` **baja** (hoy 27.524 líneas en `styles/`); ninguna petición nueva al cargar el screener ni al abrir la vista rápida.

---

## 5. Decisiones que debes tomar

1. **Barra inferior**: ¿Sectores en la barra y Research en «Más» (propuesta), o al revés?
2. **4.ª columna de la fila**: ¿Máx 52s fijo (propuesta), elegible entre Máx 52s / VCP / Rend. 3M, o VCP fijo?
3. **Densidad por defecto**: cómoda de 56 px con nombre (11 filas) o compacta de 40 px sin nombre (~15 filas). El nombre importa en HK y Europa (códigos numéricos).
4. **Vista rápida frente a ficha al tocar una fila**: ¿hoja (propuesta) o ir directo a la ficha?
5. **Gesto de deslizar en la vista rápida** para pasar al siguiente: ¿sí o solo botones?
6. **Review**: ¿se funde con la vista rápida (propuesta) o se mantiene como página aparte en «Más»?
7. **Fecha del precio (M4)**: ¿se corrige en la materialización del nocturno (correcto, toca el pipeline) o se deriva en la UI de la última barra (rápido, parche)?

---

## 6. Verificado, supuesto y no medido

- **VERIFICADO**: todas las cifras de §1.2 y los hallazgos M1-M3, M4 (4 símbolos), M5-M19 y M22; el peso de la proyección mínima (cálculo sobre la respuesta real de `/api/scans`); las medidas del prototipo de §3.
- **CÓDIGO**: M3 (causa), M20 (scores en la búsqueda) y M21 (primer pintado de escritorio en móvil).
- **SUPUESTO**: que la doble descarga de `/api/scans` (M6) no sea solo efecto de StrictMode (los tamaños distintos apuntan a dos peticiones diferentes, pero no está aislado); que no haya datos intradía (M12); los tiempos y el heap en producción; la ganancia de rendimiento de los pasos 6 y 12; la densidad compacta (~15 filas).
- **NO MEDIDO**: Safari/iOS real y dispositivos reales (solo emulación de Chrome); `next build` de producción (no se tocó `.next`); el buscador móvil abierto; el menú «⋯»; las hojas de mercados y plantillas; VoiceOver/TalkBack; contraste AA en el prototipo; Mercado a 390 (no terminó de cargar en 5 s; se usa 360); la causa raíz de M4 en el pipeline.

### Reproducir

```
cd <scratchpad>   # fuera del repo
node <repo>/research/movil-2026-11/scripts/auditar.mjs <repo> <repo>/research/movil-2026-11/capturas/actual 390x844,360x740,768x1024 all
node <repo>/research/movil-2026-11/scripts/estres-movil.mjs <repo> <repo>/research/movil-2026-11/capturas/actual
# datos del prototipo (scans.json = GET /api/scans?includeRows=1&limit=1&rowsLimit=6000&anchor=nightly-us&hydrateRs=1 con cookie de sesión)
PGPASSWORD=… node <repo>/research/movil-2026-11/scripts/extraer-datos.mjs scans.json <repo>/research/movil-2026-11/capturas/actual/orden-lista.json <repo>/research/movil-2026-11/prototipo/data.js
node <repo>/research/movil-2026-11/scripts/capturar-prototipo.mjs <repo> <repo>/research/movil-2026-11/capturas/propuesta
```
