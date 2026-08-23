# Diseño: contracciones de volatilidad, segundo intento

<!-- fecha interna: 2026-08-18 · escrito el 2026-08-20 · BASE_SHA: b9b13de · rama: codex/statsedge-ui-polish -->

Documento de **diseño y medición**. No modifica código del producto, no escribe
en Supabase y no ejecuta ningún escaneo. El prototipo vive fuera del repo, en el
directorio temporal de la sesión, y está escrito en Python para poder iterar
rápido; el detector de producción sigue siendo el de `lib/setupPatterns.js`, sin
tocar.

Continúa [`docs/diseno-contracciones-2026-08-17.md`](diseno-contracciones-2026-08-17.md),
que se quedó en 2 de 8 bases reconocidas y localizó la causa: **elegir cuál base,
entre varias anidadas, es la actual**. Este intento aplica el criterio que aportó
el dueño —partir del último máximo relativo relevante en vez de buscar la base
más larga— y lo mide contra los mismos casos.

---

## Resumen para el dueño (sin jerga)

1. **La fuente primaria dice más de lo que el primer intento recogió.** Además de
   los números conocidos (de dos a seis contracciones, cada una ~la mitad de la
   anterior, de 3 a 65 semanas), Minervini es explícito en dos cosas que cambian
   el algoritmo: la base se mide **desde el máximo absoluto** —en su ejemplo de
   VIVO, de 19 a 13 dólares, un 31% de máximo a mínimo—, y **quiere ver
   perforaciones del mínimo anterior** —*shakeouts*—, idealmente una, dos o tres
   veces dentro de la base. Lo segundo contradice de frente la puerta `lower_low_drift`
   del detector actual, que es su estado más frecuente (33,5% de las filas).

2. **El criterio del ancla funciona y se puede escribir sin ambigüedad.** El
   ancla es el último máximo que (a) sigue tapando el precio y (b) lleva detrás
   una corrección real. Con él, WELL —el caso que el primer intento medía como
   base de 35,8 semanas cuando la real ronda las 12— sale ahora **12,4 semanas
   con contracciones 10,7 → 7,5 → 5,0**. El corpus del proyecto exige para ese
   caso «tres contracciones decrecientes cerca del pivote», y el documento
   anterior anotó **10,2 → 7,5 → 5,0**: las dos últimas coinciden a la décima.
   La medición ya no es el problema.

3. **La discriminación contra dientes de sierra funciona, y la he medido.** En 15
   valores en tendencia bajista clara: **0 bases**. En 15 en tendencia alcista
   con máximos recientes: **1 base** (NTRS, que al mirarla es una consolidación
   legítima de 4 semanas). En escaleras sintéticas: se rechazan todas a partir de
   **+3% de avance neto por escalón**; solo pasa la de +2%, que ya no es una
   escalera sino un rango plano.

4. **Pero la sensibilidad sigue baja: 3 de 8, frente a 2 de 8.** Y aquí está el
   hallazgo que cambia la pregunta: **5 de los 8 valores etiquetados con base no
   son detectables con ningún ajuste** —lo he probado con 1.800 combinaciones de
   parámetros y candidato a candidato— porque a 14 de agosto **no tienen dos
   caídas completas desde el último máximo relativo**. Es decir: fallan la
   condición mínima que tú mismo pusiste. Tres de ellos (SKWD, JAZZ, XMTR)
   llevan **una sola corrección** desde su máximo; BUD alterna 8 → 3 → 8 → 3 → 8,
   que es un rectángulo, no una contracción; y APGE lleva siete semanas
   en un rango del 1,7% —0,63% en las últimas tres— con un ATR diario del 0,18%,
   donde no hay nada que medir.

5. **Y aparecieron 2 falsos positivos sobre 43** (antes 0 sobre 60). Uno de ellos
   —WOR, con 17,1 → 6,6 → 5,0, volumen 1,93× → 0,70× → 0,66× y el precio a −1,7%
   del pivote— cumple el manual mejor que varios de los ocho etiquetados. El otro,
   DLR, es una base de 3,2 semanas, en el límite inferior que admite Minervini.

6. **Hallazgo de datos, importante:** la limpieza de barras **no está completa**.
   Siguen en `daily_bars` barras mensuales mezcladas con las diarias —COST el
   2026-01-01, WELL, AAPL y MSFT cuatro cada uno, XOM y MCD una— y **en el caso
   de COST el algoritmo ancló la base justo sobre la barra falsa**. Detalle en la
   Parte D, con la firma que las identifica.

7. **Veredicto: no lo resuelve.** Mejora la medición, arregla la elección de base
   y rechaza bien las tendencias, pero contra el juego de etiquetas disponible
   pasa de 2/8 a 3/8 y pierde el 0% de falsos positivos. Mi lectura es que el
   límite ya no está en el algoritmo sino en el juego de etiquetas: cuatro de los
   ocho casos no cumplen la condición de las dos caídas. Antes de seguir tocando
   umbrales hace falta **volver a etiquetar** con la regla escrita delante. La
   Parte E propone cómo.

---

## PARTE A — Qué dice la fuente primaria

Leídos en `research/books/`: *Think & Trade Like a Champion* (T&T, sección 6,
«Volatility Contraction Pattern») y *Trade Like a Stock Market Wizard* (TLSMW,
capítulo 10, «A Picture Is Worth a Million Dollars»). Cito **página impresa del
libro y, entre corchetes, página del PDF**, porque los PDF llevan 14-15 páginas
de desfase y el primer intento citó solo las del PDF.

Los libros están sujetos a derechos de autor: **resumo sus reglas en español en
vez de reproducir el texto**, y dejo la referencia de página para que cualquiera
pueda comprobarlo en la fuente. Las reglas numéricas son hechos y se citan tal
cual; la única frase literal del documento es la de A.2, porque de ella depende
una decisión del algoritmo.

### A.1 Cuántas contracciones y en qué proporción

| Regla | Valor | Fuente |
|---|---|---|
| Número de contracciones («Ts») | de dos a seis; lo típico, de dos a cuatro | T&T p.123-124 [PDF 109-110]; TLSMW p.198-199 [PDF 213-214] |
| Proporción entre contracciones | cada contracción sucesiva queda contenida en torno a **la mitad** de la anterior, «más o menos una cantidad razonable» | T&T p.123-124 [PDF 109-110]; TLSMW p.199 [PDF 214] |
| Progresión de ejemplo | 25% → 15% → 8% | T&T p.123 [PDF 109] |
| Otra progresión | 25% → 10% → 5% | TLSMW p.200 [PDF 215] |
| La primera es la más profunda | la volatilidad es máxima cuando los vendedores se precipitan a tomar beneficios | TLSMW p.199 [PDF 214] |
| Se mide de máximo a mínimo | la volatilidad se mide de máximo a mínimo | ídem |

Casos documentados por él mismo (notación `<semanas>W <mayor>/<menor> <n>T`):

| Valor | Footprint | Profundidades | Última/primera | Fuente |
|---|---|---|---|---|
| Meridian Bioscience (VIVO) | `40W 31/3 4T` | 31 → 17 → 8 → 3 | 0,10 | T&T p.127-128 [PDF 113-114]; TLSMW p.201-202 [PDF 216-217] |
| Michaels (MIK) | `19W 16/3 4T` | 16 → 8 → 6 → 3 | 0,19 | T&T p.132 [PDF 118] |
| Mercadolibre (MELI) | `6W 32/6 3T` | 32 → … → 6 | 0,19 | T&T p.131 [PDF 117] |
| Bitauto (BITA) | 8 semanas, 3T | 28 → 16 → 6 | 0,21 | T&T p.124 [PDF 110] |
| FSI International (FSII) | 10 semanas | 18 en la taza → 5 en el asa | 0,28 | TLSMW p.198 [PDF 213] |
| Netflix (NFLX) | `27W … 3T` | — | — | T&T p.127 [PDF 113] |

**Dato que no estaba en el primer intento y que sí es una regla numérica**: en
los seis casos documentados, la última contracción está entre **el 9% y el 28%
de la primera**. «Cada una la mitad» es el suelo, no el techo, de lo que él
enseña.

### A.2 Dónde empieza la base: en el máximo absoluto

Es la frase que reordena el algoritmo. Describiendo la primera contracción de
VIVO, dice que el valor «declined from $19 a share to $13, **correcting 31
percent from high to low**» (TLSMW p.201 [PDF 216]).

Y la definición general dice lo mismo: el valor cae inicialmente, pongamos, un
25% **desde su máximo absoluto** hasta su mínimo (T&T p.123 [PDF 109]). La base
no empieza donde uno decida: empieza en el máximo desde el que se midió la
primera caída, y ese máximo es el techo del patrón.

### A.3 Duración

| Regla | Valor | Fuente |
|---|---|---|
| Duración de una base propia | de **3 semanas hasta 65**, según la profundidad de la corrección | TLSMW p.212 [PDF 227] |
| Footprint típico | de 3 a 60 semanas de historia de precio | TLSMW p.197 [PDF 212] |
| Patrón 3-C (continuación) | de 3 a 45 semanas; **la mayoría, entre 7 y 25** | T&T p.119 [PDF 133] |
| Base plana / caja Darvas | 4 a 7 semanas, sin contracción real de volatilidad, corrección 10-15% | TLSMW p.200 [PDF 215] |
| Base tras salida a bolsa | al menos 10 días | T&T p.121 [PDF 135] |

El primer intento fijó el mínimo en 4 semanas (tomado de O'Neil) y por eso
descartó SKWD y JAZZ con «mi ojo fue generoso». **El mínimo de Minervini son 3
semanas.** Aquí se usa 3.

### A.4 Profundidad

| Regla | Valor | Fuente |
|---|---|---|
| Corrección de un setup constructivo | **entre el 10% y el 35%**; algunos hasta el 40% | T&T p.133 [PDF 119]; TLSMW p.211 [PDF 226] |
| Corrección del 3-C | 15-20% hasta 35-40%, y hasta el 50% según el mercado | T&T p.119 [PDF 133] |
| Fuera de radar | 60% o más | ambos |
| Regla relativa | evitar los que corrigen más de dos o tres veces lo que ha caído el mercado general | TLSMW p.211 [PDF 226] |

### A.5 Volumen

| Regla | Valor | Fuente |
|---|---|---|
| Durante la base | contrae en los tramos más estrechos: hay una reducción de volumen en puntos concretos | T&T p.123 [PDF 109]; TLSMW p.199 [PDF 214] |
| En la contracción final | volumen **por debajo de la media de 50 sesiones**, con uno o dos días de volumen extremadamente bajo | T&T p.131 [PDF 117] |
| Señal de máxima calidad | el volumen se seca hasta los niveles más bajos **desde que empezó el avance** del valor | TLSMW p.203 [PDF 218] |
| En la ruptura | el precio supera el pivote con volumen en expansión | T&T p.130 [PDF 116] |

### A.6 El pivote

En VIVO, lo que forma el punto pivote de compra es un retroceso corto y estrecho
de **solo el 3% a lo largo de dos semanas**, con volumen muy bajo (T&T p.128
[PDF 114]; TLSMW p.202 [PDF 217]). El pivote es **el máximo de la última
contracción**, y esa contracción dura semanas, no un día. De ahí sale la
exigencia de que una contracción ocupe al menos tres sesiones.

### A.7 Dos reglas del libro que el detector actual incumple

**(a) Los *shakeouts* son deseables, no descalificantes.**

Minervini dedica un apartado entero a pedir **una o más perforaciones de mínimos
previos** en puntos clave de la construcción de la base: lo ideal, dice, es que
ocurra una, dos o tres veces según el tamaño de la base, y pueden darse en los
mínimos, en el lado derecho o en la zona del asa y el pivote (TLSMW p.214-216
[PDF 229-231]).

Y el pie de foto de Deckers describe justo eso: el valor se deslizó por debajo
de mínimos previos en el fondo de la base y también durante la fase del asa
(TLSMW p.216 [PDF 231]). El detector actual
marca `lower_low_drift` en el 33,5% de las 3.312 filas del nocturno y lo trata
como rechazo. **Perforar un mínimo previo, si el precio vuelve al rango, es parte
del patrón.** Aquí se admite deriva del suelo hasta un 35% de la profundidad de
la base, y solo se rechaza cuando el suelo cede de verdad.

**(b) La compresión de tiempo: cuidado con las uves.**

Si el valor sube demasiado deprisa por el lado derecho, se produce lo que llama
compresión de tiempo, y hay que evitarlo: se reconoce por una **forma de uve** o
por la ausencia de un lado derecho bien desarrollado. Las consolidaciones
constructivas, dice, tienden a tener **cierta simetría** (TLSMW p.211-212
[PDF 226-227]).

Implementé una puerta de simetría y **no cambia ningún resultado** en los casos
probados; queda medida y desactivada (Parte C.9).

### A.8 La precondición

La sección del VCP empieza diciendo que solo mira el patrón **después** de haber
confirmado que el valor está en tendencia de **etapa 2** y cumple los ocho
criterios de su plantilla de tendencia (T&T p.123 [PDF 109]).

La etapa ya se calcula en el producto (`weeklyStageState`). Medido sobre los 43
negativos: 17 son etapa 2 y 26 no; de los 8 positivos, 7 son etapa 2 (BUD es
`base`). Aplicarla como puerta previa **no habría quitado ninguno de los dos
falsos positivos de la configuración final** —DLR y WOR son los dos etapa 2— pero
sí eliminó uno (DHR) en una configuración intermedia, y reduce a menos de la
mitad la población sobre la que corre el detector. **Recomendación: ponerla
delante, como en el libro, aunque su efecto medido aquí sea nulo.**

---

## PARTE B — El algoritmo v2

Cinco piezas. Las tres primeras son el criterio del dueño escrito en código; las
dos últimas, las puertas.

### B.1 El ancla: «el último máximo relativo relevante»

Es la decisión clave y la que el primer intento tenía mal. Definición operativa:

> Un máximo local `H` (radio 3 sesiones) es **candidato a ancla** si cumple las
> dos condiciones a la vez:
>
> 1. **Lleva detrás una corrección real**: la caída desde `H` hasta el mínimo
>    posterior alcanza `θ₁ = clamp(2,5 · ATR20%, 8%, 20%)`.
> 2. **Sigue tapando el precio**: lo que el precio lo ha superado después
>    (`up`) es pequeño *frente a la corrección que ese máximo produjo*:
>    `up ≤ clamp(0,4 · caída, 2%, 8%)`.
>
> El ancla es el **más alto** de los candidatos —el techo de la consolidación,
> que es donde el libro empieza a medir (A.2)—.

Las dos condiciones hacen trabajo distinto y las dos hacen falta:

- Sin (1), cualquier bache de tres días es un ancla y la «base» dura una semana.
- Sin (2), el ancla se va meses atrás y vuelve el problema del primer intento.

**Por qué la tolerancia del techo es relativa y no un porcentaje fijo.** Un valor
que corrige un 20% puede permitirse superar su techo un 3% sin dejar de estar
consolidando; uno que corrige un 4% no. La tolerancia fija de 3% que probé
primero pierde WELL (que supera su techo un 3,1% mientras contrae de 10,7% a
5,0%) y una del 10% admite JAZZ (que lo supera un 9,5% mientras contrae de 8,8%
a 3,9%: eso es una escalera). Medido en la ablación (C.7): la tolerancia relativa
gana un caso del corpus sin coste en falsos positivos.

**Lo que NO se hace, y es el cambio respecto al primer intento**: no se evalúan
todas las bases candidatas para quedarse con la más larga, ni con la que puntúe
mejor. Hay un ancla y solo una, elegida por regla geométrica. Probé también la
variante «probar candidatos del más reciente al más antiguo y quedarse con el
primero que dé patrón válido» —que es la lectura más literal de «la última
corrección visible»— y **multiplica los falsos positivos por cuatro o cinco**
(de 2 a entre 8 y 12 sobre 43). Está medido en C.9 y descartado.

### B.2 Medir las contracciones: dos umbrales, no uno

Un zigzag de umbral fijo no puede medir a la vez una primera contracción del 31%
y una última del 3%: o parte la primera en trozos o se salta la última. La regla
del libro —«cada una ~la mitad de la anterior»— sirve como **escala de
detección**:

```
umbral de apertura de la contracción i+1 = max(2%, 0,25 · profundidad_i)
```

Y una contracción **se cierra** cuando el precio recupera **la mitad** de la
caída (`retraceFrac = 0,5`). Sin esa segunda condición, los rebotes internos de
una corrección grande la parten en contracciones falsas: DAL pasa de medirse como
`10,9 → 5,3 → 7,5` (con reexpansión, y por tanto rechazada) a `15,5 → 6,9`, que
es la lectura correcta. En la ablación, quitar el cierre por retroceso cuesta un
verdadero positivo.

Cada contracción debe ocupar **al menos 3 sesiones** (A.6). Esto descarta los
recorridos intradía: XMTR tiene el 4 de agosto una barra con un 10,7% de rango
—máximo y mínimo el mismo día— que no es una contracción.

Se distingue entre contracciones **confirmadas** (cerradas por el rebote) y la
**abierta** (el retroceso en curso). Las puertas de estructura se aplican solo a
las confirmadas: tratar un retroceso en curso como contracción completa produce
rechazos falsos por reexpansión. BHP es el ejemplo: confirmadas
`18,1 → 8,4 → 4,5 → 4,1`, abierta `5,6`.

### B.3 La condición de las dos caídas

Tal y como la pediste, con la traducción mínima necesaria:

```
contracciones confirmadas ≥ 2
profundidad(última confirmada) < profundidad(primera)
ninguna contracción supera a la anterior en más de un 15%   (reexpansión)
número de contracciones ≤ 6                                  (TLSMW p.199)
el retroceso abierto no puede ser más profundo que la primera contracción
```

El 15% de tolerancia a la reexpansión no sale del libro: sale de que una
secuencia real rara vez es monótona perfecta. Es el parámetro con más peso de
todos —quitarlo sube los falsos positivos de 2 a 5 sobre 43—.

**No** se exige la regla estricta de «la mitad». Los seis casos del libro dan
última/primera entre 0,10 y 0,28 (A.1); exigir ≤0,50 en el prototipo cuesta un
verdadero positivo (RLAY, 0,73) y **no quita ninguno de los dos falsos
positivos** (WOR 0,29 y DLR 0,30 lo cumplen de sobra). Queda como dato medido,
no como puerta.

### B.4 Consolidación frente a dientes de sierra

El criterio que propongo tiene **una pieza principal y dos de respaldo**, y he
medido cuál trabaja de verdad:

**La pieza principal es la condición (2) del ancla.** Un valor que avanza en
escalones no tiene ningún máximo que siga tapando el precio: cada escalón supera
al anterior. El detector no encuentra ancla y responde `price_still_advancing`.
Esto es lo que rechaza 12 de las 15 escaleras alcistas reales y todas las
sintéticas a partir de +3% por escalón.

**La segunda pieza es la secuencia.** Una tendencia bajista en escalones sí tiene
techo (el máximo previo), pero sus caídas no contraen: reexpanden, o hay una
sola. Es lo que rechaza las 15 escaleras bajistas reales, con motivos
`depth_reexpansion`, `fewer_than_2_contractions` y `price_in_lower_half`.

**Las de respaldo, medidas y honestas:**

- `trend_saw_tooth`: ratio de eficiencia = |desplazamiento neto| / recorrido de
  los tramos. Se enciende en el 28,1% de una muestra aleatoria de 160 valores…
  y **no cambia ni una sola decisión** en ninguno de los conjuntos probados
  (siempre viene acompañada de otro motivo). Es redundante. La dejo medida y
  recomiendo **no implementarla**: una puerta que nunca decide es una puerta que
  no se puede depurar.
- `lower_low_drift`: el último mínimo no puede caer más de un 35% de la
  profundidad de la base por debajo del primero. Tolerante con los *shakeouts*
  (A.7a). Tampoco cambia ninguna decisión en los conjuntos probados.

**Dónde está el límite real, medido con series sintéticas** (escalones con
retrocesos decrecientes 12% → 8% → 5% y avance neto variable entre ellos):

| Avance neto por escalón | Veredicto |
|---|---|
| +2% | **base** (10,2 semanas, 8,3 → 5,9) ← límite |
| +3% a +15% | sin base (`price_still_advancing`) |
| −2% a −4% | sin base (por contexto: techo lejos del máximo anual) |
| −6% o peor | sin base (`price_in_lower_half`, `trend_saw_tooth`) |

Un valor que avanza un 2% neto por escalón mientras sus retrocesos son del 8-12%
no es una escalera: es un rango plano con sesgo. Ese es el límite y lo digo
explícitamente en vez de presentarlo como resuelto.

### B.5 Las puertas, con su origen

| Puerta | Umbral | Origen |
|---|---|---|
| Duración mínima | 15 sesiones (3 semanas) | TLSMW p.212 [PDF 227] |
| Duración máxima | 225 sesiones (45 semanas) | T&T p.119 [PDF 133] |
| Profundidad de la base | ≤ 35% | T&T p.133 [PDF 119] |
| Contracciones | ≥2, ≤6, decrecientes sin reexpansión >15% | TLSMW p.199 [PDF 214] |
| Precio en la mitad alta | posición ≥ 0,50 | derivada del asa (O'Neil p.187) |
| Pivote cerca del techo | ≤ 12% por debajo | O'Neil p.190 (asa 8-12%) |
| No perseguir la ruptura | precio ≤ +8% sobre el pivote | T&T p.130 [PDF 116]: comprar lo más cerca posible del pivote, sin perseguirlo más de unos pocos puntos porcentuales |
| Avance previo | ≥ 25% en las 130 sesiones previas al ancla | T&T p.119 [PDF 133]: el valor debe haber subido antes entre un 25% y un 100% |
| Techo cerca de máximos | ≥ 88% del máximo de 52 semanas | derivada: el VCP es continuación (T&T p.130 [PDF 116]) |
| Deriva del suelo | último mínimo ≥ primero − 0,35 × profundidad | tolerancia de *shakeout* (A.7a) |

### B.6 Volumen: medido, no usado como puerta

Tres cifras contra la media de 50 sesiones, según A.5: media de la última
contracción, mínimo de la última contracción, y la serie por contracción. En los
casos detectados el patrón del libro aparece solo:

| Valor | Ratios por contracción | Última contracción | Mínimo |
|---|---|---|---|
| DAL | 1,05 → 0,57 | 0,57× | 0,42× |
| RLAY | 1,00 → 0,58 → 0,53 → 0,58 | 0,58× | 0,46× |
| BHP | 1,05 → 0,97 → 0,86 → 0,84 → 0,98 | 0,98× | 0,87× |
| WOR | 1,93 → 0,70 → 0,64 | 0,66× | 0,38× |
| WELL (corpus) | 1,14 → 1,07 → 1,06 | 1,04× | 0,79× |

WELL es el único que **no** seca volumen, y es justamente el que el corpus
clasifica como `watch` y no como `plan`. No lo he usado como puerta porque
exigir «< 1,0 en la última contracción» costaría WELL y no quitaría ninguno de
los dos falsos positivos. Como dato de ficha, en cambio, es de lo más informativo
que hay aquí.

### B.7 Parámetros

```
atrLen=20   k1=2,5   minFirstPct=8   maxFirstPct=20      → θ₁ = clamp(2,5·ATR20%, 8%, 20%)
ceilRiseFrac=0,4  minCeilRisePct=2  maxCeilRisePct=8     → tolerancia de techo relativa
swingRadius=3   minLegBars=3
alpha=0,25   minNextPct=2   retraceFrac=0,5
minBaseBars=15   maxBaseBars=225   maxBaseDepthPct=35
reexpansionTol=1,15   maxContractions=6
minClosePosInBase=0,5   maxPivotBelowCeilingPct=12   maxAbovePivotPct=8
minPriorAdvancePct=25   priorAdvanceBars=130   minCeilingVs52wPct=88
floorDriftFrac=0,35   maxEfficiency=0,35 (inerte, ver B.4)   volLen=50
anchorPolicy=highest_connected
```

---

## PARTE C — La prueba

### C.1 Cómo se ha reconstruido el juego de casos (y qué falta)

El primer intento probó contra 68 valores: 44 de una muestra aleatoria de los
2.223 líquidos del escaneo `cea57d44-6424-42fc-bd55-93fe8153f346` (semilla
20260817) y 24 de un estrato dirigido. **La muestra aleatoria se reproduce
exactamente**: mismo escaneo, mismo filtro de liquidez (capitalización ≥ 1.000 M,
precio ≥ 10, rotación ≥ 5 M), misma población de 2.223, misma semilla. Los doce
negativos que el documento anterior tabula —NN, BEKE, AVAH, VRDN, CUZ, FND, D,
ELE, DLR, WEC, SPGI, CFG— aparecen en mi muestra **en ese mismo orden**,
intercalados con APGE (que es uno de los positivos) y DNLI (que el documento
anterior no tabula y del que no sé la etiqueta; lo cuento como negativo).

**El estrato dirigido no se reproduce**: el documento dice 614 valores y
ninguna interpretación de sus tres criterios da 614 (dan 538, 579 o 662), y las
muestras que salen de esas variantes no contienen los positivos conocidos.

Consecuencia, dicha sin adornos: **de los 68 casos originales recupero 51 por
nombre** (75%).

| Bloque | n | Etiqueta | Procedencia |
|---|---|---|---|
| Los 8 con base | 8 | con base | nombrados en el documento anterior |
| Negativos de la muestra reproducida | 39 | sin base | los 44 menos los 5 positivos que caen dentro |
| Negativos nombrados del estrato | 4 | sin base | RIO, TECK, FANG, CCNE (falsos positivos de la parametrización laxa) |
| **No recuperables** | **17** | — | del estrato dirigido, sin nombre publicado |

Los 43 negativos incluyen **los 12 que engañaron a la parametrización laxa del
primer intento**, que son los casos difíciles. La fecha de corte es
**2026-08-14**, la misma con la que se etiquetó, aunque hoy hay barras hasta el
19: comparar con etiquetas de otra fecha no diría nada.

### C.2 Los 8 etiquetados con base

Parametrización única (B.7), sin ajustes por caso:

| Valor | v1 estricto | **v2** | semanas | contracciones | pivote | dist. | motivo del rechazo en v2 |
|---|---|---|---|---|---|---|---|
| APGE | sin base | **sin base** | — | — | — | — | `price_still_advancing` |
| BUD | sin base | **sin base** | 2,2 | 9,0 | 86,60 | −7,9% | `fewer_than_2_contractions`, `too_short`, `price_in_lower_half` |
| BHP | sin base | **BASE** | 8,4 | 18,1 → 8,4 → 4,5 → 4,1 (+5,6 abierta) | 91,63 | −5,3% | — |
| DAL | base 7,2s | **BASE** | 6,2 | 15,5 → 6,9 | 95,01 | −6,0% | — |
| SKWD | sin base | **sin base** | 1,4 | 10,7 | 65,69 | −9,0% | `fewer_than_2_contractions`, `too_short` |
| JAZZ | sin base | **sin base** | 1,6 | 9,2 | 265,05 | −7,6% | `fewer_than_2_contractions`, `too_short` |
| XMTR | sin base | **sin base** | 3,8 | 24,0 | 106,08 | −9,3% | `fewer_than_2_contractions` |
| RLAY | base 5,4s | **BASE** | 5,4 | 11,8 → 10,4 → 8,6 (+6,5 abierta) | 20,71 | −4,1% | — |

**3 de 8**, frente a 2 de 8. Los detectados son BHP, DAL y RLAY; BHP es nuevo.

#### C.2.1 Los cinco que no salen: no es cuestión de umbrales

Esto es lo más importante del documento, así que va con la evidencia delante.
Probé **1.800 combinaciones de parámetros** en dos barridos (648 con la
tolerancia de techo fija; 1.152 con la relativa, cruzando política de ancla ×
tolerancia × θ₁ × k1 × α × retroceso de cierre × duración mínima × tolerancia de
reexpansión). **Solo BHP, DAL y RLAY se detectan alguna vez.** APGE, BUD, SKWD,
JAZZ y XMTR no aparecen en ninguna combinación.

Y el motivo, valor a valor, probando **todos los máximos locales de las últimas
90 sesiones como ancla forzada**:

**SKWD** — máximo el 6 de agosto en 65,69, seis sesiones antes del corte. Desde
ahí hay **una sola caída** (10,7%) y sigue abierta. Las lecturas con dos o más
contracciones decrecientes exigen anclar en máximos que el precio ya superó
después entre un **4,2% y un 41,3%**:

```
ancla 2026-07-28  63,96  TAPA        2,8 sem  confirmadas=0  [10,7*]
ancla 2026-07-07  63,03  roto +4,2%  5,8 sem  confirmadas=3  [10,9→7,2→7,7→10,7*]  ← reexpande
ancla 2026-06-12  51,66  roto +27,2% 8,8 sem  confirmadas=3
ancla 2026-04-20  47,72  roto +37,7% 16,4 sem confirmadas=4
```

**JAZZ** — máximo el 5 de agosto en 265,05. Una sola caída (9,2%), abierta. La
lectura bonita —`8,8 → 6,8 → 5,3 → 3,9`, un VCP de manual— sale de anclar el 5 de
junio en 241,99, un máximo que el precio **superó después un 9,5%**. Es decir: el
valor ha ido contrayendo mientras subía. Eso es exactamente la escalera que
avisaste que había que distinguir, y admitirla exige subir la tolerancia de techo
al 10%, que es lo que mete tres falsos positivos más.

**XMTR** — máximo el 21 de julio en 106,08, caída del 24,0% ya confirmada, y
nada más: la segunda contracción no existe. Anclando más atrás (1 de junio, techo
superado un 6,2%) sale `23,1 → 9,6 → 8,1 → 24,0`: **la más profunda es la
última**. Ninguna lectura de XMTR cumple «la segunda, menor».

**BUD** — desde el máximo absoluto (86,60, 31 de julio) hay una caída. Desde el
techo anterior conectado (84,46, 27 de mayo) la secuencia es
`8,1 → 3,2 → 8,3 → 3,1 → 8,2`: un rectángulo entre 77 y 86, no una contracción.

**APGE** — el 22 de junio abre en 132,60 tras cerrar en 90,38 (+47%) con 61,7
millones de títulos frente a un millón habitual, y desde entonces cotiza clavado:

```
últimas 10 sesiones  rango 0,63%   (134,03 – 134,88)
últimas 20 sesiones  rango 0,65%
últimas 35 sesiones  rango 1,73%   (132,55 – 134,88)
ATR de 20 sesiones   0,18% diario
```

No hay ninguna caída que medir: el umbral más bajo que probé —4%— sigue estando
seis veces por encima del recorrido total del valor en siete semanas. El perfil
—hueco enorme con volumen de 40× y después precio plano con volumen decreciente—
es el de un valor con una operación corporativa en curso; eso último es
inferencia mía, el resto es medición.

**Lectura**: tres de los ocho (SKWD, JAZZ, XMTR) **incumplen la condición mínima
que tú mismo fijaste** —«al menos dos caídas, la segunda menor»— a fecha del 14
de agosto: llevan una. Un cuarto (BUD) no tiene caídas decrecientes sino
alternas. El quinto (APGE) no tiene caídas. Con este juego de etiquetas, **el
techo alcanzable no es 8 de 8 sino 4 de 8**, y solo si se acepta BUD.

Hay una explicación probable para SKWD y JAZZ que merece comprobarse: los dos
**rompieron su base a principios de agosto y han vuelto dentro del rango**. Lo
que se etiquetó como «base» pudo ser la base previa a la ruptura, que a 14 de
agosto ya no es la estructura vigente. Si el producto quisiera describir eso
haría falta un tercer estado —«rompió una base de N semanas el día X»—, que es
una decisión de producto, no de medición.

### C.3 Los 43 etiquetados sin base

**2 falsos positivos** (4,7%), frente a 0 sobre 60 del primer intento:

| Valor | semanas | contracciones | pivote | dist. | volumen por tramo | lectura |
|---|---|---|---|---|---|---|
| **WOR** | 7,8 | 17,1 → 6,6 → 5,0 | 59,66 | −1,7% | 1,93× → 0,70× → 0,66× | Cumple el manual: tres contracciones decrecientes desde el máximo absoluto, precio en el 69% alto del rango, volumen que seca. Si esto es un falso positivo, la etiqueta merece revisarse. |
| **DLR** | 3,2 | 10,8 → 3,2 | 196,51 | +1,9% | 1,17× → 0,65× | Base de 3,2 semanas, el mínimo que admite Minervini (3). Estructura correcta pero corta y ya rota al alza. Subir el mínimo a 4 semanas la quita. |

Los otros 41 se rechazan. Los doce que engañaron a la parametrización laxa del
primer intento —BEKE, DLR, LNG, HBM, DHR, ES, WOR, SPXC, RIO, TECK, FANG,
CCNE— quedan hoy en dos: DLR y WOR.

### C.4 El corpus del proyecto

Nueve casos con fecha `asOf` dentro del histórico disponible, etiquetados por el
proyecto y no por mí:

| Caso | esperado | v1 | **v2** | contracciones v2 |
|---|---|---|---|---|
| 3988.HK 2026-05-28 | plan | ✗ | **✗** | sin ancla: ninguna caída llega a θ₁ (ATR 1,84%) |
| COST 2026-05-07 | watch | ✓ | **✗** | 8,0 → 2,5 → 6,6 → 7,9 → 5,7 → 7,5 → 8,9 → 6,2 → 4,2 → `depth_reexpansion` |
| WELL 2026-05-14 | watch | ✗ (35,8 sem, 1 contracción) | **✓ 12,4 sem** | **10,7 → 7,5 → 5,0** |
| BRK-B 2026-06-02 | block | ✓ | **✓** | reexpansión + mitad baja |
| 3988.HK 2026-06-03 | block | ✓ | **✓** | `price_still_advancing` |
| ISRG 2026-06-02 | block | ✓ | **✓** | una sola caída del 34,3% |
| AAPL 2026-06-01 | block | ✓ | **✓** | `price_still_advancing` |
| META 2026-06-02 | block | ✓ | **✓** | reexpansión, suelo cediendo, pivote 19,1% bajo techo |
| MSFT 2026-06-02 | block | ✓ | **✓** | 11,2 → 4,7 → 35,4: la última es la mayor |

**7 de 9 igual que v1, pero con un cambio de fondo**: v1 acertaba COST y fallaba
WELL; v2 acierta WELL y falla COST. Y el acierto de WELL es de otra naturaleza.
Conviene ser preciso con la procedencia de la comparación:

- [`docs/methodology/vcp-corpus.json`](methodology/vcp-corpus.json) **no guarda
  profundidades**. Para WELL@2026-05-14 pide `minContractionCount: 3`,
  `contractionsDecreasing: true`, estructura `ok`, y su etiqueta humana dice
  «tres contracciones decrecientes cerca del pivote». v2 devuelve exactamente
  tres, decrecientes, con el precio a −0,5% del pivote: **cumple lo que el corpus
  exige**.
- La terna concreta `10,2% → 7,5% → 5,0%` aparece en el documento del 17 de
  agosto, que la atribuye al corpus; **no está en el fichero del corpus** y no he
  encontrado otra fuente en el repo, así que la trato como la medición anotada en
  aquel documento, no como verdad terreno humana. v2 mide `10,7 → 7,5 → 5,0`:
  las dos últimas coinciden a la décima y la primera difiere en 0,5 pp.

Es el caso que el primer intento señaló como «fallo real» —medía 35,8 semanas
donde la real ronda las 12— y **está resuelto**: v2 mide 12,4.

COST y 3988.HK son valores de volatilidad muy baja (ATR 1,89% y 1,84%) cuyas
correcciones más profundas —6,7% y 5,1%— quedan por debajo del suelo de θ₁ (8%).
Medido bajando ese suelo:

| Suelo de θ₁ | COST 2026-05-07 | 3988.HK 2026-05-28 | corpus | falsos positivos |
|---|---|---|---|---|
| 8% (elegido) | 44 sem, reexpansión | sin ancla | 7/9 | 2/43 |
| 6% | 4,2 sem, **6,7 → 3,1 → 3,9**, rechazada solo por `no_prior_advance` | sin ancla | 6/9 | 3/43 |
| 4 – 5% | igual que con 6% | 2,0 sem, una contracción del 5,1% → `too_short` | 6/9 | 3/43 |

Es decir: **bajar el suelo no recupera ninguno de los dos y además pierde WELL**
(el corpus baja de 7 a 6). COST queda a 2,1 puntos de la puerta de avance previo
—subió un 22,9% en las 130 sesiones anteriores, frente al 25% exigido— y con esa
puerta desactivada sí sale base con `6,7 → 3,1 → 3,9`. 3988.HK no sale con ningún
ajuste del suelo: su estructura son caídas de 4,6% → 3,5% → 5,1% mientras el
techo sube entre un 1,3% y un 2,5% por escalón, que es justo la zona gris de
±2-3% identificada en B.4. **Limitación real y conocida: el detector está
calibrado para valores con ATR ≥ ~3%.**

### C.5 El caso que anticipaba el dueño: tendencias en escalones (punto 7)

Dos cohortes seleccionadas mecánicamente del mismo escaneo, semilla 20260818:

- **Escalera alcista**: etapa 2, a ≤3% del máximo de 52 semanas, +40% o más a 12
  meses → 139 valores, muestra de 15.
- **Escalera bajista**: etapa 4, −25% o peor a 12 meses → 123 valores, muestra
  de 15.

| Cohorte | marcadas como base | motivo dominante |
|---|---|---|
| Alcista (15) | **1** (NTRS) | 12 de 15 → `price_still_advancing`; MT → `depth_reexpansion`; INSW → una sola contracción |
| Bajista (15) | **0** | `price_in_lower_half` (15/15), `too_deep` (15/15), `fewer_than_2_contractions` (8/15), `depth_reexpansion` (6/15) |

El único positivo, NTRS, no es un diente de sierra al mirarlo: subió a 190 y
lleva cuatro semanas entre 178 y 190 con contracciones 8,6 → 3,8. La cohorte se
eligió por criterios mecánicos («cerca de máximos y con tendencia»), y eso no
excluye que un valor esté consolidando dentro de ella.

Y con series sintéticas, que aíslan el fenómeno sin ruido (B.4): **rechazadas
todas las escaleras a partir de ±3% de avance neto por escalón**; el VCP de
manual (31 → 17 → 8 → 3) y la base plana (12 → 6 → 3) se detectan.

### C.6 Sobre cuántas filas del universo saldrían con base

Muestra aleatoria de **160 valores líquidos** del mismo escaneo (semilla
20260820), a 2026-08-14: **5 con base = 3,1%**. Extrapolado a los 2.223 líquidos
serían unos 70 valores. Los cinco: MGA (10,2 sem, 10,6 → 6,3), GNK (13,2 sem,
13,6 → 9,3 → 7,9 → 7,5 → 8,4), REYN (6,2 sem, 8,0 → 4,4), MRCY (6,0 sem,
30,0 → 7,9) y FRO (7,4 sem, 20,8 → 9,1 → 7,5).

Mirados a ojo: MGA, REYN y FRO parecen bases; **GNK es un rectángulo** (cinco
contracciones de profundidad parecida, la última mayor que la anterior dentro de
la tolerancia del 15%) y **MRCY es una uve** (cae 30% y recupera en cinco
semanas), el caso que Minervini llama compresión de tiempo. Con 5 de 160, dos
discutibles, **la precisión real estaría en torno al 60%**, no en el 95% que
sugiere el 2 sobre 43.

Reparto de motivos de rechazo en esa muestra (un valor puede acumular varios):

| Motivo | % de la muestra |
|---|---|
| `price_in_lower_half` | 54,4% |
| `depth_reexpansion` | 36,9% |
| `fewer_than_2_contractions` | 33,8% |
| `trend_saw_tooth` | 28,1% |
| `too_deep` | 22,5% |
| `irregular_structure` | 18,1% |
| `pivot_far_below_ceiling` | 16,9% |
| `lower_low_drift` | 16,9% |
| `no_prior_advance` | 14,4% |
| `price_still_advancing` | 13,1% |

### C.7 Qué aporta cada pieza (ablación)

Sobre los tres conjuntos a la vez, quitando una puerta cada vez:

| Variante | 8 etiquetados | falsos positivos /43 | corpus /9 |
|---|---|---|---|
| **v2 completo** | **3** | **2** | **7** |
| sin puerta de reexpansión | 3 | **5** | 7 |
| sin puerta «mitad alta» | 3 | **4** | 7 |
| sin puerta pivote ≤12% bajo techo | 3 | **3** | 7 |
| tolerancia de techo fija 3% (no relativa) | 3 | 2 | **6** (pierde WELL) |
| tolerancia de techo fija 10% | 3 | **3** | 7 |
| sin cierre por retroceso del 50% | **2** (pierde DAL) | 2 | 7 |
| umbral de contracción fijo (α=1,0) | **0** | 0 | 6 |
| sin puerta de eficiencia (`trend_saw_tooth`) | 3 | 2 | 7 |
| sin puerta de deriva del suelo | 3 | 2 | 7 |
| sin puerta de profundidad ≤35% | 3 | 2 | 7 |
| sin puerta de avance previo ≥25% | 3 | 2 | 7 |
| sin puerta techo ≥88% del máximo anual | 3 | 2 | 7 |

Y sobre las cohortes de tendencia: quitar a la vez eficiencia, deriva del suelo,
mitad alta y profundidad **no cambia ni un veredicto** (sigue 1/15 y 0/15). El
rechazo de las escaleras lo hace el ancla, no las puertas de respaldo.

Conclusiones de la ablación, en orden de importancia:

1. **El umbral adaptativo de contracción (α) es el corazón del método.** Con
   umbral fijo no se detecta nada: 0 de 8.
2. **El cierre por retroceso del 50%** vale un verdadero positivo.
3. **La puerta de reexpansión** es la que más falsos positivos evita (de 5 a 2).
4. **La tolerancia de techo relativa** vale un caso del corpus.
5. **Tres puertas no deciden nada** en los 90 casos reales probados (8 + 43 + 9
   + 30 de las cohortes): eficiencia, deriva del suelo y profundidad máxima.
   Aparecen en los motivos de rechazo —la eficiencia en el 28,1% de la muestra
   del universo— pero siempre acompañadas de otro motivo que ya rechaza. La de
   avance previo tampoco cambia nada con esta parametrización, pero **sí decide
   cuando se baja el suelo de θ₁**: es la que deja fuera a COST (C.4). Recomiendo
   implementar solo lo que decide y dejar el resto como dato medido.

### C.8 Fragilidad: qué pasa si se mueve un parámetro

No todo es estable. El parámetro más sensible es el retroceso de cierre:

| `retraceFrac` | 8 etiquetados | falsos positivos | corpus |
|---|---|---|---|
| 0,35 – 0,40 | 2 | 3 | 7 |
| **0,45 – 0,55** | **3** | 1 – 3 | 7 |
| 0,60 – 0,70 | 1 | 1 – 2 | 7 |

DAL entra y sale del resultado en una ventana de ±0,05 alrededor de 0,50. El
valor 0,50 no está elegido por rendimiento: es «la mitad», que es lo que dice el
libro. Pero conviene saber que la tercera detección se apoya en un parámetro con
esa holgura.

### C.9 La variante que descarté, y por qué

La lectura más literal de «solo interesa la última corrección visible» sería:
probar los máximos candidatos del más reciente al más antiguo y quedarse con el
primero que produzca un patrón válido. La implementé (`anchorPolicy=latest_valid`)
y la medí:

| Política de ancla | 8 etiquetados | falsos positivos /43 | corpus /9 |
|---|---|---|---|
| `highest_connected` (la elegida) | 3 | **2** | 7 |
| `latest` (el máximo más reciente) | 3 | 4 | 7 |
| `earliest_connected` (el más antiguo) | 2 | 1 | 7 |
| `latest_valid` (probar hasta que salga) | 3 | **8 a 12** | 7 |

Buscar hasta que salga algo **cuadruplica los falsos positivos**. Es la misma
enfermedad del primer intento —elegir entre bases anidadas— con el signo
cambiado. La regla geométrica sin búsqueda es la que hay que usar.

---

## PARTE D — Los datos: la limpieza de barras no está completa

Preguntabas si el primer intento se vio afectado por las barras no diarias.
Respuesta en dos partes, las dos comprobadas.

### D.1 Siguen habiendo barras mensuales en `daily_bars`, hoy

Descargué las barras de los 62 símbolos de la prueba y busqué la firma de una
barra agregada: **volumen ≥ 20× la mediana de las 21 barras vecinas y rango ≥ 5×
la mediana**, o fecha en fin de semana. Resultado: **16 barras en 7 símbolos**.

| Símbolo | Barras agregadas | Fechas |
|---|---|---|
| AAPL | 4 | 2025-03-01, 2025-06-01, 2025-09-01, 2026-03-01 |
| WELL | 4 | idem |
| MSFT | 4 | idem |
| XOM | 1 | 2026-01-01 |
| MCD | 1 | 2026-01-01 |
| COST | 1 | 2026-01-01 |
| 3988.HK | 1 | 2026-01-31 |

La firma no es ambigua. La barra de COST del 1 de enero de 2026:

```
2025-12-31  o=860,78  h=864,19   l=857,56  c=858,55  v=  1.490.000
2026-01-01  o=859,89  h=1026,95  l=851,26  c=994,99  v=136.496.800   ← 58× volumen, 14× rango
2026-01-02  o=857,36  h=859,31   l=848,75  c=850,75  v=  2.373.400
```

Es la barra **mensual de enero** guardada con fecha del día 1 —que en 2026 fue
festivo—. El umbral separa limpio: los huecos de resultados reales de la muestra
(NN, VRDN, ELE, BOX, XMTR, QURE) llegan a **12× de volumen y 8× de rango**; las
agregadas están en **58×–99× y 8×–23×**.

En toda la tabla quedan filas en fechas imposibles: **867 el 2026-01-01**, **753
el 2026-02-01** (domingo) y **764 el 2026-03-01** (domingo). La mayoría de las de
domingo son `.AX` —752 de 764—, que es un fenómeno distinto y documentado aparte;
las que importan aquí son las que no lo son: 115 el 1 de enero (donde conviven
valores de Tel Aviv y de India, que sí cotizan ese día, con casos claramente
falsos como NVO —rango del 45%— o XOM) y 12 el 1 de marzo.

**Por qué siguen ahí**: el guard que se añadió en `a24957c`
([`lib/dailyBarsCache.js:74`](../lib/dailyBarsCache.js:74)) rechaza un *payload*
cuya **mediana** de separación entre barras sea ≥6 días naturales. Un payload de
400 barras diarias con 9 mensuales incrustadas tiene mediana de 1 día: **pasa el
guard**. Protege contra series enteramente mensuales, no contra las mezcladas.
Y los 7 símbolos afectados son precisamente los «referenciados» —los que el
usuario ha abierto en la ficha y se piden con histórico largo—, que es donde el
proveedor degrada la granularidad.

### D.2 Qué efecto tuvo, medido

Comparación directa: v2 con y sin el filtro de barras agregadas, mismo código y
mismos parámetros.

| Caso | Con barras agregadas | Filtradas | Comentario |
|---|---|---|---|
| WELL 2026-05-14 | base 10,8 sem, **13,7** → 7,5 → 5,0 | base 12,4 sem, **10,7** → 7,5 → 5,0 | el documento anterior anotó **10,2** → 7,5 → 5,0: la medición limpia se le acerca, la sucia infla 3,5 pp la primera contracción |
| COST 2026-05-07 | base 17,6 sem, **cero contracciones** (ancla sobre la barra falsa del 1 de enero) | 44 sem, 9 contracciones, rechazada por reexpansión | mismo veredicto, diagnóstico distinto |
| AAPL 2026-06-01 | 13,0 sem, contracción del 22,1% | `price_still_advancing` | mismo veredicto |
| MSFT 2026-06-02 | 38,2 sem, una contracción del 35,5% | 42,2 sem, 11,2 → 4,7 → 35,4 | mismo veredicto |
| Los 8 + los 43 | 3 / 2 falsos | 3 / 2 falsos | **idéntico** |

**Conclusión, en respuesta directa a la pregunta**:

- **El 2 de 8 del primer intento NO se debe a las barras contaminadas.** Ninguno
  de los 51 símbolos recuperables de aquella muestra tiene barras agregadas: son
  valores corrientes, con 400 barras diarias limpias.
- **El corpus sí estaba contaminado**, y sigue estándolo: 4 de los 6 símbolos
  estadounidenses del corpus llevan entre 1 y 4 barras mensuales. El caso WELL
  —el que el primer intento señaló como fallo real— se medía sobre datos sucios,
  y con datos limpios la primera contracción cambia 3,5 puntos.
- Los datos de hoy **no** son más limpios en estos siete símbolos. Lo son en el
  resto.

### D.3 Dos avisos sobre la firma que uso, antes de que nadie la copie

1. **Mi filtro tira las barras de fin de semana, y eso sería destructivo fuera de
   Estados Unidos.** Ninguno de los 62 símbolos de esta prueba es australiano, así
   que aquí no hace daño; pero las filas `.AX` en domingo **son sesiones reales**
   desplazadas por la conversión a UTC, y borrarlas destruiría mercado. Mi filtro
   sirve para este experimento, no como regla general.
2. **Hay una firma mejor que la mía y ya está documentada en el proyecto**:
   frontera de mes más volumen igual a la suma de los volúmenes diarios de ese
   mes (±5%). Es exacta; la mía —20× volumen y 5× rango sobre la mediana de las
   21 vecinas— es un umbral empírico que solo he verificado contra estos 62
   símbolos, donde separa limpio (agregadas 58×–99×, huecos de resultados reales
   hasta 12×), pero que en valores ilíquidos daría falsos positivos.

### D.4 Recomendación de datos (fuera del alcance de este documento)

Dos cosas, ninguna de las cuales he hecho:

1. **Terminar de borrar las filas agregadas.** Quedan al menos las 16 de la tabla
   de D.1, en símbolos que el usuario abre a menudo.
2. **Filtrar por barra, no solo por payload**, al escribir, con la firma exacta
   del punto 2 de D.3 —no con la mía—.

---

## PARTE E — Veredicto y qué haría falta

### E.1 El veredicto, con la cifra

**No lo resuelve.** De 2 de 8 a **3 de 8** en sensibilidad, y de 0 falsos
positivos sobre 60 a **2 sobre 43**. En el corpus, 7 de 9 en los dos casos, con
el caso difícil (WELL) resuelto y uno fácil (COST) perdido por dos puertas a la
vez: el suelo de volatilidad y el avance previo, que lo deja fuera por 2,1
puntos.

Lo que sí queda resuelto, y no es poco:

- **La elección de base.** WELL pasa de 35,8 semanas con una contracción a 12,4
  con `10,7 → 7,5 → 5,0`, que reproduce el corpus. El «fallo real» que el primer
  intento aisló ya no está.
- **La distinción contra dientes de sierra.** 0 de 15 en tendencia bajista, 1 de
  15 en alcista, todas las escaleras sintéticas rechazadas desde ±3% por escalón.
  El criterio es una sola regla —el ancla tiene que seguir tapando el precio— y
  no cuatro puertas acumuladas.
- **La medición.** El zigzag de dos umbrales mide lo que el libro describe, y se
  puede auditar contra sus propios ejemplos.

Lo que no queda resuelto:

- **La sensibilidad**, con la salvedad grande de que cinco de los ocho casos no
  son alcanzables con la condición mínima que tú fijaste.
- **La precisión real es peor que el 2 sobre 43.** En una muestra aleatoria de
  160 valores sin etiquetar, de las 5 bases que marca hay 2 discutibles: un
  rectángulo (GNK) y una uve (MRCY). Eso apunta a un 60% de precisión, no a un
  95%.
- **Los valores tranquilos quedan fuera.** Con ATR por debajo del 2% —mega
  capitalizaciones, bancos, algunos ETF— sus correcciones más profundas no llegan
  al suelo de θ₁ del 8%. Es lo que deja fuera a COST y 3988.HK, y bajar el suelo
  no basta (C.4).

Con esas cifras, **mi recomendación sigue siendo no poner «semanas de base» ni
«distancia al pivote» en la tabla**. Un 3,1% de filas marcadas con un 60% de
acierto significa que de cada diez bases que muestre el producto, cuatro no lo
son. El principio 7 sigue aplicándose.

### E.2 Qué haría falta, en orden

1. **Volver a etiquetar con la regla escrita delante.** Es el paso que más vale y
   el más barato. La conclusión central de este documento es que el juego de
   etiquetas y la condición de las dos caídas no coinciden en 4 de 8 casos.
   Propuesta concreta: revisar SKWD, JAZZ, XMTR y BUD con la pregunta «¿dónde
   está la segunda caída, y es menor que la primera?», y decidir si la etiqueta o
   la regla es la que hay que cambiar. Sin eso, cualquier número de sensibilidad
   que produzca es aritmética sobre una vara que no está calibrada.
2. **Ampliar el juego a 25-30 casos actuales**, etiquetados por ti y con la fecha
   de corte fijada. Con 8 positivos, cada acierto vale 12,5 puntos y el ruido
   domina: la diferencia entre 2/8 y 3/8 es un solo valor.
3. **Decidir el tercer estado**: «rompió una base de N semanas el día X». Es lo
   que explicaría SKWD y JAZZ, y es una decisión de producto.
4. **Resolver los valores tranquilos, pero no bajando el suelo de θ₁ sin más**:
   está medido en C.4 que bajarlo a 4-6% no recupera ni COST ni 3988.HK y
   además pierde WELL. Lo que sí desbloquea COST es la puerta de avance previo,
   que lo deja fuera por 2,1 puntos. Dos vías por probar, ninguna probada aquí:
   hacer θ₁ proporcional al ATR sin suelo y añadir una amplitud mínima de base
   (por ejemplo, profundidad ≥ 6%) para que un rango del 1,7% como el de APGE no
   cuente; o sustituir el avance previo por la puerta de etapa 2, que es lo que
   el libro pide de verdad.
5. **Poner la puerta de etapa 2 antes del detector**, como hace el libro. Ya se
   calcula. Aviso para no venderlo de más: en la configuración final **no habría
   quitado ninguno de los dos falsos positivos** —DLR y WOR son los dos etapa 2—;
   lo que hace es reducir a menos de la mitad la población sobre la que corre el
   detector y quitar un falso positivo (DHR) que sí aparecía con otros ajustes.
6. **Implementar solo lo que decide**: umbral adaptativo, cierre por retroceso,
   reexpansión, mitad alta, pivote bajo techo, tolerancia de techo relativa y
   avance previo (esta última decide COST cuando se baja el suelo de θ₁). Las
   otras tres —eficiencia, deriva del suelo y profundidad máxima— no cambian
   ningún veredicto en los 90 casos reales probados con esta parametrización, y
   añaden superficie que mantener.
7. **Y una prueba que nadie ha hecho todavía**: mirar qué pasó DESPUÉS. Ninguno
   de los dos documentos tiene un solo dato de rendimiento posterior. Detectar
   bien un patrón no dice nada sobre si el patrón sirve.

### E.3 Reproducibilidad

El prototipo vive en el directorio temporal de la sesión, fuera del repo y sin
dependencias del producto: `vcp2.py` (el detector, reproducido en el apéndice),
`barlib.py` (carga y limpieza de barras) y los guiones de prueba (`eval.py`,
`corpus.py`, `trendtest.py`, `synth.py`, `universe.py`, `ablation.py`,
`sweep*.py`, `forceanchor.py`). Las consultas a Supabase han sido todas de
lectura (`GET /rest/v1/...`). El escaneo de referencia
(`cea57d44-6424-42fc-bd55-93fe8153f346`, 3.312 filas del 17-08-2026) sigue en la
base y la muestra de 44 se reproduce con `random.seed(20260817)` sobre la
población de 2.223 ordenada por símbolo.

---

## CONFIANZA

**Alta** (medido, con el procedimiento descrito y reproducible):

- Los números del libro de la Parte A: son citas literales con página impresa y
  de PDF, extraídas de los dos PDF de `research/books/`.
- Los resultados de la Parte C sobre los 8 + 43 + 9 + 30 + 160 casos: una sola
  parametrización, sin ajustes por caso, con la fecha de corte fijada en
  2026-08-14 (2026-05/06 para el corpus).
- **Que cinco de los ocho no son detectables con ningún ajuste**: 1.800
  combinaciones de parámetros en dos barridos, más la prueba de anclas forzadas
  candidato a candidato. Es la afirmación que más he intentado tumbar.
- Que WELL mide `10,7 → 7,5 → 5,0`, que cumple lo que el corpus exige (tres
  decrecientes cerca del pivote) y coincide dentro de 0,5 pp con la terna anotada
  en el documento del 17 de agosto. **Ojo**: esa terna no está en el fichero del
  corpus; la comparación es contra una medición previa, no contra una etiqueta
  humana.
- Las barras agregadas de la Parte D: firma de volumen y rango, verificada barra
  a barra en COST, y separación limpia frente a los huecos de resultados reales.
- Que la muestra aleatoria de 44 del primer intento se reproduce exactamente
  (población de 2.223 y los doce primeros nombres en el mismo orden).

**Media** (fundamentado, con juicio de por medio):

- Los umbrales: θ₁ = 2,5·ATR con suelo del 8%, α = 0,25, retroceso de cierre del
  50%, tolerancia de techo = 0,4 × la caída, reexpansión del 15%. Salen de
  traducir reglas del libro a números, y la traducción es mía. El más frágil es
  el retroceso de cierre (C.8).
- Mi lectura de que WOR es una base y la etiqueta humana está equivocada. Cumple
  el manual, pero no soy quien etiquetó.
- La estimación de precisión del 60% sobre la muestra de 160: se apoya en mi
  juicio visual de cinco gráficos, no en etiquetas independientes.
- La atribución de SKWD y JAZZ a «rompieron base y volvieron al rango». Es
  coherente con los datos pero no lo he verificado con la definición formal de
  ruptura.

**Baja** (opinión declarada como tal):

- Que volver a etiquetar sea lo que desbloquee el problema. Es mi diagnóstico.
- Que el estado «rompió una base» sea útil en el producto.
- Que 3 semanas sea un mínimo prudente para un screener, aunque sea el del libro.
  Los dos casos de 3,2 semanas que he visto (DLR) eran discutibles.

---

## LO QUE NO HE VERIFICADO

1. **No he ejecutado el detector de producción (`setupPatternForBars`)** para
   compararlo lado a lado. Las cifras de v1 que aparecen aquí están tomadas del
   documento del 17 de agosto, no de una ejecución mía. Lo que sí he vuelto a
   ejecutar sobre los mismos símbolos y fechas es el prototipo v2.

2. **Los 17 casos del estrato dirigido que no se recuperan.** El primer intento
   midió 0 falsos positivos sobre 60; yo mido 2 sobre 43. No sé qué habría pasado
   con esos 17, y por tanto **las dos cifras de falsos positivos no son
   estrictamente comparables**.

3. **Las etiquetas de los 8 y los 43 son de un solo observador y de otra sesión.**
   No hay doble ciego. Este documento argumenta que cuatro de ellas son
   incompatibles con la regla, pero es un argumento, no una verificación.

4. **No he medido el coste de cálculo.** El prototipo es Python; el detector de
   producción es JavaScript. El documento anterior midió 0,12 ms por símbolo para
   una versión distinta del algoritmo. El v2 hace más trabajo (barrido de
   candidatos a ancla), y aunque sigue siendo lineal, no puedo afirmar la cifra.

5. **No he probado fuera de Estados Unidos**, salvo 3988.HK. No sé cómo se
   comporta con la liquidez y los huecos de Japón, Australia o Europa. Las barras
   de domingo de `.AX` que aparecen en la Parte D son un ejemplo de que ahí hay
   fenómenos distintos.

6. **No he verificado el efecto de los splits.** El prototipo usa `close` sin
   ajustar, igual que el detector actual. Un split no ajustado dentro de la
   ventana crearía una «contracción» del 50% que no existió. Los dos documentos
   abiertos sobre esto (`docs/splits-daily-bars-2026-08-09.md`,
   `docs/splits-eventos-2026-08-09.md`) siguen sin leerse.

7. **No he tocado el arnés del corpus** (`npm run audit:vcp:corpus`), que descarga
   barras en vivo. Los 9 casos que uso son los que se pueden reproducir desde
   `daily_bars`; los otros 9 del corpus tienen fechas de 2022-2025, fuera de las
   400 barras retenidas.

8. **No hay ni un dato de rendimiento posterior.** Nada en este documento dice si
   las bases detectadas anticipan algo.

9. **No he borrado ni corregido ninguna barra.** Las 16 barras agregadas se
   filtran en el prototipo, en memoria; en la base siguen exactamente igual.

---

## APÉNDICE — Las dos funciones que no se pueden reconstruir del texto

El resto del prototipo son puertas de umbral, que están todas en B.5 y B.7. Estas
dos son el método y van aquí para que el documento sea autosuficiente cuando el
directorio temporal desaparezca. Python, sin dependencias.

```python
def find_anchor(bars, p, theta1):
    """El último máximo relativo relevante: el más alto de los máximos que
    (a) llevan detrás una corrección de al menos theta1 y (b) siguen tapando
    el precio, con una tolerancia proporcional a esa corrección."""
    n = len(bars); last = n - 1
    fut = [0.0]*n; m = 0.0                 # máximo posterior a cada posición
    for i in range(n-1, -1, -1):
        fut[i] = m; m = max(m, bars[i]["h"])
    fmin = [None]*n; mn = float("inf")     # mínimo posterior a cada posición
    for i in range(n-1, -1, -1):
        fmin[i] = mn; mn = min(mn, bars[i]["l"])
    cands = []
    for i in swing_highs(bars, p["swingRadius"]):        # máximos locales, radio 3
        if last - i < p["minLegBars"] or last - i > p["maxBaseBars"]: continue
        h = bars[i]["h"]
        dd = (h - fmin[i]) / h * 100                     # corrección que siguió
        if dd < theta1: continue                         # no hubo corrección real
        up = (fut[i] / h - 1) * 100                      # cuánto lo superó después
        allowed = min(p["maxCeilRisePct"], max(p["minCeilRisePct"], p["ceilRiseFrac"] * dd))
        if up > allowed: continue                        # techo roto: escalera, no base
        cands.append(i)
    if not cands: return None, []                        # → price_still_advancing
    return max(cands, key=lambda i: (bars[i]["h"], -i)), cands   # el techo de la base


def measure_contractions(bars, i0, p, theta1):
    """Zigzag de dos umbrales desde el ancla i0.
    ABRE una contracción cuando la caída desde el máximo del tramo supera el
    umbral vigente (theta1 la primera; alpha·profundidad_anterior las siguientes).
    CIERRA cuando el precio recupera retraceFrac de esa caída: sin esa segunda
    condición, los rebotes internos parten una corrección en contracciones falsas."""
    last = len(bars) - 1
    cs = []
    H, hi = bars[i0]["h"], i0
    L, li = bars[i0]["l"], i0
    thr = theta1
    open_c = False
    i = i0 + 1
    while i <= last:
        b = bars[i]
        if b["l"] < L: L, li = b["l"], i
        depth = (H - L) / H * 100
        if not open_c:
            if depth >= thr and li - hi >= p["minLegBars"] - 1:
                open_c = True
            elif b["h"] > H:                              # el máximo del tramo sube
                H, hi = b["h"], i
                L, li = b["l"], i
        if open_c and i > li and b["h"] >= L + p["retraceFrac"] * (H - L):
            cs.append(dict(hi=H, lo=L, hIdx=hi, lIdx=li, depth=depth, confirmed=True))
            if len(cs) >= p["maxContractions"] + 3: break     # tope de seguridad
            thr = max(p["minNextPct"], p["alpha"] * depth)   # la escala se encoge
            H, hi = b["h"], i
            L, li = b["l"], i
            open_c = False
        i += 1
    depth = (H - L) / H * 100                              # retroceso en curso
    if open_c and (not cs or li > cs[-1]["lIdx"]):
        cs.append(dict(hi=H, lo=L, hIdx=hi, lIdx=li, depth=depth, confirmed=False))
    return cs
```

El pivote es `cs[-1]["hi"]` —el máximo de la última contracción, esté cerrada o en
curso—; las puertas de estructura se aplican solo a las que tienen
`confirmed=True` (B.2).
