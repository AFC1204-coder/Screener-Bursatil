# El cuadro sobre el gráfico y la limpieza de bloques — 2026-08-21

Base: `codex/statsedge-ui-polish` @ `0184bfa` **más el árbol de trabajo sin
comitear** (el arreglo del hueco bajo el gráfico —`grid-template-rows` de
`.universalChart`— y su documentación están en el working tree, no en HEAD).
Solo análisis; ningún cambio de código, ningún commit.

## Método y entorno

- Lectura completa de `docs/principios-producto.md`, `DescriptiveStrip.jsx`,
  `docs/analisis-ficha-2026-08-15.md`, `StockClient.jsx` (2.343 líneas),
  `UniversalPriceChart.jsx`, `useChartController.js`, `chartNativeAdapter.js`,
  `lib/chartViewportModel.js`, `lib/chartSeriesModel.js`, `lib/chartSettings.js`.
- Instancia aislada: árbol de trabajo copiado con rsync al scratchpad,
  `node_modules` enlazado, servidor propio en **:3500** (PID gestionado por el
  panel, cerrado por PID exacto al terminar). El token de acceso se retiró del
  `.env.local` de la copia para usar el modo previsto por el producto
  (`authOpenForLocalDev`, `lib/authSession.js:50`): sin token en dev el
  perímetro queda abierto — no se tecleó ninguna credencial.
- **Medición masiva**: script Node (`medicion-cuadro.mjs`, en scratchpad) que
  reproduce el mapeo precio→píxel del chart sobre **420 símbolos** del ranking
  semanal vigente (muestreo determinista, 1 de cada ~11 del listado de 4.868;
  snapshot `2026-08-09`) con barras reales de `daily_bars` (solo GETs).
- **Escrituras en Supabase — transparencia**: yo no escribí nada, pero
  detecté que **el propio servidor reescribe la caché de barras al servir una
  ficha**: `fetchChartForBrief` pide `range=MAX` y la caché (400 barras) nunca
  cubre ese rango, así que cada apertura va a Yahoo y pasa por
  `writeDailyBarsCache` (`app/api/company-brief/route.js:1256-1265`,
  verificado con `updated_at` de hoy en las filas de WDC y ARRY tras mis dos
  cargas del brief). Son upserts idempotentes de las mismas barras diarias
  (mismo dato que dejó el nocturno; cambia solo `updated_at`). En cuanto lo
  confirmé dejé de abrir fichas. Hallazgo lateral: **el `maxAgeDays: 5` del
  read no evita ningún write porque el brief pide MAX** — cada visita de ficha
  refresca la caché entera del símbolo.

Etiquetas: **[REPRODUCIDO]** visto en navegador con pestaña visible;
**[MEDIDO]** calculado por el script sobre barras reales de `daily_bars`;
**[CÓDIGO]** afirmación con cita; **[SUPABASE]** consulta de solo lectura;
**[INFERIDO]** derivado, no trazado en runtime.

Limitación del entorno que afecta a este análisis: el panel embebido deja de
componer oculto (documentado el 15). El chart montó calibrado a 280 px de
ancho y su ResizeObserver no corre sin repintado, así que **la verificación
visual en vivo cubre el eje vertical del mapeo** (ver A1.3) **pero no pude
capturar el lienzo a ancho completo**. El eje horizontal del modelo usa la
geometría real del DOM (los `<td>` de lightweight-charts sí miden 1108 px
tras el resize) y queda como cálculo, no como captura.

---

# PARTE A — El cuadro dentro del gráfico

## A0. Qué vive ya en esa zona (y un matiz que importa)

**La esquina superior izquierda del LIENZO está vacía.** El ticker, el precio
y la variación que el dueño recuerda ahí no están dentro del área de dibujo:
son la fila `universalChartHead` — un hermano del canvas dentro del panel
(`UniversalPriceChart.jsx:82-89`; `.universalChart` es un grid de filas
`auto auto auto`, `styles/components.css:1091`). Una captura del panel entero
los lleva; una captura recortada al lienzo (lo natural al compartir "el
gráfico"), no.

El matiz [CÓDIGO + REPRODUCIDO]: el porcentaje de esa cabecera **no es la
variación diaria** — es el cambio de la primera a la última barra de toda la
serie servida (`useChartController.js:124`). En WDC la ficha muestra
«469,05 USD +6,96 (+1,5%)» en N0 y «WDC 469,05 474.2%» en la cabecera del
chart: mismo precio, dos porcentajes, y el segundo (dos años de serie, no el
rango visible ni el día) no es el que un lector de la captura espera. Si el
cuadro entra, este dato queda al lado y la incoherencia se hace más visible;
hay que resolverla a la vez (mostrar la variación del día, o rotular el
periodo).

Dentro del lienzo hoy solo puede aparecer tinta de series: velas, MA50,
MA200, volumen (banda inferior del 18% del pane, `chartNativeAdapter.js:283`),
overlays VCP si se activan, y la leyenda RS solo en intradía. La esquina no
tiene ningún elemento fijo. **Hay sitio; la pregunta es cuándo lo pisa el
precio.**

## A1. La medición

### A1.1 Geometría real de la vista por defecto (1A · D · velas + MAs + volumen + pane RS)

Medida en el DOM de la ficha de WDC a viewport 1280×720 [REPRODUCIDO]:

| Pieza | Medida |
|---|---|
| Canvas del chart | 1187 × 602 px |
| Pane de precio (área de dibujo) | **1108 × 457 px** (+ eje de precio 78 px a la derecha) |
| Pane RS | 1108 × 114 px (reparto 4:1, `chartNativeAdapter.js:47-48`) |
| Eje temporal | 28 px |
| Margen superior de escala | 8% → el high máximo de la ventana se pinta a **36,6 px** del techo (`chartViewportModel.js:266`) |
| Banda útil de precio | 67% → 306 px (el 25% inferior lo ocupan margen y volumen) |
| Ancho por barra (252 barras) | **4,40 px** |

### A1.2 Modelo y escenarios

El script reproduce el pipeline de dibujo: ventana = últimas 252 barras
(`CHART_RANGES` "1A"), SMAs idénticas a `chartSeriesModel.movingAverage`
sobre toda la serie disponible (hasta 460 barras de `daily_bars`), autoescala
del pane con velas + MAs visibles, y los márgenes de arriba. «Invasión» =
alguna vela (o línea de MA) del tramo cubierto por el cuadro se pintaría
dentro de su rectángulo (incluido un margen de 12 px).

Tamaños ensayados (contenido en A2):

| Cuadro | Tamaño | Barras que cubre | Tiempo que cubre |
|---|---|---|---|
| S | 240×56 px | 58 | ~2,8 meses |
| M | 320×76 px | 76 | ~3,6 meses |
| L | 360×100 px | 85 | ~4 meses |

### A1.3 Validación del mapeo [REPRODUCIDO]

Antes de fiarme del modelo lo contrasté en vivo sobre WDC con un overlay de
guías inyectado en el navegador (instrumentación de medición, no existe en el
producto): la línea al 8% del pane **toca exactamente el pico de la ventana**
y la del 75% **toca el mínimo** — el mapeo vertical del modelo es el del
chart real. Y la ventana que pinta la ficha es la misma que mide el script:
para WDC y ARRY, `chartBars` del brief y `daily_bars` dan ventanas de 252
barras idénticas en fechas y extremos (WDC: 2025-08-20 → 2026-08-20, máx
799,87, mín 72,94) [MEDIDO + REPRODUCIDO vía `/api/company-brief`].

Lo no validado visualmente: el reparto horizontal (px/barra) a ancho
completo, por la limitación del panel descrita en Método. Es aritmética
directa (1108/252) sobre una medida real del DOM.

### A1.4 Resultados [MEDIDO — 420 símbolos, 0 descartados]

**Invasión global** (con pane RS, el caso por defecto):

| Cuadro | Solo velas | Velas o MAs |
|---|---|---|
| S 240×56 | 29,0% | 38,3% |
| M 320×76 | **41,2%** | 47,9% |
| L 360×100 | 47,1% | 51,4% |

**Por forma del valor** (clasificación derivada de las barras: cierre vs
MA200 y pendiente de la MA200; cuadro M, solo velas):

| Forma | Peso en la muestra | Invasión M |
|---|---|---|
| Alcista (≈ etapa 2) | 48,1% | **16,3%** |
| Bajista (≈ etapa 4) | 34,5% | **71,0%** |
| Lateral bajo | 15,2% | 48,4% |
| Lateral alto | 2,1% (n=9) | 66,7% |

**El recorte que importa**: en los valores con **RS ≥ 80** — los que un
operador de tendencia abre de verdad — la invasión con el cuadro M es del
**5,7%** (4 de 70).

Variante sin pane RS (símbolo fuera del ranking; el pane de precio crece a
573 px): la invasión global baja a 25,8% / 32,0% / 42,2% (S/M/L, velas).

Casos con nombre, ligados a la verificación en vivo:

- **WDC** (alcista, RS 98): sin invasión con S, M ni L — en la captura el
  cuadro M queda sobre aire; las velas de agosto-abril pasan por el tercio
  inferior. La observación del dueño, confirmada.
- **ARRY** (bajista, RS 13): sin invasión con S y M, **invade con L** — su
  rebote inicial entra en un cuadro de 100 px de alto. El tamaño es la
  variable de control.
- Alcistas que SÍ invaden (pico temprano y retroceso): A, AMPL, ATAI, BXC.
  Laterales altos que invaden: MSFT, SSNC, BTG.

### A1.5 Lectura

La intuición del dueño es correcta **para el valor que este producto
persigue**: en tendencia alcista la esquina está libre en ~5 de cada 6 casos,
y en los líderes (RS≥80) en ~19 de cada 20. Pero no generaliza: **en el
universo completo el cuadro M pisa tinta en 4 de cada 10 valores**, y en un
valor en caída lo hace en 7 de cada 10 — el máximo de la ventana de un
bajista vive arriba a la izquierda por construcción. El cuadro es viable
exactamente en los términos que el dueño propuso: **visible por defecto,
plegable cuando estorba** — y estorbará sobre todo en fichas de etapa 4,
donde la captura compartible importa menos.

Sesgos del modelo, todos hacia el lado conservador: viewport 1280 px (en
pantallas más anchas cada barra ocupa más y el cuadro cubre menos meses);
warm-up parcial de la MA200 con 460 barras (algo menos de tinta de MA en el
borde izquierdo que en el chart real, que recibe ~520); y la invasión de MAs
pondera igual una línea de contexto que una vela — tapar la MA200 es mucho
menos grave que tapar precio.

## A2. Qué cabe en el cuadro y qué no

Recomiendo el **M (≈320×76, tres líneas)**. Contenido — solo lo que la
captura del lienzo necesita y hoy no lleva:

```
Western Digital Corporation · NASDAQGS
Etapa 2 · semana 60      RS 98
Máx 52s −41,4% · Cap. 169,1B
```

- **Línea 1 — identidad**: nombre completo y exchange. El ticker ya está en
  la cabecera del chart (y en la esquina puede repetirse en corto si la
  captura se recorta al lienzo puro; el coste es una línea más).
- **Línea 2 — la clasificación**: etapa con semana, y el RS del universo. Es
  la esencia de la ficha ("Etapa 2 confirmada", "RS 87" — el vocabulario del
  principio 1).
- **Línea 3 (opcional, es lo que separa M de S)**: distancia al máximo de 52
  semanas y capitalización — los dos números de contexto que el principio 7
  puso en la tabla y que la franja ya muestra (el primero) o no muestra (el
  segundo, hoy solo en N2).

**No caben — y no deben entrar**: el resumen de negocio, sector·industria,
las cinco celdas de estructura, el crecimiento trimestral (6 trimestres × 2
filas), el pie de fuentes con la marca, los deltas del RS y su n. Todo eso es
la franja. Meterlo en la esquina es reconstruir el cuadro denso de
MarketSmith — la ineficiencia que el doc de principios dice explotar, no
imitar. El cuadro es un sello, no una ficha.

Dos reglas de dibujo para no ensuciar la captura: fondo semitransparente
sobre el token de pizarra (que las velas que alguna vez pasen por debajo se
intuyan) y tipografía del sistema de la franja (11-12 px). Nada de color
semántico: describe, no juzga.

## A3. El pliegue (la solución del dueño) — los dos cabos que pedía atar

El botón de minimizar resuelve el punto 3 sin heurísticas: visible por
defecto, el usuario lo pliega en el valor concreto donde tapa. Los dos
detalles:

**1. Memoria del estado.** El pliegue debe ser **efímero: estado de React,
por visita de símbolo**. Al navegar a otra ficha (o volver a la misma), el
cuadro se muestra de nuevo. Ni localStorage ni preferencia global:

- El objetivo es la captura sin componer nada; un pliegue que persiste
  convierte "lo oculté una vez en ARRY" en "todas mis capturas futuras salen
  sin identidad" — exactamente lo que el dueño señaló.
- Motivo técnico adicional [del análisis del 15, C9]: la persistencia local
  del producto ya opera al borde de la cuota (sesiones de 30+ MB,
  `safeWrite` que falla en silencio). No añadirle una clave más para un
  estado que ni siquiera queremos recordar.
- Dentro de la misma ficha sí se conserva (cambiar de rango o de benchmark no
  lo reabre): plegarlo dos veces en la misma pantalla sería irritante.

**2. El botón fuera de la captura.** Que el control viva **en la botonera de
navegación del chart** (`universalChartNavGroup`, junto a zoom/pan/dibujo),
no dentro del lienzo. La botonera está en la fila de cabecera, fuera del área
de dibujo: una captura del lienzo — y también la captura "gráfico + franja"
que es la ficha compartible — no la incluye nunca. Como affordance
secundaria, clic sobre el propio cuadro = plegar (sin pintar ningún icono
dentro; un aspa o un chevron dentro del cuadro saldría en todas las
capturas, que es lo que se quiere evitar). Plegado, el cuadro desaparece por
completo del lienzo: sin asa ni resto — el asa también mancharía.

## A4. Convivencia con la franja

**El cuadro no sustituye a la franja; la franja guarda lo que no cabe.** Son
dos capturas distintas: el lienzo solo (rápida, para un comentario en un
grupo) lleva el sello; gráfico + franja (la ficha compartible del MVP) lleva
el análisis entero con marca y fuentes.

El único solape real que crea el cuadro es con la **banda de identidad de la
franja** (nombre + ticker·exchange, `DescriptiveStrip.jsx:128-141`): en la
captura compuesta el nombre saldría dos veces (esquina y franja). Propuesta:
cuando el cuadro entre, la banda 1 de la franja **cede el nombre grande** y
conserva lo que el cuadro no lleva — el resumen de negocio en una línea,
sector · industria y el rango de sector (hoy ausente con motivo). La franja
pierde altura, el par captura-compuesta no repite nada, y si el usuario
pliega el cuadro la identidad completa sigue en N0 (que no se captura pero sí
se ve). La etapa y el RS quedan en ambos por diseño: en el cuadro como sello
(dígito + número), en la franja con su anatomía (rail 1-4, semana, delta,
n=…, fecha si es viejo) — sello frente a desglose, no repetición.

Alternativa más conservadora: no tocar la franja hasta ver el cuadro en uso.
El coste es solo la doble mención del nombre en la captura compuesta.

---

# PARTE B — Los bloques de la ficha: qué sobra con el cuadro y la franja

## B5. Inventario completo [REPRODUCIDO sobre WDC por URL directa]

Por URL directa se renderizan 11 bloques; 2 más son condicionales (mesa de
observación solo con origin del screener; Pulso X solo con integración). La
franja es el bloque nº 12, dentro del panel del gráfico.

| # | Bloque (código) | Qué muestra hoy (WDC) |
|---|---|---|
| 1 | **N0 · Cabecera** (`N0VerdictBlock`) | Logo, kicker «TECHNOLOGY · NASDAQGS», ticker, nombre, «Cierre del gráfico 469,05 USD +6,96 (+1,5%)», chip curva «ETAPA 2», franja de calidad (Cierre 20 ago · Cobertura alta · RS 9 ago · n=4868), «SETUP 1/5 condiciones · falta: …», botones Screener / Web oficial (el bug del 15 está arreglado: se renderizan) |
| 2 | **Mesa de observación** (`StockDecisionDesk`, solo con origin) | Estado del motor, foco, brief, evidencias, coherencia gráfico, presets de vista, clasificación del usuario, historial |
| 3 | **Panel del gráfico** (controles + `UniversalPriceChart` + `DescriptiveStrip`) | Benchmark, VCP, preferencias; cabecera del chart «WDC 469,05 474.2% · RS global 98 · SIN VALIDAR Estructura sin dato»; lienzo (precio+volumen, pane RS); **franja**: identidad+resumen, etapa (rail, semana 60), RS (98, desde 99, n=4868), estructura (Máx 52s −41,4% · Sobre mín +543% · Media 30s +10,2% ascendente · Base – · Volumen 10d/50d −12% sin secado), crecimiento 6T (BPA/Ventas YoY), pie StatsEdge · fuentes · fecha |
| 4 | **N1 · Lectura técnica** (`N1TechTable`) | 6 filas: RS 98 · RS QUALITY 74 · ETAPA Etapa 2 · MA50 −14,6% · MA200 +31,5% · MÁX 52S −41,4% |
| 5 | **N2 · Contexto** (`N2ContextBlock`) | Narrativa («RIESGO — base reciente no confirmada») + Fundamentales operativos (VENTAS YOY +43,8% · EPS YOY +374,2% · CAP. 169,1B) |
| 6 | **N3 · Auditoría** (`N3AuditBlock`, 4 cajones colapsados) | Desglose del score (= desglose del patrón VCP), Bloque empresa, Calidad de datos, Metodología y gates |
| 7 | **Acciones similares** (`SimilarStocks`) | Peers clicables — sigue listando 1810.HK (Xiaomi), fuera de cobertura |
| 8 | **Contexto comparativo** (`ComparativeContext`) | Tabla de 10 referencias con Estructura/Contracciones/Rango 65s/Vol. seco/RS grupo — cadenas de «No validado» |
| 9 | **Estado del volumen** (`StockVolumePanel`) | Reparto 1,25× · Volumen seco 0,88× · Impulso −4,14% · Última sesión – |
| 10 | **Fuerza relativa** (`RelativeStrengthPanel`) | 12+ métricas en 4 grupos: RS global 98, RS país 97, Grupo 86, RS bench 69P, 3M/6M/12M vs benchmark, RS quality, riesgo técnico, volatilidad, drawdown, Perf 3M, Dist. 52W |
| 11 | **Fundamentales históricos** (`FundamentalsPanel`) | Estados completos por trimestre/año (Resumen/Resultados/Balance/Cash flow) + holders compactos |
| 12 | **Noticias** (`NewsSection`) | Titulares con sesgo heurístico |
| 13 | **Pulso X** (`SocialPulseSection`, condicional) | Sentimiento de cashtag (ausente sin integración) |

## B6. Solapamientos con la franja y con el cuadro propuesto

Marcado por dato (F = franja, C = cuadro propuesto, N0 = cabecera):

| Dato | Apariciones hoy | Con cuadro serían |
|---|---|---|
| **RS del universo** | franja de calidad N0 · franja descriptiva · badge del chart · N1 · panel RS = **5** | 6 |
| **Etapa** | chip N0 · franja (rail+semana) · N1 · gate de N3 = 4 | 5 |
| **Dist. máx 52s** | franja · N1 · panel RS («Dist. 52W high») = 3 | 4 con cuadro M |
| **Volumen seco 10d/50d** | franja («−12% · sin secado») · Estado del volumen («0,88×») = 2, **en dos formatos distintos para el mismo dato** | 2 |
| **Ventas/BPA YoY** | franja (6 trimestres) · N2 («operativos», último dato) · Fundamentales históricos (matriz completa) = 3 | 3 |
| **Nombre + exchange** | N0 · franja | + cuadro = 3 |
| **Precio + variación** | N0 (diaria) · cabecera del chart (**de toda la serie**, `useChartController.js:124`) | 2, incoherentes entre sí |

Y una **contradicción nueva que la franja dejó al descubierto**
[REPRODUCIDO]: la franja declara RS de sector y país **ausentes con motivo**
(`lib/rsCanonical.js` no clasifica por sector; universo solo-US —
`DescriptiveStrip.jsx` cabecera), mientras el panel Fuerza relativa, en la
misma pantalla, pinta «RS PAÍS 97 · GRUPO 86» — percentiles del lote del
escaneo (`rsCountryPct`/`rsSectorPct`, `company-brief/route.js:961-962`,
pintados en `StockClient.jsx:679-680`). Dos superficies de la misma ficha
afirman a la vez que ese dato no existe y que vale 97. La del principio 3 es
la franja; el panel es el que sobra.

## B7. Veredictos: retirar, fusionar, conservar

| Bloque | Veredicto | Razón |
|---|---|---|
| N0 Cabecera | **Conservar, adelgazado** | Es la identidad de la *página* (no de la captura). Con la franja debajo del gráfico, sobran el chip-curva de etapa (la franja tiene el rail con semana, más rico) y la fila «SETUP 1/5 · falta: …» (A9 del 15, sigue pendiente: lista de negaciones). Quedan: identidad, precio del día, franja de calidad, enlaces. |
| Mesa de observación | **Fuera de este encargo; sin cambio por el cuadro** | Sus problemas (veredicto resucitado, clasificación solo con origin) ya tienen plan (B1/B2 del 15). El cuadro no la toca. |
| Panel del gráfico + franja | **Conservar — es el núcleo** | Con el cuadro dentro del lienzo y la franja al pie, este panel ES la ficha compartible. Pendientes propios: el % de la cabecera del chart (A0) y la banda de identidad de la franja si el cuadro entra (A4). |
| **N1 Lectura técnica** | **Retirar como bloque; los dos datos únicos, a la franja** | De sus 6 filas, RS, ETAPA y MÁX 52S ya están en la franja (a 300 px). Solo MA50 (−14,6%) y MA200 (+31,5%) son únicos — la franja da la media de 30 semanas, que es otra medida. Dos filas no sostienen una sección: caben como tercera y cuarta celda de la banda de estructura de la franja (o en la tabla técnica única de D.2 del 15, si se opta por esa vía). RS QUALITY es un score compuesto propio: a N3, con lo auditable. |
| **N2 Contexto** | **Retirar** | La narrativa por URL es la razón interna del detector disfrazada de riesgo (ya señalado el 15). Los «fundamentales operativos» son el último punto de la serie que la franja ya muestra con 6 trimestres. El único dato único es **Cap.** — que es justo la línea 3 del cuadro propuesto (o una celda más de estructura en la franja). |
| N3 Auditoría | **Conservar — es auditoría, no repetición** (ver B8) | Colapsado por defecto; correcciones A7/A8 del 15 siguen pendientes (el cajón sigue titulado «Desglose del score» siendo el desglose del patrón, y el gate «Plan» sigue evaluando un panel retirado). |
| Similares | **Conservar** | No solapa con nada. Pendiente ajeno al cuadro: filtro de cobertura (Xiaomi 1810.HK sigue clicable hoy). |
| Contexto comparativo | **Retirar hasta que el detector valide** | Mantiene la tabla de negaciones («No validado» en cadena) señalada el 14 y el 15. No es solape del cuadro: es que no informa. |
| **Estado del volumen** | **Fusionar** | «Volumen seco 0,88×» y la celda «Volumen 10d/50d −12%» de la franja son el mismo cociente en dos formatos. Reparto up/down e impulso son únicos: dos celdas más para la banda de estructura de la franja (o la tabla técnica única), y el panel desaparece. |
| **Fuerza relativa** | **Retirar como panel** | El RS global es su 5ª aparición; país/grupo contradicen a la franja (B6); Dist. 52W repetida. Lo único con valor propio: la serie vs benchmark (3M/6M/12M) y el propio selector de benchmark — que ya viven mejor en el gráfico (línea RS + comparar vs). RS quality / riesgo técnico / volatilidad / drawdown son scores y medidas compuestas: a N3. |
| Fundamentales históricos | **Conservar** | Profundidad, no repetición: la franja da el resumen (6T YoY); esto da los estados completos. La pareja franja→matriz es la jerarquía correcta. |
| Noticias | **Conservar** | Único, correcto tras la limpieza. |
| Pulso X | **Conservar** | Ya se auto-suprime sin integración. |

Resultado neto: de 11 bloques siempre visibles se pasa a **7** (cabecera
adelgazada, gráfico+franja+cuadro, N3, similares, fundamentales históricos,
noticias, y el hueco de la mesa cuando hay origin), sin perder un solo dato:
todo lo retirado o está ya en la franja/cuadro o se muda a ellos (MA50,
MA200, Cap., reparto e impulso de volumen) o baja a N3 (scores compuestos).

## B8. Repetición no es lo mismo que auditoría

La regla que separa lo que sobra de lo que parece sobrar:

- **Repetición** (retirar): el mismo dato, mismo nivel de detalle, en otra
  superficie de lectura. El RS 98 en cinco sitios no da al usuario nada que
  no tuviera; le obliga a preguntarse si son cinco datos distintos.
- **Auditoría** (conservar): el desglose que permite *comprobar* un dato que
  arriba se muestra resumido. «Calidad de datos» de N3 repite la franja de
  calidad de N0 — con la fuente y el estado de cada dato: existe para
  verificar, y está colapsado, que es su sitio. El desglose del patrón VCP
  repite el «SIN VALIDAR» del badge — con los siete términos medidos: es la
  prueba del badge. El Bloque empresa repite el resumen de la franja — con
  empleados, IPO y descripción completa: es la profundidad. Y cuando el
  desglose del score compuesto entre en la ficha (hoy no está — B8 del 15),
  será auditoría del número que ordena las listas, no repetición.
- La prueba práctica: **un bloque de auditoría puede estar colapsado sin que
  la ficha pierda lectura; uno repetido, si se colapsa, no se echa de
  menos.** N3 entero pasa la prueba como auditoría; N1, N2, el panel RS y el
  de volumen no la pasan.

---

# Recomendación (orden de ejecución)

1. **Cuadro M dentro del lienzo** (esquina sup. izq., 3 líneas: nombre ·
   etapa+semana | RS · máx52s+cap), visible por defecto, pliegue efímero por
   símbolo, toggle en la botonera del chart y clic-para-plegar en el propio
   cuadro. Semitransparente sobre pizarra. Junto con: arreglar el % de la
   cabecera del chart (A0).
2. **Franja**: banda 1 cede el nombre al cuadro (conserva resumen +
   sector·industria); la banda de estructura absorbe MA50, MA200, Cap.,
   reparto de volumen e impulso.
3. **Retiradas**: N1, N2, panel Fuerza relativa, Estado del volumen,
   Contexto comparativo. Scores compuestos (RS quality, riesgo técnico) a N3.
4. Lo ya recomendado el 15 que este cambio hace más urgente: renombrar el
   cajón «Desglose del score», retirar el gate «Plan», y el filtro de
   cobertura en similares.

---

# CONFIANZA

| Hallazgo | Confianza | Base |
|---|---|---|
| La esquina del lienzo está vacía; ticker/precio/% viven fuera del área de dibujo | Alta | Código (`UniversalPriceChart.jsx:82-89`, CSS grid) + captura |
| Geometría del pane (1108×457, 8%/25%, 4:1, 78 px de eje) | Alta | Medida en DOM real + código citado |
| Mapeo vertical del modelo = chart real | Alta | Overlay de guías sobre WDC: pico al 8%, mínimo al 75% [REPRODUCIDO] |
| Ventana del modelo = ventana de la ficha | Alta (WDC, ARRY) | Brief vs `daily_bars`: fechas y extremos idénticos |
| Cifras de invasión (29-47% global; 16% alcistas; 71% bajistas; 5,7% RS≥80) | Media-alta | 420 símbolos reales; el eje horizontal del modelo es cálculo, no captura (limitación del panel); sesgos conservadores documentados en A1.5 |
| % de la cabecera del chart = cambio de toda la serie | Alta | `useChartController.js:124` + WDC 474,2% vs +1,5% diario |
| Contradicción franja (país/sector ausentes) vs panel RS (97/86) | Alta | Reproducido en WDC + mecanismo citado |
| Volumen seco duplicado en dos formatos (0,88× vs −12%) | Alta | Reproducido (mismo cociente: 0,88× ≡ −12%) |
| Inventario de 11+2 bloques y sus contenidos | Alta | DOM real de WDC + código |
| El brief reescribe la caché en cada apertura (range MAX > caché) | Alta | `updated_at` de hoy tras mis cargas + código citado |
| Veredictos de la Parte B | — | Diseño argumentado sobre los principios; discutible por diseño |
| Clasificación de forma (alcista/bajista/lateral) | Media | Derivada de barras (cierre vs MA200 y pendiente), no del clasificador Weinstein del producto; suficiente para segmentar, no idéntica a la etapa |

# LO QUE NO HE VERIFICADO

- **El lienzo a ancho completo en captura**: el panel embebido no compone
  oculto y el ResizeObserver del chart no corrió; el reparto horizontal
  (4,40 px/barra) es cálculo sobre medidas reales del DOM, validado solo
  indirectamente. La demostración visual definitiva del cuadro sobre un
  bajista queda pendiente de un navegador con ventana real.
- **Móvil**: toda la medición es de escritorio 1280 px. En 375 px el pane
  baja a ~330-410 px de alto y el cuadro M cubriría media pantalla — el
  comportamiento del cuadro en móvil (¿existe siquiera?) no está analizado.
- **La muestra es el ranking US vigente** (snapshot 2026-08-09, 4.868
  símbolos): los internacionales del nocturno del 20-ago (.ST/.TO/.TW…) no
  entran, y no medí símbolos fuera del ranking (típicamente sin pane RS; la
  variante 573 px los aproxima).
- **El comportamiento del pliegue con capturas nativas del SO** (si el hover
  del cuadro aparece en la captura de un tercero): razonado, no probado.
- **La mesa de observación con origin**: no navegué desde el screener en esta
  sesión (habría disparado más escrituras de caché); lo dicho sobre ella
  viene del código y del análisis del 15.
- **Los fundamentales/noticias/similares en profundidad**: inventariados por
  DOM, no re-auditados campo a campo.
- **Cuántas barras sirve el brief en frío vs caché** (520 vs 400): el efecto
  sobre el warm-up de la MA200 del borde izquierdo está estimado, no medido
  barra a barra.
