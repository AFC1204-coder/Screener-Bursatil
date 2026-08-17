# Diseño — indicadores de volumen y divergencia para juzgar el mercado

Fecha: 2026-08-17. Base: `codex/statsedge-ui-polish` @ `7b83d26`.
Continúa `docs/analisis-salud-mercado-2026-08-16.md` (Parte C) y se apoya en
`docs/principios-producto.md`.

Solo diseño y diagnóstico: ningún cambio de código, ninguna escritura en
Supabase, ningún escaneo ejecutado, ningún commit.

## Método

- **Fuentes primarias**: los PDF de `research/books/` (Weinstein, Minervini),
  extraídos con un lector propio en el scratchpad. El PDF de O'Neil no tiene
  capa de texto recuperable (`bloques de texto: 1` sobre 2.371 páginas), así
  que la escuela de O'Neil se cita por fuentes secundarias verificables, no por
  el libro. Las reglas se recogen como definiciones operables; no se reproducen
  pasajes.
- **Fuentes secundarias**: búsquedas web, citadas por URL en cada indicador.
- **Datos de producción**: solo lectura. Las cifras del texto llevan su
  consulta. Dos vías, ambas de lectura: la herramienta `supabase_query` y
  `GET` directo a PostgREST cuando hacía falta paginar (el MCP topa en 200
  filas y las series necesitan cientos de miles).
- **Cálculo**: scripts en el scratchpad sobre los datos descargados. Cada
  medición dice sobre qué población y qué ventana se hizo.

Etiquetas: **[DATO]** resultado de consulta a producción; **[CALC]** cálculo
propio sobre datos descargados, con el script indicado; **[CÓDIGO]** afirmación
sostenida por el código del repo; **[FUENTE]** definición tomada de la
bibliografía.

**Poblaciones que aparecen en el texto** — mezclarlas es el error más fácil:

| Nombre | Qué es | Tamaño |
|---|---|---|
| Universo del escaneo | filas del nocturno estadounidense `cea57d44-…` (17-ago) | 3.312 [DATO] |
| Universo de barras | símbolos con barra del 2026-08-14 en `daily_bars` | 5.657 [DATO] |
| Población fija | símbolos con barra en las 131 sesiones de la ventana medida | 5.328 [CALC] |

---

# PARTE A — El catálogo

## A.0 Nota de vocabulario

El criterio decidido hoy: se describe lo que se mide, sin adoptar la jerga de
ninguna escuela. En este documento y en el producto:

| Se dice | En vez de |
|---|---|
| sesión de venta con volumen | *distribution day* |
| día de confirmación | *follow-through day* |
| participación | *breadth* / amplitud (se conserva «amplitud» porque ya está en pantalla) |
| reparto del volumen | *up/down volume ratio* |
| volumen seco | *volume dry-up* |
| hueco de agotamiento | *exhaustion gap* |
| acumulación / distribución | se conservan: son castellano corriente y describen el hecho |

«Acumulación» y «distribución» se quedan porque nombran lo que se mide —
compra o venta sostenida con volumen — y no pertenecen a una escuela concreta.
«Día de distribución» en cambio sí es una etiqueta de casa: se sustituye por
«sesión de venta con volumen», que dice exactamente lo mismo sin la marca.

## A.1 Indicadores de mercado

### A.1.1 Participación sobre la media móvil

**Definición.** Porcentaje de valores de una población fija cuyo cierre está
por encima de su media móvil simple de 50 sesiones (y, en versión semanal, de
30 semanas).

**Fuente.** Weinstein construye todo el juicio de mercado sobre la posición del
índice y de los valores respecto a la media de 30 semanas [FUENTE, Weinstein,
capítulos de condición de mercado]. Es el indicador que el producto **ya
calcula**: `lib/marketBreadth.js` lo sirve como «Sobre su SMA50» y «Sobre su
media de 30 semanas» [CÓDIGO].

**Fiabilidad.** No discutida. Es una cuenta, no una predicción.

### A.1.2 Divergencia entre el índice y la participación

**Definición precisa.** Sobre una ventana de N sesiones: el índice de
referencia sube ≥ X % mientras el porcentaje de valores sobre su media cae
≥ Y puntos porcentuales. La versión clásica usa la línea acumulada de avances
menos descensos en lugar del porcentaje sobre la media.

**Fuente.** Weinstein documenta la no confirmación de la línea de avances y
descensos como el aviso mayor de techo, con casos fechados: el índice hace
nuevos máximos en agosto, septiembre, noviembre y diciembre de 1961 mientras la
línea A-D se niega a seguirlo; el techo de la línea A-D en mayo de 1965 con el
índice subiendo nueve meses más; y el techo de la línea diez meses antes del
máximo de enero de 1973 [FUENTE, Weinstein]. La formulación estándar
—índice arriba, línea A-D abajo = menos valores participan— está descrita en
[StockCharts, Advance-Decline Line](https://chartschool.stockcharts.com/table-of-contents/market-indicators/advance-decline-line)
y [Fidelity](https://www.fidelity.com/learning-center/trading-investing/advance-decline).

**Fiabilidad.** El mecanismo no se discute; el **plazo** sí. Los propios
ejemplos de Weinstein tienen adelantos de nueve y diez meses. Una divergencia
es un hecho sobre el pasado, no un calendario.

**Nota de implementación.** `participationSummary()` ya calcula una divergencia
sin umbral: `indexChangePct > 0 && participationDeltaPp < 0`
(`lib/marketBreadth.js:239`) [CÓDIGO]. Sin umbral se dispara demasiado — medido
en C.1.

### A.1.3 Nuevos máximos y nuevos mínimos

**Definición precisa.** Número de valores cuyo máximo de la sesión iguala o
supera el máximo de las últimas 52 semanas, menos el número de valores cuyo
mínimo iguala o queda por debajo del mínimo de 52 semanas. Se publica como par
(máximos, mínimos), como diferencia, o como cociente.

**Fuente.** Weinstein lo trata como indicador de primer orden y hace una
recomendación operativa explícita: **usar las cifras semanales, no las
diarias**, porque las semanales señalan movimientos más significativos y
filtran ruido. Da el ejemplo de la semana del 19 de octubre de 1987: 12 nuevos
máximos frente a 1.516 nuevos mínimos, es decir −1.504 [FUENTE, Weinstein].

**Fiabilidad.** Alta como descripción. La derivada popular de este indicador
—el *Hindenburg Omen*, que combina máximos y mínimos altos a la vez— tiene
tantos falsos positivos que no se incluye aquí; ver A.3.

### A.1.4 Reparto del volumen entre valores que suben y valores que bajan

**Definición precisa.** Suma del volumen de los valores que cierran al alza
dividida por la suma del volumen de los que cierran a la baja, en la misma
sesión. Se publica como cociente o como porcentaje del volumen total que va a
valores al alza.

**Fuente.** Minervini enumera entre las características de los grandes
ganadores «volumen fuerte en días y semanas de subida comparado con días y
semanas de bajada», y avisa de vigilar el volumen de los índices por si el
volumen de los días de bajada supera al de los de subida [FUENTE, Minervini,
*Think & Trade Like a Champion*]. Cita también lecturas del mercado en su
conjunto —9 a 1 en Nasdaq, 21 a 1 en NYSE— como marca de sesión de compra
excepcional [FUENTE, Minervini, *Trade Like a Stock Market Wizard*].

**Fiabilidad.** El nivel absoluto del cociente depende de la población y del
tramo de mercado: no hay un umbral universal. Medido en C.1: sobre 50 sesiones
el cociente **nunca baja de 1** en cuatro meses, lo que lo invalida como
semáforo aunque siga sirviendo como nivel descriptivo.

### A.1.5 Sesiones de venta con volumen

**Definición precisa** (la de la escuela de O'Neil, sin su etiqueta): sesión en
la que el índice cierra al menos un 0,2 % por debajo del cierre anterior con
volumen superior al de la sesión anterior. No hace falta que el volumen sea
superior a la media, solo al del día previo. El recuento se lleva en ventana
móvil de 25 sesiones, y una sesión sale de la cuenta cuando el índice sube un
5 % desde el cierre de aquella sesión o cuando pasan las 25 sesiones. El umbral
de aviso habitual son 4–5 sesiones en 3–4 semanas; 6 o más se asocia a
corrección. Fuentes:
[Grokipedia, Distribution day](https://grokipedia.com/page/Distribution_day),
[Bulkowski](https://thepatternsite.com/DistributionDay.html),
[Investor's Business Daily vía Yahoo Finance](https://finance.yahoo.com/news/watch-distribution-days-spot-peaks-220700524.html).

**Fiabilidad.** Discutida en dos frentes. Primero, el umbral: la asociación
«4–5 sesiones = presión» es una regla de casa sin publicación de tasa de
acierto. Segundo, y más grave para nosotros, la **fuente del volumen**: la
regla se formuló sobre el volumen compuesto del mercado (todas las acciones de
NYSE / Nasdaq), no sobre el volumen de un ETF. Medido en C.1, la diferencia no
es de matiz: con volumen de ETF el indicador se satura y deja de discriminar.

### A.1.6 Día de confirmación tras una corrección

**Definición precisa.** Tras un mínimo, la primera sesión al alza inicia un
intento de rebote (día 1). El intento sigue vivo mientras el índice no pierda
el mínimo de esa sesión. A partir del **día 4** del intento, una sesión en la
que el índice sube al menos un 1,25 % con volumen superior al del día anterior
es un día de confirmación. Fuentes:
[SmartAsset](https://smartasset.com/investing/what-is-a-follow-through-day-for-investing),
[TraderLion](https://traderlion.com/trading-strategies/follow-through-day/),
[QuantifiedStrategies](https://www.quantifiedstrategies.com/follow-through-day/).

**Fiabilidad: éste es el caso a declarar.** El umbral se ha movido con el
tiempo —del 1 % original al 1,25 %, y hay quien exige 1,5–2 % para filtrar
falsos— lo que es un indicio claro de que el criterio no es estable. Y las
tasas de fallo publicadas por quienes lo usan son altas: una sesión de venta
con volumen dentro de las cinco sesiones siguientes al día de confirmación se
asocia a fallo del 70 % de las veces, y perder el mínimo del intento se asocia
a fallo del 95 %
([Forbes, revisión del estudio](https://www.forbes.com/sites/randywatts/2025/03/07/follow-through-day-study-update/),
[TraderLion](https://traderlion.com/trading-strategies/follow-through-day/)).
Dicho de otro modo: incluso sus partidarios lo tratan como condición necesaria
y no suficiente. **Como hecho declarado —«el índice subió un 2,6 % en la sexta
sesión del intento con más volumen que la víspera»— es perfectamente
publicable. Como semáforo no.**

Minervini usa el mismo concepto a nivel de valor y sin umbral numérico: tras
una ruptura busca **varios días seguidos de continuación con volumen
creciente**, y lo llama la marca de compra institucional [FUENTE, Minervini,
*Think & Trade Like a Champion*].

### A.1.7 Impulso de participación

**Definición precisa** (Zweig): media exponencial de 10 días del cociente
avances / (avances + descensos). La señal salta cuando el indicador pasa de
menos de 0,40 a más de 0,615 en 10 sesiones o menos. Fuentes:
[TrendSpider](https://trendspider.com/learning-center/zweig-breadth-thrust/),
[StockCharts](https://articles.stockcharts.com/article/zweig-breadth-thrust-sets-up-how-to-identify-a-stampede-in-upside-participation/).

**Fiabilidad.** El propio material que lo divulga reconoce que es **muy raro**
—unas pocas veces en décadas—. Un indicador que no se dispara casi nunca no
llena una pantalla diaria; ver C.2.

### A.1.8 Oscilador de participación (McClellan)

**Definición precisa.** Media exponencial de 19 días de (avances − descensos)
menos la media exponencial de 39 días de la misma serie. El índice acumulado
(*summation*) es su suma corrida. Fuente:
[StockCharts](https://chartschool.stockcharts.com/table-of-contents/market-indicators/mcclellan-summation-index).

**Fiabilidad.** Bien definido y reproducible, pero pensado para una población
estable (los valores de una bolsa concreta). Con población variable el
acumulado deja de significar nada — ver B.1.3.

## A.2 Indicadores por valor

### A.2.1 Volumen en la ruptura

**Definición precisa, versión Weinstein.** En la semana en que el precio supera
la resistencia de la base: **o bien** un pico de volumen igual o superior a
**dos veces el volumen medio del mes anterior**, **o bien** un volumen
acumulado en las últimas 3–4 semanas igual o superior a dos veces la media de
las semanas previas, con al menos un aumento ligero en la semana de la ruptura.
Y la regla de exclusión, textual en su sentido: si no hay aumento significativo
de volumen en la ruptura, el valor se evita [FUENTE, Weinstein].

**Definición precisa, versión Minervini.** El volumen se expande en la ruptura
del punto pivote; la cifra que circula en el material divulgativo es **40–50 %
por encima de la media**
([TradingSim](https://www.tradingsim.com/blog/volatility-contraction-pattern)).
El libro describe la expansión sin fijar el porcentaje.

**Fiabilidad.** Es el punto de mayor acuerdo entre las tres escuelas. El único
matiz: Weinstein señala que la **ruptura a la baja** no necesita volumen fuerte
para ser válida —los valores «caen por su propio peso»— aunque debería haber
algún incremento [FUENTE, Weinstein]. La asimetría importa: exigir volumen a
las señales de debilidad las suprime.

### A.2.2 Volumen seco en la contracción final

**Definición precisa.** En la última y más estrecha contracción de la base, el
volumen cae **por debajo de la media de 50 sesiones**, con uno o dos días de
volumen extremadamente bajo, a menudo el más bajo de toda la base
[FUENTE, Minervini, *Trade Like a Stock Market Wizard*].

**Fiabilidad.** Alta como descripción del hecho. Su valor predictivo depende de
que la base esté bien identificada — y ahí el producto tiene un problema
declarado en `docs/diseno-contracciones-2026-08-17.md`.

### A.2.3 Acumulación y distribución del valor

**Definición precisa.** Calificación del balance entre sesiones de subida con
volumen y sesiones de bajada con volumen en las últimas **13 semanas**,
usando volumen medio de 50 sesiones, cierres y posición del cierre dentro del
rango del día. La escala pública es A (acumulación fuerte) a E (distribución
fuerte). Fuentes:
[Deepvue](https://deepvue.com/knowledge-base/accumulation-distribution-rating-and-rank/),
[Investor's Business Daily vía Yahoo Finance](https://finance.yahoo.com/news/accumulation-distribution-rating-tells-pros-234100013.html).

**Fiabilidad.** La fórmula exacta es propietaria y no está publicada: cualquier
implementación es una reconstrucción. Eso no impide calcular una medida propia
y **decir cuál es**, que es lo que exige el principio 5.

### A.2.4 Huecos de agotamiento y techo por clímax

**Definición precisa.** Tras un avance de meses, el valor acelera durante una o
dos semanas y termina con un hueco al alza con volumen fuerte. Señales
concretas y contables: (a) el mayor avance diario de todo el movimiento;
(b) huecos al alza repetidos; (c) el mayor volumen diario de todo el
movimiento. Fuentes:
[Nasdaq/Zacks sobre tipos de hueco](https://www.nasdaq.com/articles/price-gap-trading-deep-dive-common-breakaway-continuation-blow),
[DayTrading.com](https://www.daytrading.com/blow-off-top).
Minervini documenta la secuencia: mayor día de subida, seguido de un día de
bajada grande con hueco a la baja, y después huecos de agotamiento visibles
[FUENTE, Minervini].

**Fiabilidad.** Un hueco solo se clasifica como «de agotamiento» **después**, y
esa es la crítica estándar del concepto. Publicable como hecho —«abrió por
encima del máximo de ayer con 3,2 veces su volumen medio, a un 31 % de su media
de 50 sesiones»— y no como diagnóstico.

## A.3 Lo que dejo fuera, y por qué

- **Hindenburg Omen** y familia. Combina nuevos máximos y nuevos mínimos altos
  simultáneamente. Fuera: la tasa de falsos positivos es notoria incluso entre
  quienes lo divulgan, y no es un hecho descriptivo sino una predicción con
  nombre propio — choca de frente con el principio 1.
- **Índice acumulado de avances y descensos** en su forma clásica. Ver B.1.3:
  con población variable el acumulado no es interpretable, y nuestra población
  varía de 10.499 a 5.657 símbolos en doce meses [DATO].
- **On-Balance Volume y flujo de dinero de Chaikin**. Son reformulaciones del
  mismo hecho que A.1.4 y A.2.3 con más pasos intermedios; añaden vocabulario
  sin añadir información, y su valor está discutido.
- **Sentimiento y posicionamiento** (put/call, encuestas). Ninguna de las tres
  escuelas los usa como indicador primario, y el panel de titulares que ya
  existe se desautoriza a sí mismo (analizado en `analisis-salud-mercado`, P3).

---

# PARTE B — Qué se puede calcular hoy

## B.0 Las tres fuentes

| Fuente | Qué tiene | Límite duro |
|---|---|---|
| `daily_bars` | 4.257.526 filas [DATO]; 5.657 símbolos con barra del 14-ago [DATO]; `open/high/low/close/volume` | arranca el 2025-01-10 (AAON: 409 barras desde esa fecha [DATO]) |
| Escaneo nocturno | 3.312 filas con ~200 métricas por valor [DATO] | una sola fecha de mercado utilizable, ver B.2 |
| `rs_weekly_items` | 26 semanas del motor vigente | no lleva precio ni medias: no sirve para volumen |

Consultas:

```
supabase_query {table: daily_bars, select: count}                    → 4.257.526
supabase_query {table: daily_bars, select: count,
                filter: trade_date=eq.2026-08-14}                     → 5.657
supabase_query {table: daily_bars, select: count, filter: symbol=eq.AAON} → 409
supabase_query {table: daily_bars, select: trade_date,close,volume,
                filter: symbol=eq.AAON, order: trade_date.asc, limit: 1}
                                                                      → 2025-01-10
```

## B.1 Tres precondiciones que hay que resolver antes de publicar nada

### B.1.1 La serie diaria tiene barras mensuales incrustadas

En `daily_bars` conviven barras diarias y barras **mensuales** guardadas con
fecha del día 1. Se ven cuando el día 1 no es hábil; cuando lo es, quedan
indistinguibles.

SPY y QQQ tienen **9 barras de este tipo** en 409 sesiones; IWM tiene 0 — y
tiene exactamente 400 barras, las 409 menos las 9 [CALC, `espurias.mjs`]:

| Fecha | Día | Volumen SPY | Mediana de las 20 previas | Factor |
|---|---|---|---|---|
| 2025-02-01 | sábado | 871.641.300 | 47.910.100 | 18,2× |
| 2025-03-01 | sábado | 1.496.591.400 | 43.321.600 | 34,5× |
| 2025-06-01 | domingo | 1.495.410.200 | 68.445.500 | 21,8× |
| 2025-09-01 | lunes festivo | 1.606.348.500 | 64.357.500 | 25,0× |
| 2025-11-01 | sábado | 1.664.668.300 | 76.335.800 | 21,8× |
| 2026-01-01 | jueves festivo | 1.600.537.800 | 74.144.800 | 21,6× |
| 2026-02-01 | domingo | 1.614.970.000 | 77.862.000 | 20,7× |
| 2026-03-01 | domingo | 2.237.624.600 | 83.308.900 | 26,9× |
| 2026-08-01 | sábado | 431.910.800 | 44.782.000 | 9,6× |

Que son barras mensuales y no un error de volumen se comprueba en el precio: la
barra del 2026-03-01 tiene mínimo 627,66 —el mínimo del 30 de marzo— y cierre
648,67 —el cierre del 31 de marzo—. Es el rango del mes entero.

**El alcance es acotado pero cae justo donde duele.** El 2026-08-01 solo hay 19
símbolos con barra [DATO]:

```
supabase_query {table: daily_bars, select: count, filter: trade_date=eq.2026-08-01} → 19
supabase_query {table: daily_bars, select: symbol,trade_date,close,volume,
                filter: trade_date=eq.2026-08-01, limit: 25}
```

y entre esos 19 están **SPY, QQQ y ACWI** — los tres índices de referencia—,
más NVDA, GOOGL, DELL, FTNT y otros doce valores.

**Efecto medido.** NVDA cierra el 14-ago con `avgVolume` 169.191.450 en el
escaneo [DATO]. Sumando las 20 barras de su `chartPreview` sale exactamente esa
cifra, y una de las 20 es la barra mensual de 1.065.637.500. Sin ella, la media
de las 19 restantes es ≈ 122 millones: **la barra mensual infla la media de
volumen de NVDA un 39 %**, y con ella `relativeVolume` (0,446 en vez de ≈ 0,62),
`volumeSurgePct`, `volumeDryUpRatio` y `upDownVolRatio` [CALC].

Sobre los índices el efecto llega a la conclusión: recontando los días de
confirmación de SPY con y sin esas barras, **de los 9 que salen en la serie
cruda, 3 son la propia barra mensual** (volúmenes 16,5×, 21,6× y 21,6× el del
día anterior). La serie limpia deja 6 [CALC, `indices.mjs`]. El reparto del
volumen a 50 sesiones de SPY también cambia de lado: 1,13 crudo frente a 0,94
limpio.

**Consecuencia de diseño: ningún indicador de volumen debe leer `daily_bars`
sin filtrar estas barras.** El filtro es barato y no necesita dato nuevo:
descartar la barra cuyo volumen supere en más de 4 veces la mediana de las 20
previas y caiga en día 1 de mes. Es un apaño; la corrección real es no
escribirlas.

### B.1.2 Hoy hay una sola fecha de mercado en el escaneo nocturno

Los tres escaneos nocturnos que existen —15, 16 y 17 de agosto— tienen **los
tres** la misma última barra: 2026-08-14 [CALC sobre `metrics->>lastDate`,
3.314 / 3.313 / 3.312 filas respectivamente]. Es correcto (15 y 16 son fin de
semana, y el del 17 corre a las 04:01 UTC, antes de la sesión del lunes), pero
tiene una consecuencia práctica: **la frecuencia de cambio de los indicadores no
se puede medir sobre el nocturno**, porque no hay dos observaciones distintas.
Todo lo que se mide en la Parte C sale de `daily_bars`.

Los escaneos anteriores no ayudan: el del 14, 13 y 12 de agosto tienen 62, 75 y
75 filas [DATO], no son pasadas completas.

```
supabase_query {table: scans, select: id,local_id,created_at,row_count,
                filter: local_id=like.materialized:US:*, order: created_at.desc}
```

### B.1.3 La población cambia, y eso mueve los porcentajes

Símbolos con barra en `daily_bars`: 10.499 el 2025-08-14, 5.657 el 2026-08-14
[DATO]. Dentro de la ventana medida cae de 10.791 (2 de febrero) a 5.662
(14 de agosto) [CALC].

Recalculando la participación sobre media con población fija —los 5.328
símbolos presentes en las 131 sesiones— y comparándola con la población
variable, la diferencia llega a **3,8 puntos porcentuales** y se cierra sola a
medida que la población variable converge [CALC, `amplitud2.mjs`]:

| Fecha | Población variable | Población fija | Diferencia |
|---|---|---|---|
| 2026-08-03 | 48,6 % | 51,9 % | −3,3 pp |
| 2026-08-04 | 51,3 % | 55,1 % | −3,8 pp |
| 2026-08-07 | 53,6 % | 56,6 % | −2,9 pp |
| 2026-08-14 | 59,0 % | 58,8 % | +0,2 pp |

Un movimiento de casi cuatro puntos que no es del mercado sino del censo. **Para
series temporales, población fija; y la fecha de corte, declarada.**

Y hay una segunda población en juego. Sobre las mismas barras del 14-ago:

- universo del escaneo (3.312 valores): **67,0 %** sobre su SMA50
- población fija de `daily_bars` (5.328): **58,8 %** sobre su SMA50

**8,2 puntos de diferencia por cambiar de población** [CALC, `noches.mjs`]. No
es un error: el universo del escaneo está filtrado por liquidez y tamaño, y los
valores que filtra están peor. Pero significa que la cifra no se puede publicar
sin decir sobre quién se ha medido.

## B.2 Cobertura real de los campos, medida

Sobre las 3.312 filas del nocturno `cea57d44-6424-42fc-bd55-93fe8153f346`
[CALC, `cobertura.mjs`, sobre el volcado completo de la tabla]:

| Campo | Cobertura | ¿Sirve? |
|---|---|---|
| `upDownVolRatio` | 3.312 / 3.312 — **100 %** | sí |
| `relativeVolume` | 100 % | sí |
| `volumeSurgePct` | 100 % | sí |
| `volumeDryUpRatio` | 100 % | sí |
| `avgVolume`, `latestVolume` | 100 % | sí |
| `extSma50`, `distance52w` | 100 % | sí |
| `adProxyScore`, `demandScore` | 100 % | sí, con reserva (B.3) |
| `sma200Slope` | 3.275 — 98,9 % | sí |
| `weeklyStageState` | 3.271 — 98,8 % | sí, con reserva de taxonomía |
| `marketCap` | 99,8 % | sí |
| **`weeklyPriceAboveSlowMa`** | **0 / 3.312 — 0 %** | **no** |

Verificación cruzada del primero por consulta directa:

```
supabase_query {table: scan_results, select: count,
  filter: scan_id=eq.cea57d44-…&metrics->upDownVolRatio=gte.0}   → 3.312
supabase_query {table: scan_results, select: count,
  filter: scan_id=eq.cea57d44-…&metrics->upDownVolRatio=eq.null} → 0
```

**Dos cosas que hay que saber antes de diseñar sobre esto:**

1. **`weeklyPriceAboveSlowMa` no está en las filas.** El campo lo emite
   `weeklyStageFields()` (`lib/weeklyStage.js:276`) y está en la lista de
   campos que la proyección ligera debe conservar
   (`lib/scanLightProjection.js:93`), con un comentario que explica que es
   justo lo que lee la amplitud [CÓDIGO]. Pero el nocturno de hoy no lo trae.
   Consecuencia directa: el indicador «Sobre su media de 30 semanas» de
   `lib/marketBreadth.js:122` se declara ausente en producción, porque su
   cobertura es 0 y el umbral son 60 puntos.

2. **La etapa semanal viene con taxonomía mezclada.** Reparto real del nocturno
   de hoy: `stage2` 36,4 %, `base` 31,2 %, `stage4` 19,8 %, `mixed` 11,3 %,
   nulo 1,2 % [CALC]. `base` y `mixed` son la taxonomía anterior —
   `lib/marketBreadth.js:45` las trata explícitamente como heredadas — y no
   aparece **ninguna** fila en `stage1` ni `stage3`, que son los estados que
   `lib/weeklyStage.js:138-186` sí emite. Es decir: el 42,5 % del universo está
   en cubos que no son etapas. Cualquier indicador de mercado basado en el
   reparto por etapas hereda ese problema.

**Y una trampa de nombres.** «RS» son tres campos distintos con tres valores
distintos en la misma fila [DATO]:

```
supabase_query {table: scan_results, select: symbol,rs_rating,metrics->rsRating,
  metrics->rsGlobalPct, filter: scan_id=eq.cea57d44-…&rs_rating=gte.95, limit: 5}
→ KRT: rs_rating 96 · metrics->rsRating 87 · metrics->rsGlobalPct 96
```

La columna `rs_rating` coincide con `metrics->rsGlobalPct`; `metrics->rsRating`
es otra cosa. Con el primero, «RS ≥ 80» son 653 valores (19,7 %); con el
segundo, 245 (7,4 %). El análisis del 16-ago usó el primero; conviene fijar
cuál es el canónico antes de que dos pantallas den dos cifras.

## B.3 Indicador por indicador: qué se puede hoy

| Indicador | ¿Hoy? | Con qué | Qué falta |
|---|---|---|---|
| Participación sobre SMA50 | **Sí** | ya en producción, `lib/marketBreadth.js` | — |
| Participación sobre MM30 semanal | **No** | — | `weeklyPriceAboveSlowMa` en las filas (B.2) |
| Divergencia índice / participación | **Sí, con reservas** | `participationSummary()` + `daily_bars` | umbral (C.1) y población fija (B.1.3) |
| Nuevos máximos y mínimos 52 s | **Sí** | `daily_bars`: 409 barras/símbolo desde 2025-01-10 [DATO] | trabajo batch; la serie histórica solo se puede reconstruir desde ≈ enero de 2026 |
| Reparto del volumen del universo | **Sí** | suma de `volume` por sesión sobre población fija | filtrar barras mensuales (B.1.1) |
| Sesiones de venta con volumen | **Sí** | índice de `daily_bars` + volumen agregado del universo | idem |
| Día de confirmación | **Sí de calcular, no de validar** | igual | ningún caso en la ventana medida (C.1) |
| Impulso de participación (Zweig) | **Sí de calcular** | avances/descensos del universo | no se dispara: ver C.2 |
| Oscilador McClellan | **No recomendable** | — | población estable, que no tenemos (B.1.3) |
| Volumen en la ruptura (por valor) | **Sí** | `volumeSurgePct`, `relativeVolume`, `avgVolume` al 100 % | criterio de ruptura fiable → base fiable |
| Volumen seco (por valor) | **Sí** | `volumeDryUpRatio` al 100 % | — |
| Acumulación / distribución del valor | **Parcial** | `adProxyScore` y `demandScore` al 100 % | no he auditado su fórmula: ver «lo que no he verificado» |
| Huecos de agotamiento | **Sí** | `daily_bars` tiene `open`, `high`, `low` | — |
| Sesiones de venta del valor (13 semanas) | **Sí** | `daily_bars` | trabajo batch por valor |

## B.4 Lo que **no** propongo porque exige datos que no existen

- **Volumen compuesto de mercado tal y como lo define la escuela de O'Neil**
  (todo NYSE, todo Nasdaq). No lo tenemos y no se compra hoy. Lo más parecido
  —la suma del volumen del universo cargado— es un sustituto razonable pero
  **no es lo mismo**, y su población cambia (B.1.3). Se puede publicar
  diciendo qué es.
- **Avances y descensos de la bolsa entera**, por lo mismo.
- **Nuevos mínimos de 52 semanas por valor en el escaneo**: `distance52w` mide
  contra el **máximo** y no hay campo simétrico contra el mínimo [CÓDIGO,
  `lib/researchRow.js:157` tiene `lowAdvance52w`, pero no llega a `metrics`
  del nocturno]. Se calcula desde `daily_bars`, no desde el escaneo.
- **Volumen intradía o por tramos**, que es lo que haría falta para medir el
  cierre dentro del rango con precisión de sesión.

---

# PARTE C — Cuáles merecen la pena

Criterio del encargo: un indicador que casi nunca cambia no informa; uno que
cambia cada día tampoco. Todo lo que sigue está medido sobre 82 sesiones
(2026-04-15 → 2026-08-14) con población fija de 5.328 símbolos
[CALC, `frecuencia.mjs`, `final.mjs`, `huecos.mjs`, `maxmin.mjs`].

## C.1 Frecuencia medida, indicador a indicador

**Participación sobre SMA50.** Rango 46,6 %–65,2 %; hoy 58,8 %. Variación
diaria mediana 1,58 pp, máxima 6,5 pp. Cruza el 50 % **18 veces en 82
sesiones**, una cada cinco. En datos semanales, 6 cruces en 16 semanas.
→ *El número informa; el umbral del 50 % como semáforo, no.* Weinstein tenía
razón en preferir la lectura semanal.

**Reparto del volumen del universo.** Tres ventanas, tres comportamientos:

| Ventana | Rango | Cruza el 1 |
|---|---|---|
| diaria | 0,31 – 4,36 | 40 veces en 82 sesiones (una cada 2) |
| media de 5 sesiones | 0,85 – 2,44 | 10 veces (una cada 7,8) |
| media de 25 sesiones | 1,12 – 1,52 | **0 veces** |

→ *El diario es ruido puro. El de 25 sesiones nunca cambia de lado y por tanto
no informa como condición — aunque su nivel sí describa. La media de 5 sesiones
es la única con frecuencia útil.* Esto tiene una implicación directa sobre lo
que ya está en pantalla: `upDownVolRatio` es de **50** sesiones y el indicador
de amplitud pregunta si es ≥ 1; con el ratio agregado nunca por debajo de 1 en
cuatro meses, esa condición está casi siempre encendida. En el universo del
escaneo, el 70,0 % de los valores la cumplen, y la cifra se mueve 0,07 pp entre
noches [CALC].

**Sesiones de venta con volumen.** Aquí la fuente del volumen lo cambia todo:

| Volumen usado | Sesiones que califican | Conteo 25 s: días con ≥ 4 | con ≥ 6 |
|---|---|---|---|
| ETF SPY (crudo) | 22,7 % | **77 %** | 44 % |
| ETF SPY (limpio) | 22,5 % | 77 % | 48 % |
| **Universo entero** | 15,9 % | **38 %** | 28 % |

→ *Con volumen de ETF el umbral clásico está encendido tres de cada cuatro días:
no discrimina. Con el volumen del universo el conteo se comporta como describe
la escuela — media 3,8, máximo 8, y cambia el 28 % de las sesiones.* Si este
indicador entra, entra con volumen del universo.

**Día de confirmación.** Con volumen del universo: **0 casos en 82 sesiones**.
Con volumen de ETF y serie limpia: 6 en SPY, 16 en QQQ y 19 en IWM en 400
sesiones — el mismo periodo, tres índices, tres respuestas distintas.
→ *Es un indicador raro por construcción (solo aparece tras correcciones) y muy
sensible al índice elegido y a la limpieza de la serie. No lo puedo validar con
los datos disponibles.*

**Divergencia índice / participación.** La frecuencia depende por completo del
umbral:

| Regla | Sesiones que la cumplen |
|---|---|
| índice > 0 % y participación < 0 pp, 20 s (**la que hay hoy en el código**) | 24 de 62 — **39 %** |
| índice ≥ +2 % y participación ≤ −5 pp, 20 s | 6 de 62 — 10 % |
| índice ≥ +3 % y participación ≤ −5 pp, 40 s | 8 de 42 — 19 % |
| índice ≥ +5 % y participación ≤ −8 pp, 60 s | 2 de 22 — 9 % |

→ *Sin umbral, «hay divergencia» cuatro de cada diez días: deja de ser noticia.
Con ±2 %/−5 pp a 20 sesiones cae al 10 %, que es la frecuencia de algo que
merece leerse.*

**Nuevos máximos y mínimos.** Medido a 126 sesiones (el histórico descargado no
alcanza a 252; a 52 semanas se puede calcular en producción, B.3): nuevos
máximos entre 281 y 424 valores (5,3 %–8,0 % del universo), nuevos mínimos entre
128 y 150, neto con variación diaria mediana de 92.
→ *Se mueve todos los días y en magnitudes legibles. Buen candidato.*

**Huecos al alza** (mínimo de hoy por encima del máximo de ayer): mediana 2,98 %
del universo por sesión, rango 1,31 %–19,43 %. De ellos, con volumen ≥ 2 veces
la media de 50: mediana **31 valores por sesión**, máximo 95. Y en valores ya
extendidos (> 25 % sobre su SMA50): mediana **16**, máximo 155.
→ *El conteo de huecos a secas es demasiado común. Filtrado por volumen y por
extensión da una lista corta y legible.*

**Extensión del universo** (valores a más del 25 % sobre su SMA50): rango
1,43 %–9,08 %, hoy 4,52 % (241 valores), variación diaria mediana 0,41 pp.
→ *Se mueve despacio y con recorrido: describe recalentamiento sin oscilar.*

**Reparto del volumen, versión porcentaje.** Porcentaje del volumen del
universo que va a valores que suben: mediana 55,5 %, rango 23,9 %–81,3 %.
Sesiones con ≥ 75 %: 6 de 82 (7 %). Con ≤ 25 %: 1 (1 %).
→ *Distribución sana: la lectura extrema es rara y por tanto significativa.*

## C.2 Los que descarto por frecuencia

- **Impulso de participación (Zweig).** Por definición se dispara unas pocas
  veces por década. En cuatro meses de datos, cero. Un indicador que está
  apagado el 99,9 % del tiempo ocupa sitio permanente para decir «no».
- **Reparto del volumen a 25 o 50 sesiones como condición binaria.** Cero
  cruces en cuatro meses (C.1). Si se conserva —y hoy está en pantalla— debe
  mostrarse como **nivel**, no como sí/no.
- **Conteo de sesiones de venta con volumen de ETF.** Encendido el 77 % de los
  días.
- **Divergencia sin umbral.** Encendida el 39 % de los días.

## C.3 El conjunto recomendado: cuatro, más uno por valor

Mejor cuatro que digan algo. Los cuatro se calculan sobre la **misma
población** —el universo del escaneo nocturno— y comparten fecha.

**1. Reparto del volumen del universo, media de 5 sesiones.**
Suma del volumen de los valores que suben dividida por la de los que bajan,
promediada a 5 sesiones. Es el único indicador de volumen agregado con
frecuencia útil (una alternancia cada 7,8 sesiones) y responde literalmente a
lo que Minervini dice vigilar. Enunciado: «el volumen de las subidas supera al
de las bajadas en las últimas cinco sesiones (1,42 a 1)».

**2. Sesiones de venta con volumen, contadas sobre el volumen del universo.**
Ventana de 25 sesiones, con la caducidad del 5 %. Con volumen del universo el
conteo se comporta (media 3,8, máximo 8). Se publica el **número**, no un
veredicto: «3 sesiones de venta con volumen en las últimas 25».

**3. Nuevos máximos y nuevos mínimos de 52 semanas, con lectura semanal.**
El par y su diferencia. Semanal por la razón que da Weinstein y que confirma la
medición: la lectura diaria oscila mucho más sin decir más. Enunciado:
«319 valores marcaron máximo de 52 semanas y 129 marcaron mínimo».
(Las cifras del ejemplo son reales pero de la ventana de 126 sesiones que pude
medir, no de 52 semanas; el orden de magnitud a 52 semanas será menor.)

**4. Divergencia índice / participación, con umbral.**
Ventana 20 sesiones, umbral índice ≥ +2 % y participación ≤ −5 pp. Frecuencia
medida: 10 % de las sesiones. Enunciado del hecho, nunca de la consecuencia:
«el índice sube un 4,4 % en veinte sesiones y la participación sube 6,6 puntos:
no hay divergencia».

**Y uno en la ficha del valor, no en la pantalla de mercado:**

**5. Estado del volumen del valor**, con tres cifras que ya existen al 100 % de
cobertura: reparto del volumen a 50 sesiones (`upDownVolRatio`), volumen seco
(`volumeDryUpRatio`, media de 10 sobre media de 50) e impulso reciente
(`volumeSurgePct`, media de 5 sobre media de 20 previas).

**Lo que NO entra, y conviene decirlo explícitamente:** el día de confirmación.
Es el caso típico que el encargo anticipaba. No entra por tres razones
acumuladas: su umbral ha ido cambiando (1 % → 1,25 % → 1,5–2 %), sus propios
partidarios publican tasas de fallo del 70–95 % en cuanto se cruza con otra
condición, y en nuestros datos da 0, 6, 16 o 19 casos según qué índice y qué
serie se use. Puede entrar más adelante **como hecho fechado en una serie
histórica** —«confirmación el 8 de abril: +2,55 % en la sexta sesión del
intento»— pero no como estado de la pantalla.

---

# PARTE D — Cómo se muestran

## D.1 Dónde va cada uno

**Salud de mercado** — los cuatro de C.3, junto al bloque «Amplitud del
universo» que ya existe (`app/market-health/UniverseBreadth.jsx`, servido por
`/api/market-breadth`). No es una sección nueva: son cuatro filas más en la
misma rejilla, con la misma fecha y la misma población. La divergencia (nº 4)
se sirve en el bloque «Índice y participación», que ya está construido para eso.

**Sectores** — ninguno de los cuatro. La participación por tema se puede
calcular, pero con 3.312 valores repartidos en decenas de temas las muestras
por grupo bajan a decenas y el mismo umbral de cobertura del 60 % que aplica
`lib/marketBreadth.js` dejaría la mitad en ausencia. Antes de llevar volumen a
Sectores hay que medir el tamaño de muestra por tema; no lo he hecho.

**Ficha del valor** — el nº 5, y los huecos. El conteo de huecos con volumen
(mediana 31 valores por sesión) es demasiado poco para una pantalla de mercado
y demasiado específico para una tabla: es información sobre **ese** valor.

**En ningún sitio, de momento** — el día de confirmación, el impulso de
participación, el oscilador McClellan.

## D.2 Cómo se enuncia: el principio 1 aplicado

La regla es la del principio 1: el hecho medido, con su ventana y su población;
nunca la consecuencia.

| Se escribe | No se escribe |
|---|---|
| «El volumen de bajada supera al de subida en las últimas cuatro sesiones» | «Viene una corrección» |
| «3 sesiones de venta con volumen en las últimas 25» | «Mercado bajo presión» |
| «El índice sube un 4,4 % en veinte sesiones; la participación cae 6 puntos» | «Divergencia bajista: reducir exposición» |
| «319 nuevos máximos y 129 nuevos mínimos» | «Amplitud saludable» |
| «Volumen 42 % por encima de su media de 20 sesiones» | «Entrada con volumen confirmado» |

Dos consecuencias concretas:

- **Sin semáforos de color sobre el conjunto.** Un número con fondo rojo es un
  veredicto aunque el texto sea neutro. Los cuatro indicadores se publican como
  cifra y serie.
- **Sin agregarlos en una puntuación de mercado.** Ya hay precedente de lo que
  pasa: el «98 sobre 100» del hero convive con que solo 6 de 11 sectores
  sostienen su media (analizado en `analisis-salud-mercado`, B.2). Cuatro
  hechos separados informan más que un número que los promedia.

## D.3 Cómo se declara la ausencia

El producto ya tiene el mecanismo y hay que usarlo tal cual: `indicator()` en
`lib/marketBreadth.js:50-66` devuelve `available: false` con motivo cuando la
cobertura baja del 60 %, y la interfaz pinta la ausencia con su razón. Los tres
casos que aparecerán:

1. **Cobertura insuficiente.** «Solo 1.980 de 3.312 valores del escaneo traen
   este dato (cobertura 60 %, mínimo 60 %)» — el texto que ya emite el código.
2. **Ventana insuficiente.** Los indicadores que necesitan 52 semanas no
   existen para valores con menos historia. Se declara el tamaño: «medido sobre
   4.980 valores con 52 semanas de historia; 348 quedan fuera».
3. **Serie no comparable.** El caso de B.1.3: si la población cambia más de un
   umbral entre dos puntos de la serie, el tramo se marca como no comparable en
   vez de dibujar una línea que mezcla dos censos. Hoy la caída de 10.499 a
   5.657 símbolos en doce meses haría eso con casi toda la serie histórica.

Y un caso más, específico de la Parte B:

4. **Dato contaminado.** Mientras las barras mensuales sigan en `daily_bars`, un
   valor cuya ventana las contenga tiene el volumen mal medido. Con 19 símbolos
   afectados el 2026-08-01, lo honesto no es ocultarlos sino filtrarlos en el
   cálculo y contar cuántos se filtraron.

## D.4 Orden de trabajo sugerido

1. **Filtrar las barras mensuales** en todo lo que lea volumen de `daily_bars`
   (B.1.1). Sin esto, los cuatro indicadores nacen con el volumen mal medido y
   los índices de referencia son los más afectados.
2. **Reponer `weeklyPriceAboveSlowMa`** en las filas del nocturno (B.2). Es un
   indicador ya escrito que hoy no puede servirse.
3. **Guardar el agregado diario**: una fila por noche con los cuatro números y
   su población. Es la pieza que convierte la pantalla de foto en serie, ya
   señalada en `analisis-salud-mercado` C.5, y sin ella la frecuencia de los
   indicadores seguirá sin poder medirse en producción (B.1.2).
4. Los cuatro indicadores, en el orden de C.3.

---

# CONFIANZA

| Afirmación | Confianza | Base |
|---|---|---|
| Definiciones de A.1.5, A.1.6, A.1.7, A.1.8, A.2.3 | Alta | fuentes web citadas, coincidentes entre sí |
| Regla de volumen en la ruptura de Weinstein (2× la media del mes anterior) | Alta | texto extraído del PDF local, literal en su sentido |
| Nuevos máximos/mínimos semanales y ejemplo de 1987 (12 vs 1.516) | Alta | ídem |
| Volumen seco por debajo de la media de 50 (Minervini) | Alta | ídem |
| Tasas de fallo del día de confirmación (70 % / 95 %) | Media | fuente secundaria única (Forbes / TraderLion); no he visto el estudio |
| Cifra 40–50 % de volumen en la ruptura (Minervini) | Media | material divulgativo, no el libro; el libro describe la expansión sin porcentaje |
| Barras mensuales en `daily_bars`: 9 en SPY/QQQ, 0 en IWM | Alta | cálculo reproducible + verificación por precio (rango del mes) |
| 19 símbolos con barra el 2026-08-01, incluidos SPY/QQQ/ACWI | Alta | consulta directa citada |
| La barra mensual infla `avgVolume` de NVDA un 39 % | Alta | la suma de las 20 barras de `chartPreview` reproduce el `avgVolume` exacto |
| 3 de los 9 días de confirmación de SPY eran barras mensuales | Alta | recálculo con y sin, ambos mostrados |
| Cobertura 100 % de los cinco campos de volumen | Alta | volcado completo de 3.312 filas + consulta `count` cruzada |
| `weeklyPriceAboveSlowMa` con cobertura 0 % | Alta | volcado completo; el campo existe en el código |
| Las tres noches tienen la misma fecha de barras | Alta | volcado de las tres |
| Diferencia de 8,2 pp entre poblaciones | Alta | mismo día, dos poblaciones, ambos cálculos mostrados |
| Frecuencias de C.1 | Media-alta | 82 sesiones es poco: un solo régimen de mercado, sin corrección profunda |
| Que la media de 5 sesiones sea la ventana correcta | Media | es la que mejor se comporta en esta muestra; con otro régimen podría cambiar |
| Parte D | — | propuesta de diseño; discutible, no verificable |

# LO QUE NO HE VERIFICADO

- **El libro de O'Neil.** El PDF de `research/books/` no tiene capa de texto
  recuperable con mi extractor (1 bloque en 2.371 páginas). Todo lo atribuido a
  esa escuela viene de fuentes secundarias. Las definiciones coinciden entre
  ellas, pero no las he contrastado contra el original.
- **Por qué se escriben las barras mensuales.** He demostrado que están y qué
  efecto tienen; no he localizado la línea del código que las inserta ni si
  ocurre también cuando el día 1 es hábil (en ese caso serían indetectables por
  la fecha, y el diagnóstico se quedaría corto).
- **`adProxyScore` y `demandScore`.** Cobertura 100 %, pero no he auditado su
  fórmula ni si miden lo que su nombre sugiere. Los propongo con reserva
  explícita en B.3; antes de publicarlos hay que leer su cálculo.
- **Regímenes de mercado distintos.** Las 82 sesiones medidas (abril–agosto de
  2026) son un tramo alcista sin corrección profunda. Por eso salen 0 días de
  confirmación, y por eso el reparto del volumen a 25 sesiones nunca baja de 1.
  En un tramo bajista las frecuencias de C.1 serían otras.
- **Los 52 semanas de verdad.** Los nuevos máximos y mínimos los he medido a
  126 sesiones porque el histórico que descargué arranca el 2026-02-02. Que la
  ventana de 252 es viable lo sostengo por la profundidad de `daily_bars`
  (409 barras desde 2025-01-10), no por haberla calculado.
- **Sectores.** Digo que no llevo los indicadores ahí porque las muestras por
  tema serían pequeñas; no he medido el tamaño de muestra por tema.
- **Nada en navegador.** Este documento no toca la interfaz: no he abierto la
  pantalla ni verificado cómo se ven hoy los bloques que menciono en D.1. Lo
  que afirmo sobre ellos viene del código y del análisis del 16-ago.
- **La taxonomía de etapas.** Constato que el 42,5 % del universo está en
  `base`/`mixed` y que no hay ninguna fila en `stage1`/`stage3`; no he
  investigado por qué el criterio estricto no las produce. Es materia de
  `docs/auditoria-etapas-2026-08-16.md`, no de este documento.
