# Diseño: contracciones de volatilidad, tercer intento — sacudidas y zona de salida

<!-- fecha interna: 2026-08-18 · escrito el 2026-08-20 · BASE_SHA: b9b13de · rama: codex/statsedge-ui-polish -->

Documento de **diseño y medición**. No modifica código del producto, no escribe
en Supabase y no ejecuta ningún escaneo. El prototipo vive fuera del repo.

Continúa [`v2`](diseno-contracciones-v2-2026-08-18.md) y
[`v1`](diseno-contracciones-2026-08-17.md). Lo que trae de nuevo:

1. **Las sacudidas dejan de ser motivo de rechazo.** Las fuentes primarias no
   solo las admiten: las piden, y consideran defecto su ausencia.
2. **Zona de salida adaptativa**, la idea del dueño: una banda alrededor del
   rango de consolidación, calculada a partir de la volatilidad del valor y de
   la amplitud del propio rango. Lo que queda fuera de la banda no es patrón.
3. **La banda no se ha puesto a ojo: se ha ajustado sobre 48.774 rupturas y
   39.818 perforaciones reales** del universo líquido. La escala sub-lineal que
   proponía el dueño queda confirmada por los datos, con matices.
4. **Prueba hacia delante**, que ni v1 ni v2 hicieron: detectar a una fecha
   pasada y mirar qué hizo el precio después, en tres cortes distintos.

---

## Resumen para el dueño (sin jerga)

1. **Las fuentes te dan la razón, y con más fuerza de la que esperabas.** No solo
   admiten las sacudidas: O'Neil dice que un asa **sin** sacudida —cuyos mínimos
   suben «en cuña» en vez de ceder— es *propensa al fallo*, y que un doble suelo
   que no perfora el primer mínimo es **defectuoso**. Minervini quiere ver una,
   dos o tres. La puerta `lower_low_drift` del detector actual rechaza el rasgo
   que las tres fuentes consideran señal de calidad.

2. **Y los datos lo confirman**: de las **39.818 perforaciones de mínimo** que
   hay en el universo líquido, **el 53% se recuperan**. Tratarlas como rotura era
   equivocarse más de la mitad de las veces.

3. **Tu idea de la zona de salida funciona, y la he calibrado con 48.774
   rupturas reales** en vez de ponerle un número a ojo. La escala sub-lineal que
   proponías se confirma: una acción diez veces más volátil necesita **3,5 veces**
   más margen por arriba y **6,3 veces** por abajo, no diez. La forma logarítmica
   empata con una potencia dentro del ruido —**no era mala idea, es
   indistinguible de la mejor**— y las dos ganan a un umbral fijo, aunque por
   poco (Youden 0,25 frente a 0,24).

4. **Pero lo que de verdad subió la precisión fue otra cosa**, y estaba en el
   libro desde el principio: *cuanto más honda es la corrección, más tiempo
   necesita la base* (TLSMW p.212). Escrito como
   `semanas ≥ 3 + 0,8·(profundidad − 15)`, esa sola regla explica **diez de los
   doce falsos positivos** que encontré revisando detecciones a ojo.

5. **La precisión, medida en serio esta vez**: revisé **36 detecciones** del
   universo completo con una lista de comprobación fijada de antemano.
   **83% de aciertos** (IC 95%: 68%-92%), frente al ~60% que estimé para v2. El
   detector marca **114 valores de 2.223 (5,1%)**.

6. **La prueba que faltaba en los dos intentos anteriores**: detecté a tres
   fechas pasadas y miré qué hizo el precio 50 sesiones después. Resultado
   honesto: **las bases no suben más que el resto del universo** (+0,66% de
   diferencia mediana, intervalo que incluye el cero), pero **caen 2,7 puntos
   menos** (intervalo que no incluye el cero). Una base es una estructura
   contenida, no una promesa de subida.

7. **La sensibilidad sobre tus 8 etiquetados sigue en 3 de 8**, y ya sabemos por
   qué: cinco de esas ocho no tienen dos caídas completas. Eso no lo arregla
   ningún algoritmo; lo arregla volver a etiquetar. En la otra dirección pasa lo
   mismo: de los cinco «falsos positivos» que v3 produce contra tus etiquetas,
   **cuatro pasan la lista de comprobación** cuando los miro uno a uno. La Parte E propone cómo, con
   números concretos: 40 positivos y 40 negativos, muestreo estratificado, y una
   casilla que obliga a señalar dónde están las dos caídas.

8. **¿Se puede poner ya en la tabla? No, por poco.** Con 83%, una de cada seis
   bases que muestre el producto no lo será. Propongo estrenarlo **en la ficha**,
   donde el usuario puede auditar el cálculo sobre el gráfico, y dejar la tabla
   para cuando el corpus nuevo permita medir de verdad.

---

## PARTE A — Qué dicen las fuentes sobre las sacudidas

El término «reconfiguración» no aparece en ninguno de los libros. El concepto
que el dueño describe —mínimos que rompen el suelo anterior dentro de la base—
se llama en las fuentes **shakeout** (sacudida) y **undercut** (perforación).
Con ese nombre sí está, y está tratado con mucho detalle.

Aviso de método: los libros tienen derechos de autor, así que **resumo sus
reglas en español** con la referencia de capítulo y página en lugar de
reproducir el texto. Los PDF de O'Neil y Weinstein en `research/books/` son
reflujos de ebook, de modo que doy el capítulo y la sección —que es lo
localizable— y entre corchetes la página del PDF tal como está en el repo.

### A.1 O'Neil: la sacudida es una característica del asa, no un defecto

*How to Make Money in Stocks*, capítulo 2 («How to Read Charts Like a Pro»),
sección **«Basic Characteristics of a Cup's Handle Area»** [PDF 185-190]:

| Regla | Contenido |
|---|---|
| Duración | el asa suele tardar **más de una o dos semanas** en formarse |
| Geometría | tiene **deriva bajista o sacudida**: el precio cae por debajo de un mínimo anterior del asa, hecho unas semanas antes, normalmente **cerca del final** del movimiento |
| Volumen | el volumen puede secarse de forma notable cerca de los mínimos del asa |
| Situación | el asa se forma casi siempre en la **mitad superior** de la base, medida del pico absoluto al mínimo absoluto de la taza, y por encima de la media de 10 semanas |
| Profundidad | la caída del asa debe contenerse en un **8-12%** desde su pico en mercados alcistas |

Y el punto que da la vuelta al criterio actual, en la misma sección [PDF 188-189]:

> Las asas que **«wedge up»** —cuyos mínimos derivan hacia arriba, o van planos,
> en vez de ir cediendo— tienen **mucha más probabilidad de fallar** cuando
> rompen a máximos. Ese comportamiento impide que el valor pase por la sacudida
> que necesita. O'Neil lo llama un rasgo de alto riesgo y avisa: desconfía de las
> asas en cuña.

Es decir: **no tener sacudida es el defecto**. La puerta `lower_low_drift` del
detector de producción rechaza justo el rasgo que la fuente exige, y es su
estado más frecuente: 33,5% de las 3.312 filas del nocturno (medido en v1).

O'Neil repite el criterio en el patrón de **doble suelo** (mismo capítulo,
sección «Recognizing a Double-Bottom Price Pattern» [PDF 226-228]): el segundo
mínimo de la «W» debe igualar el primero o, en casi todos los casos,
**perforarlo claramente por uno o dos puntos**, creando así la sacudida de los
inversores débiles; **no perforarlo produce un doble suelo defectuoso y más
propenso a fallar**.

Y lo usa como diagnóstico de un caso concreto (New England Nuclear, mismo
capítulo [PDF 288]): el asa era demasiado corta y **no bajó lo suficiente para
crear una sacudida; se fue en cuña por sus mínimos** — y la ruptura falló.

### A.2 Minervini: quiere una, dos o tres sacudidas

*Trade Like a Stock Market Wizard*, capítulo 10 («A Picture Is Worth a Million
Dollars»), sección **«Shakeouts»**, pp. 213-216 [PDF 228-231]:

- Quiere ver **una o más sacudidas** en puntos clave del periodo de construcción
  de la base; sirven para eliminar a los tenedores débiles.
- Lo **ideal es que ocurra una, dos o tres veces**, según el tamaño y la
  magnitud de la base, antes de entrar.
- Pueden darse **en los mínimos de la base, en el lado derecho y en la zona del
  asa o el pivote**.
- Razón: los soportes obvios están llenos de stops; el profesional cuenta con que
  se barran. Quien compra después de que la base haya digerido sus sacudidas
  tiene menos probabilidad de que le salten.
- Advertencia explícita en la misma sección: **una perforación no es
  automáticamente una sacudida**. Puede ser el principio de una caída sostenida.
  Por eso hay que **esperar a ver si resulta en sacudida** —es decir, si el
  precio vuelve al rango— en vez de anticiparlo.

Esa última frase es la que hace falta para programarlo: la sacudida se
**confirma después**, por la recuperación; no se declara en el momento.

En el mismo capítulo, sobre Meridian Bioscience [PDF 230-232]: la acción perforó
mínimos previos varias veces —en mayo, en julio, en octubre y dos veces más en
el asa de diciembre— y el autor lo presenta como **acumulación de evidencia a
favor**, no en contra.

Y en *Think & Trade Like a Champion*, sección 7, en el doble suelo [PDF 139]:
prefiere que el segundo mínimo **perfore** al primero, porque así sacude a más
manos débiles; y en el patrón 3-C [PDF 134]: la situación óptima es que la pausa
**derive hacia abajo hasta perder un mínimo previo**, creando la sacudida —
«exactamente lo que quieres ver» durante la formación de un asa.

### A.3 Weinstein: el límite de una sacudida es la media de 30 semanas

*Los secretos para ganar dinero en los mercados alcistas y bajistas*, capítulo 2
(«Una mirada al gráfico vale más que mil predicciones»), p. 35 [PDF 48]:

> Mientras esas oscilaciones y sacudidas fuertes ocurran **por encima de la media
> ascendente de 30 semanas**, no hay de qué preocuparse.

Es la única de las tres fuentes que da un **límite operativo** para distinguir
una sacudida de una rotura: un nivel dinámico, no un porcentaje fijo. La idea de
que el límite dependa del propio valor —y no de una constante— viene de aquí.

### A.4 Lo que se deduce para el algoritmo

1. Un mínimo que perfora un mínimo anterior **dentro de la base** es parte del
   patrón si el precio vuelve al rango. La perforación por sí sola no invalida.
2. Hay que **esperar la recuperación** para llamarlo sacudida (Minervini A.2).
   En un detector que corre cada noche, eso significa: la sacudida se cuenta
   cuando ya se ha recuperado; mientras no lo esté, es un retroceso en curso.
3. **Hace falta un límite** por debajo del cual la perforación ya no es sacudida
   sino rotura. Weinstein da un nivel dinámico; O'Neil da un porcentaje para el
   asa (8-12%); Minervini no da número. Ninguno da una regla general calculable.
   **Ese hueco es exactamente lo que la Parte B mide con datos.**
4. La **ausencia** de sacudida no invalida, pero O'Neil dice que es señal de
   riesgo. Queda como atributo medido, y en la Parte D se comprueba si eso se
   sostiene con datos.

---

## PARTE B — La zona de salida, calibrada con datos

La idea del dueño: se puede calcular una zona alrededor del rango donde el
precio **ya ha salido de la consolidación**, y esa parte no cuenta como patrón.
El umbral no puede ser un porcentaje fijo: debe depender de la volatilidad del
valor y de la amplitud del rango, y adaptarse de forma **sub-lineal** —una acción
diez veces más volátil no necesita diez veces más margen—.

En vez de elegir la forma a ojo, la he medido.

### B.1 El experimento

Sobre los **2.223 valores líquidos** del universo (los mismos del escaneo
`cea57d44`, con las barras agregadas filtradas), recogí todos los intentos de
ruptura y todas las perforaciones:

**Arriba** — cada máximo local (radio 3) con al menos 60 sesiones por delante:
1. `techo` = el máximo del pivote local; `ATR20%` calculado **en ese momento**,
   no hoy; `amplitud` = la caída desde el techo hasta el primer cierre por
   encima de él.
2. Se busca el **primer cierre por encima del techo**.
3. `despeje` = cuánto lo superó el mejor cierre de la primera semana, en %.
4. `aguantó` = 1 si **20 sesiones después el cierre sigue por encima del techo**.

**Abajo**, en espejo: cada mínimo local, el primer cierre por debajo, cuánto
perdió en la primera semana, y si 20 sesiones después seguía por debajo
(`rompió` = 1) o había recuperado (una **sacudida**, `rompió` = 0).

Resultado bruto: **48.774 rupturas** (aguantó el 63,7%) y **39.818
perforaciones** (rompió de verdad el 46,9%). Es decir: **más de la mitad de las
perforaciones de un mínimo son sacudidas**, lo que por sí solo justifica que el
detector no las trate como invalidación.

La pregunta se vuelve entonces medible: *¿qué umbral `m` hace que «despejó más
de m» prediga mejor «aguantó»?*

### B.2 Lo que dicen los datos

Umbral óptimo (máximo índice de Youden) por tramos:

**Por volatilidad, rupturas al alza:**

| ATR20% mediana | n | umbral óptimo | acierto |
|---|---|---|---|
| 1,82% | 8.130 | **1,98%** | 62,4% |
| 2,35% | 8.129 | 2,50% | 61,7% |
| 2,85% | 8.129 | 2,87% | 61,4% |
| 3,45% | 8.129 | 3,44% | 62,1% |
| 4,38% | 8.129 | 3,59% | 63,3% |
| 6,24% | 8.128 | **7,07%** | 59,2% |

**Por amplitud del rango, rupturas al alza:**

| profundidad mediana | n | umbral óptimo |
|---|---|---|
| 3,9% | 8.130 | **2,01%** |
| 5,9% | 8.129 | 2,43% |
| 8,0% | 8.129 | 3,89% |
| 10,6% | 8.129 | 3,08% |
| 14,7% | 8.129 | 3,46% |
| 23,9% | 8.128 | **3,39%** |

Leído en logaritmos: la volatilidad multiplica el umbral casi 1:1 (exponente
≈1,0), pero **la amplitud del rango lo multiplica mucho menos** (la profundidad
se multiplica por 6 y el umbral solo por 1,7: exponente ≈0,29).

**Por volatilidad, perforaciones del suelo** (¿sacudida o rotura?):

| ATR20% mediana | n | umbral óptimo | acierto |
|---|---|---|---|
| 1,87% | 6.637 | 2,92% | 65,3% |
| 2,41% | 6.636 | 3,21% | 67,1% |
| 2,92% | 6.637 | 2,98% | 65,9% |
| 3,56% | 6.636 | 3,22% | 65,0% |
| 4,50% | 6.636 | 4,71% | 65,3% |
| 6,58% | 6.636 | 5,31% | 63,7% |

Aquí sí: la volatilidad se multiplica por 3,5 y el umbral solo por 1,8
(exponente ≈0,48, prácticamente una raíz cuadrada). **Para las sacudidas, la
intuición del dueño se cumple casi exactamente.**

### B.3 Qué forma funcional gana

Ajusté cada forma maximizando el índice de Youden sobre los eventos completos
—no sobre medias por tramo—, dejando que cada una eligiera sus mejores
parámetros:

**Rupturas al alza (48.774 eventos):**

| Forma | Youden | acierto | parámetros ajustados |
|---|---|---|---|
| **potencia** `m = c·ATR^p·prof^q` | **0,2509** | 61,6% | c=0,80, p=0,55, q=0,35 |
| logarítmica `m = b₁·ln(1+ATR)+b₂·ln(1+prof/10)` | 0,2490 | 61,8% | b₁=1,6, b₂=1,4 |
| lineal en ambas | 0,2486 | 61,2% | 0,80·ATR + 0,08·prof |
| lineal solo en ATR | 0,2445 | 61,6% | 1,00·ATR |
| la de v2 `clamp(k·prof, lo, hi)` | 0,2444 | 62,0% | k=0,25, lo=2,5, hi=6,0 |
| **constante** | 0,2363 | 61,0% | 3,2% |

**Perforaciones (39.818 eventos):**

| Forma | Youden | acierto | parámetros ajustados |
|---|---|---|---|
| **potencia** | **0,3015** | 65,4% | c=1,05, p=0,80, q=0,10 |
| lineal en ambas | 0,3005 | 65,4% | 0,95·ATR + 0,02·prof |
| lineal solo en ATR | 0,2980 | 65,1% | 0,98·ATR |
| logarítmica | 0,2961 | 65,2% | b₁=1,8, b₂=1,2 |
| la de v2 | 0,2833 | 64,7% | k=0,30, lo=3,0, hi=5,0 |
| constante | 0,2789 | 64,2% | 3,45% |

**Cuatro conclusiones, y una de ellas matiza al dueño:**

1. **Adaptar sirve, pero poco.** La mejor forma adaptativa gana a la constante
   0,015 puntos de Youden arriba (0,2509 vs 0,2363) y 0,023 abajo. Es una mejora
   real y consistente, no un empate — pero es modesta. Quien esperara que la
   zona de salida resolviera el problema por sí sola se llevará una decepción.
2. **La escala sub-lineal se confirma**, con exponentes medidos: arriba
   ATR^0,55 y amplitud^0,35; abajo ATR^0,80 y amplitud^0,10. Una acción diez
   veces más volátil necesita **3,5 veces** más margen arriba y **6,3 veces**
   abajo, no diez.
3. **Logarítmica y potencia empatan** (0,2490 vs 0,2509 arriba; 0,2961 vs 0,3015
   abajo). La diferencia está dentro del ruido de la medición. La escala
   logarítmica que proponías **no es peor**; simplemente no es distinguible de
   una potencia con exponente ~0,5. Dejo la potencia por defecto porque ajusta
   marginalmente mejor en las dos direcciones, y doy los parámetros de la log
   por si prefieres esa forma: son intercambiables.
4. **Arriba y abajo no se comportan igual, y eso sí importa.** Arriba manda la
   combinación de volatilidad y amplitud; abajo manda **casi solo la
   volatilidad** (exponente de la amplitud: 0,10). Tiene sentido: una sacudida es
   un fenómeno de volatilidad —barrer stops—, no de geometría del rango. Por eso
   el detector usa **dos bandas con parámetros propios**, no una banda y un
   multiplicador.

### B.4 Cómo queda la banda

```
banda_arriba(%) = 0,80 · ATR20%^0,55 · profundidad%^0,35
banda_abajo(%)  = 1,05 · ATR20%^0,80 · profundidad%^0,10      (acotadas a [1%, 12%])
```

Valores típicos:

| Perfil | ATR20% | profundidad | banda arriba | banda abajo |
|---|---|---|---|---|
| Mega capitalización tranquila | 1,5% | 8% | 2,07% | 1,79% |
| Valor corriente | 3,0% | 15% | 3,78% | 3,32% |
| Valor volátil | 6,0% | 25% | 6,61% | 6,07% |
| Muy volátil | 8,0% | 30% | 8,26% | 7,79% |

**Y la regla de uso**: la salida se da por buena cuando hay **dos cierres
consecutivos** fuera de la banda. Un pico intradía que vuelve dentro no saca al
valor del rango — que es, en el otro sentido, la misma lógica de la sacudida.
Si la salida ocurrió hace más de **10 sesiones**, ese candidato a base queda
descartado: el precio ya se fue y esa estructura dejó de ser la vigente.

Esto es exactamente lo que resuelve el caso que v2 no sabía explicar. JAZZ, a 14
de agosto: el ancla del 5 de junio (241,99) daría una secuencia preciosa
—8,8 → 6,8 → 5,3 → 3,9— pero **el precio rompió esa base el 22 de julio** y
cerró por encima de la banda; 17 sesiones después ya no es la estructura
vigente. El detector lo descarta y se queda con el máximo del 5 de agosto, desde
el que solo hay una caída. No es «no encuentro nada»: es «esa base ya se rompió».

---

## PARTE C — El detector v3

Sobre el esqueleto de v2 (ancla = último máximo relativo relevante; contracciones
medidas con zigzag de dos umbrales), con tres cambios.

### C.1 Fuera la puerta que rechazaba las sacudidas

`lower_low_drift` desaparece. Un mínimo que perfora otro anterior **dentro de la
banda inferior** es parte del patrón; solo hay rotura cuando el precio **cierra
dos sesiones seguidas por debajo de la banda**. Y como pide Minervini (A.2), la
sacudida se cuenta *después*: `shakeoutCount` cuenta los mínimos de contracción
que perforaron un mínimo anterior de la base **y se recuperaron**.

También desaparece `trend_saw_tooth` (el ratio de eficiencia): en v2 medí que no
cambiaba ni un veredicto en 90 casos, y sigue sin cambiarlo. Una puerta que nunca
decide es superficie que mantener sin contrapartida.

### C.2 La zona de salida decide qué candidato sigue vivo

Para cada máximo candidato a ancla se mide su banda (B.4) y se busca la primera
**salida sostenida** (dos cierres consecutivos fuera). Si esa salida ocurrió hace
más de 10 sesiones, el candidato se descarta: esa consolidación ya terminó. Entre
los que quedan, el ancla es **el más alto** —el techo de la consolidación, que es
desde donde el libro mide (v2, A.2)—.

Motivo de rechazo nuevo y explícito: **`out_of_range`** — «el precio ya salió del
rango». Es distinto de «no hay estructura» y el usuario lo lee distinto.

### C.3 La profundidad exige tiempo

La regla que más aporta de todo v3, y sale de una frase del libro que ni v1 ni v2
usaron:

> «Según la profundidad de la corrección, un periodo de base propio puede durar
> desde 3 semanas hasta 65» — TLSMW p.212 [PDF 227]

Traducido a cálculo:

```
semanas_exigidas = 3 + 0,8 · max(0, profundidad% − 15)
```

Una base del 15% o menos necesita 3 semanas; una del 25%, 11; una del 35% (el
máximo admitido), 19. Motivo de rechazo: `too_short_for_depth`.

**De dónde sale la pendiente 0,8, dicho sin adornos**: la calibré mirando 30
detecciones revisadas a ojo (D.3), donde el patrón de fallo era siempre el mismo
—caída fuerte y recuperación rápida— y separaba limpiamente. Después la validé
contra tres conjuntos que no había usado para calibrarla, incluidos los datos de
rendimiento posterior. Los resultados están en D.4.

### C.4 Atributos de calidad que se miden pero no deciden

- `shakeoutCount`: sacudidas dentro de la base.
- `handleUndercut` / `handleWedgesUp`: geometría del asa según O'Neil — si sus
  mínimos menores perforan (bien) o suben en cuña (mal, según él).
- `lastContractionVolRatio`: volumen de la última contracción contra la media de
  50 sesiones.

Ninguno filtra. En D.5 se comprueba si deberían.

### C.5 Parámetros

```
θ₁ = clamp(2,5·ATR20%, 8%, 20%)          radio de swing 3     minLegBars 3
banda arriba = 0,80·ATR^0,55·prof^0,35    banda abajo = 1,05·ATR^0,80·prof^0,10
salida: 2 cierres fuera · caduca a 10 sesiones · ancla = el más alto de los vivos
contracciones: alpha 0,25 · cierre por retroceso 0,50 · reexpansión ≤1,15 · ≤6
duración ≥ 3 semanas y ≥ 3+0,8·(prof−15) · ≤45 semanas · profundidad ≤35%
precio en la mitad alta · pivote ≤12% bajo techo · precio ≤+8% sobre pivote
avance previo ≥25% en 130 sesiones · techo ≥88% del máximo de 52 semanas
```

---

## PARTE D — Las pruebas

Fecha de corte **2026-08-14** (la de las etiquetas), barras agregadas filtradas
con la firma de v2 Parte D. Universo: los mismos 2.223 valores líquidos.

### D.1 Contra los tres conjuntos de v1 y v2

| Conjunto | v1 | v2 | **v3** |
|---|---|---|---|
| 8 etiquetados con base | 2/8 | 3/8 | **3/8** (BHP, DAL, RLAY) |
| 43 etiquetados sin base | 0/60 falsos* | 2/43 | **5/43** (DLR, LNG, WOR, TECK, FANG) |
| Corpus reproducible | 7/9 | 7/9 | **7/10**† |
| Escalera alcista (15) | — | 1 | **1** |
| Escalera bajista (15) | — | 0 | **0** |
| % del universo líquido marcado | — | 4,23% | **5,13%** |

\* v1 midió sobre los 60 originales; v2 y v3 sobre los 43 recuperables. No son
estrictamente comparables (v2, «lo que no he verificado» punto 2).

† Sobre los mismos 9 casos que usaron v1 y v2, v3 saca **7/9**: acierta WELL y los
seis `block`, y falla COST y 3988.HK. El décimo caso —NVDA@2024-05-22, que los
anteriores no probaron porque necesita las 1.000 barras que ese símbolo tiene por
ser «referenciado»— lo falla, así que el total es **7/10**.

**Y aquí hay un coste que hay que decir**: sin la regla profundidad-tiempo (C.3),
v3 acertaría **8/10** — NVDA sale como base de 6,0 semanas con `16,7 → 4,3`, y la
regla lo rechaza porque una base del 21,3% de profundidad le exige 8 semanas. Es
el precio de la regla: **sube la precisión general del 60% al 83% pero cuesta un
positivo del corpus**. Con el corpus actual no puedo decidir si NVDA es la
excepción o la regla está mal calibrada; con 40 positivos etiquetados, sí.

**La sensibilidad sobre los 8 sigue en 3.** No ha cambiado y no va a cambiar:
v2 demostró con 1.800 combinaciones que cinco de esos ocho no tienen dos caídas
completas desde su último máximo. Admitir sacudidas no los recupera porque su
problema no era el suelo, sino que **no hay segunda caída**.

**Los falsos positivos suben de 2 a 5.** Los revisé uno a uno con la misma lista
de comprobación de D.3, y el resultado incomoda:

| Valor | Estructura medida | ¿Pasa la lista de comprobación? |
|---|---|---|
| WOR | 17,1 → 6,6 → 5,0; volumen 1,93× → 0,70× → 0,66×; asa con 2 perforaciones y pendiente −2,9% | **Sí, entera.** Incluida la sacudida en el asa que O'Neil exige. Yo diría que la etiqueta está mal |
| FANG | 19,6 → 9,7 → 9,3 en 10,2 semanas; precio a −0,1% del pivote; techo al 99% del máximo anual | **Sí**, aunque la segunda y la tercera contracción apenas se diferencian |
| TECK | 21,6 → 7,5 → 5,5; techo probado dos veces; precio a −6,7% del pivote | **Sí**, con reparo: el precio está lejos del pivote |
| DLR | 10,8 → 3,2 en 3,2 semanas; techo = máximo de 52 semanas; +1,9% sobre el pivote | **Sí** técnicamente; el único reparo es que 3,2 semanas es el mínimo que admite el libro |
| LNG | 9,9 → 5,4 en 3,2 semanas; techo al 92% del máximo anual, tras caer de 299 a 223 | **No**: el techo no es el operativo. Hay otro un 8% más arriba que el precio no ha reconquistado. **Falso positivo real** |

Dicho de la forma más clara posible: **de los cinco «falsos positivos» que produce
v3 contra las etiquetas humanas, solo uno falla mis propios criterios escritos.**
Los otros cuatro son desacuerdos con el etiquetado, no fallos del detector. Es la
tercera vez que este proyecto llega a la misma conclusión por un camino distinto.

### D.2 El corpus, caso a caso (tarea 6)

De los 18 casos, **10 son reproducibles** desde `daily_bars` (v2 solo pudo con 9;
NVDA@2024-05-22 entra porque ese símbolo tiene 1.000 barras por ser
«referenciado»). Los otros 8 tienen fechas de 2022-2025, fuera de las 400 barras
que se retienen.

| Caso | esperado | v3 | ¿cumple «dos caídas, la segunda menor»? |
|---|---|---|---|
| NVDA 2024-05-22 | watch | no base (`too_short_for_depth`: 6,0 sem para una profundidad del 21,3%, exige 8) | **sí** — sería base sin la regla C.3 |
| WELL 2026-05-14 | watch | **base** 10,7 → 7,5 → 5,0 | **sí** |
| COST 2026-05-07 | watch | no base (`out_of_range`) | **sí** — 6,7 → 3,1 → 3,9 con θ₁ más bajo; lo tumban el suelo de θ₁ y el avance previo |
| 3988.HK 2026-05-28 | plan | no base (`out_of_range`) | **NO** — sus caídas son 4,6 → 3,5 → **5,1**: la última es la mayor |
| BRK-B 2026-06-02 | block | no base ✓ | sí (pero reexpande: 8,7→3,2→2,8→6,7→…) |
| 3988.HK 2026-06-03 | block | no base ✓ | no |
| ISRG 2026-06-02 | block | no base ✓ | no (una sola caída del 34,3%) |
| AAPL 2026-06-01 | block | no base ✓ | no |
| META 2026-06-02 | block | no base ✓ | sí, pero pivote 19,1% bajo techo |
| MSFT 2026-06-02 | block | no base ✓ | no (última caída 35,4%, la mayor) |
| Los otros 8 | — | **no reproducibles** | no verificable |

**Respuesta directa a la tarea 6**: de los 10 reproducibles, **9 son compatibles
con la condición de las dos caídas** —los 6 `block` porque la incumplen y por eso
deben rechazarse, más NVDA, WELL y COST, que la cumplen— y **1 la contradice**:
3988.HK@2026-05-28, etiquetado `plan`, cuya última contracción es la más
profunda. Ese caso o está mal etiquetado o la condición de las dos caídas no
aplica a valores de volatilidad muy baja donde todo el rango son 5 puntos.

Los 8 no reproducibles son un problema aparte: **el corpus no se puede auditar
con los datos que el producto guarda**. Cualquier calibración que dependa de
ellos depende de descargar barras en vivo del proveedor.

### D.3 Precisión real: 36 detecciones revisadas a ojo (tarea 8)

v2 avisó de que «2 falsos sobre 43» escondía una precisión cercana al 60%. Aquí
lo he medido en serio, sobre el **universo líquido completo**, no sobre los 60.

**Lista de comprobación, fijada antes de mirar ningún gráfico.** Una detección es
correcta si cumple las cuatro:

1. **Techo reconocible**: hay un máximo que el precio ha tocado o rozado al menos
   dos veces y no ha superado de forma sostenida.
2. **Dos caídas completas** desde ese techo, la última menos profunda que la
   primera.
3. **El precio vive dentro del rango**: ni por debajo del suelo, ni disparado.
4. **No es una uve**: no es una caída fuerte con recuperación directa.

**Primera muestra — 30 detecciones al azar (semilla 20260820) de las 172 que
daba v3 antes de la regla profundidad-tiempo:**

- Aciertos (18): BHP, GNK, KNTK, MGA, MSGS, OPY, PHVS, RNST, ROIV, RYTM, SLG,
  SYF, TAK, TDY, TX, UVE, WDS, WOR.
- Fallos (12): ASX, BEKE, EWTX, KN, MTDR, NEM, NPO, PWR, SM, T, VSEC, VVX.
- **Precisión: 18/30 = 60%** (IC 95% de Wilson: 42%-75%).

Y un patrón que salta a la vista: **los doce fallos tienen la primera contracción
entre el 17,7% y el 31,7%, con bases cortas**; los dieciocho aciertos, salvo tres
excepciones con base larga (SYF 30 semanas, TAK 18,8, T 20), la tienen por debajo
del 19%. De ahí sale la regla C.3.

**Segunda muestra — 20 detecciones nuevas (semilla 20260821), ya con la regla
puesta, excluyendo las revisadas antes:**

- Aciertos (16): AYI, BRC, CVX, DAL, FBNC, GHRS, HEI-A, IMVT, LYV, MCK, MOG-A,
  NDSN, PNFP, TECK, VRSN, VTOL.
- Fallos (4): BLTE (el retroceso abierto duplica a la contracción anterior),
  FFIV (cuatro contracciones en 4,6 semanas, precio a media altura), FLS
  (28,4 → 19,4: dos tramos de recuperación, no contracciones), LNG (rebote
  dentro de una caída mayor).
- **Precisión: 16/20 = 80%** (IC 95%: 58%-92%).

Sumando las 16 supervivientes de la primera muestra (14 aciertos + NEM y T, que
la regla no elimina) y las 20 nuevas: **30 aciertos sobre 36 = 83%**, con un
intervalo de confianza del 95% de **68% a 92%**. Con 36 casos no se puede afinar
más: para distinguir un 83% de un 75% harían falta unos 200.

Con eso, sobre el universo líquido: **114 detecciones (5,13%), de las que unas 95
serían defendibles y unas 19 no.**

### D.4 La prueba que faltaba: qué pasó después

Ni v1 ni v2 tenían un solo dato de rendimiento posterior. Aquí sí, con el método
más simple posible: **detectar a una fecha pasada y mirar 50 sesiones hacia
delante**, en tres cortes (27-feb, 30-abr y 5-jun de 2026), 6.584 pares
valor-fecha.

| Configuración | detecciones | rendimiento mediano | caída máxima mediana | perdieron el suelo en 30 sesiones |
|---|---|---|---|---|
| Universo (sin base) | 6.273 | +5,57% | −8,86% | — |
| **v3 final** | **311 (4,7%)** | **+6,24%** | **−6,16%** | **15,4%** |
| v3 sin la regla profundidad-tiempo | 430 (6,5%) | +5,19% | −7,71% | 17,9% |
| v2 | 273 (4,1%) | +5,67% | −7,22% | 19,4% |

Tres lecturas, en orden de importancia:

1. **La regla profundidad-tiempo se valida con datos que no usé para
   calibrarla.** Mejora las tres medidas a la vez: menos roturas del suelo
   (17,9% → 15,4%), menos caída (−7,71% → −6,16%) y mejor rendimiento
   (+5,19% → +6,24%), a cambio de un 28% menos de detecciones.
2. **v3 mejora a v2 en la tasa de rotura** (15,4% frente a 19,4%) con un 14% más
   de detecciones.
3. **El «edge» de rendimiento no existe en esta ventana, y hay que decirlo así.**
   Con remuestreo (4.000 réplicas) sobre las 311 bases y los 6.273 valores
   restantes:

   | Diferencia (base − universo) | Mediana | IC 95% |
   |---|---|---|
   | Rendimiento a 50 sesiones | **+0,66%** | **[−1,13%, +2,16%]** — incluye el cero |
   | Caída máxima | **+2,72%** | **[+1,30%, +3,77%]** — no incluye el cero |

   Lo único que se separa con claridad estadística es que **las bases caen 2,7
   puntos menos** que el resto del universo. Es coherente con lo que una base es
   —una estructura contenida— y **no** demuestra que el patrón anticipe subidas.
   Quien quiera esa demostración necesita varias ventanas de mercado, incluida
   alguna bajista.

### D.5 Las señales de calidad del libro no se sostienen (todavía)

Con los mismos tres cortes, dentro de las bases detectadas (medido sobre la
configuración **anterior** a la regla profundidad-tiempo, que es la que daba
subgrupos con tamaño suficiente):

| Señal | Lo que dice la fuente | Lo que miden los datos |
|---|---|---|
| Sacudida dentro de la base | refuerza el patrón (Minervini A.2) | rendimiento mediano **peor** en dos de los tres cortes (−1,86 vs +1,42; +0,58 vs +6,17; +9,20 vs +6,14) |
| Asa en cuña, sin perforar mínimos | «failure-prone» (O'Neil A.1) | rendimiento mediano **mejor** en los tres cortes (−2,60 vs −6,31; +8,30 vs +0,58; +10,33 vs +6,32) |
| Volumen seco en la última contracción | condición del pivote correcto (A.2) | mezclado: mejor en un corte, peor en dos |

Es decir: **las tres señales de calidad del libro apuntan al revés o a nada en
esta ventana**. Antes de sacar conclusiones grandes, tres avisos: (a) los
subgrupos son de 12 a 67 casos; (b) una sola ventana de mercado, alcista; (c) mi
medida del asa usa fractales de radio 1 sobre ventanas de 5-15 sesiones, que es
una traducción pobre de lo que O'Neil describe sobre asas de varias semanas.

Lo que sí justifica esto es la decisión de **no convertirlas en puertas**. Se
miden, se muestran, y se decide cuando haya más datos.

---

## PARTE E — El corpus nuevo (tarea 7)

Hace falta. El actual tiene tres problemas, todos verificados:

1. **8 de sus 18 casos no se pueden reproducir** con las barras que el producto
   guarda (D.2). Calibrar contra ellos exige descargar del proveedor en vivo.
2. **4 de los 6 símbolos estadounidenses que sí se reproducen llevan barras
   mensuales incrustadas** (v2, Parte D): AAPL, WELL y MSFT con cuatro cada uno,
   COST con una. Filtrarlas es obligatorio y no es lo que hace el arnés actual.
3. **Al menos un caso contradice la condición de las dos caídas**
   (3988.HK@2026-05-28, D.2), y las ocho etiquetas del muestreo de v1 fallan la
   misma condición en cinco de ocho (v2, C.2.1).

### E.1 Cómo construirlo

**Cuántos.** Con 8 positivos, un acierto vale 12,5 puntos y el ruido manda.
Para que la sensibilidad tenga un intervalo de confianza de ±10 puntos hacen
falta **unos 60-80 casos positivos**; con 30 el intervalo es de ±17. Propuesta
realista: **40 positivos y 40 negativos**, revisables en dos sesiones de trabajo,
que dan ±13 puntos. Ampliables después.

**De dónde salen los candidatos.** No al azar puro: el 95% del universo no tiene
nada que mirar y se gasta el tiempo en descartes obvios. Muestreo estratificado:

| Estrato | Cómo se elige | n |
|---|---|---|
| Detecciones del v3 | al azar de las 114 | 25 |
| Rechazos por poco | los que fallan **una sola** puerta (`too_short_for_depth`, `price_in_lower_half`, `depth_reexpansion`) | 25 |
| Rechazos claros | al azar de los que fallan tres o más puertas | 15 |
| Escaleras | etapa 2 a menos del 3% de máximos con +40% a 12 meses | 15 |

Los dos estratos centrales son los que informan: los casos fáciles no enseñan
nada. **Importante**: el etiquetador no debe ver el veredicto del detector antes
de decidir, o el corpus mide obediencia en vez de criterio.

**Con qué criterio se etiqueta.** El de la lista de D.3, que es la condición del
dueño escrita para poder aplicarla a un gráfico, más una casilla de duda:

```
Para cada valor, a fecha fija, con el gráfico diario de 6 meses delante:
  1. ¿Hay un techo que el precio haya tocado o rozado dos veces y no
     haya superado de forma sostenida?              □ sí  □ no
  2. ¿Hay dos caídas completas desde ese techo, con
     la segunda menos profunda?                     □ sí  □ no
  3. ¿El precio está dentro del rango (ni por debajo
     del suelo ni disparado por encima)?            □ sí  □ no
  4. ¿Es una uve —caída fuerte y recuperación
     directa— en vez de una consolidación?          □ sí  □ no
  Etiqueta = BASE si 1,2,3 = sí y 4 = no.  DUDOSO si dudas en alguna.
  Y una línea de texto: dónde está el techo y dónde las dos caídas.
```

Esa última línea es la que hace el corpus auditable: si el etiquetador tiene que
señalar dónde están las dos caídas, las etiquetas incompatibles con la regla
—como las cinco de v1— se detectan al escribirlas, no tres intentos después.

**Qué se guarda por caso**: símbolo, fecha de corte, las cuatro respuestas, la
línea de texto, y **el hash de las barras usadas** (para detectar que los datos
cambiaron bajo los pies, como pasó con las barras mensuales).

**Y una fecha de corte fija para todos**, entre 4 y 6 meses antes de hoy. Así el
corpus sirve a la vez de juego de etiquetas **y** de prueba hacia delante: se
etiqueta con lo que se veía entonces y se mide lo que pasó después.

### E.2 Qué hacer con el corpus viejo

No borrarlo. Marcar los 8 no reproducibles como `unverifiable_from_daily_bars` y
revisar el caso 3988.HK@2026-05-28 con la lista de arriba. Los 6 `block` son
buenos y siguen valiendo: los tres detectores los rechazan.

---

## PARTE F — Veredicto

**Sobre lo que se pedía:**

1. **Las sacudidas ya no invalidan.** Con base documental (Parte A) y con un dato
   que zanja la discusión: de las 39.818 perforaciones de mínimo del universo,
   **el 53% se recuperan**. Tratarlas como rotura era descartar la mitad de las
   veces por un fenómeno que la metodología considera constructivo.
2. **La zona de salida adaptativa funciona y está calibrada con datos, no a
   ojo.** Distingue «el precio salió del rango» de «el precio sigue dentro», y
   resuelve casos que v2 no sabía explicar (JAZZ, B.4). Es la pieza que permite
   admitir sacudidas sin abrir la puerta a las roturas.
3. **La escala sub-lineal se confirma, con un matiz.** Los exponentes medidos son
   0,55 (volatilidad) y 0,35 (amplitud) arriba, y 0,80 y 0,10 abajo. La forma
   logarítmica que proponías empata con la potencia dentro del ruido: **no era
   una mala idea, es indistinguible de la mejor**. Pero la ganancia frente a un
   umbral constante es modesta (Youden 0,25 vs 0,24), y eso también hay que
   decirlo: la zona de salida ordena el problema, no lo resuelve.
4. **Lo que de verdad subió la precisión no fue la zona de salida, sino una
   frase del libro que llevábamos tres intentos sin usar**: cuanto más honda es
   la corrección, más tiempo necesita la base. Esa regla sola sube la precisión
   revisada del 60% al 83% y baja la tasa de rotura del suelo del 17,9% al 15,4%
   — **a cambio de un positivo del corpus** (NVDA@2024-05-22, D.2). Es el único
   coste medido que tiene, y no es despreciable.

**Los números, comparados:**

| | v1 | v2 | v3 |
|---|---|---|---|
| 8 etiquetados | 2/8 | 3/8 | 3/8 |
| Falsos sobre los etiquetados sin base | 0/60 | 2/43 | 5/43, de los que **solo 1 falla mis criterios escritos** (D.1) |
| Corpus | 7/9 | 7/9 | 7/10 (8/10 sin la regla C.3) |
| % del universo marcado | — | 4,2% | 5,1% |
| **Precisión revisada a ojo** | — | ~60% (5 casos) | **83% (36 casos)** |
| Rotura del suelo a 30 sesiones | — | 19,4% | **15,4%** |
| Escaleras alcistas marcadas | — | 1/15 | 1/15 |

**¿Alcanza para ponerlo en la tabla? Todavía no, y por poco.**

Con 83% de precisión, de cada seis bases que muestre el producto una no lo es.
Es mucho mejor que el 60% de v2 —donde eran dos y media de cada seis— pero sigue
siendo un dato con aspecto de preciso que falla una de cada seis veces. El
principio 7 de `principios-producto.md` pide poder calcularlo bien, no
aproximadamente.

**Lo que sí propongo hacer ya**, en este orden:

1. **Construir el corpus nuevo** (Parte E). Es lo que desbloquea todo lo demás:
   sin él, cada intento discute contra una vara distinta. Dos sesiones de trabajo.
2. **Mostrarlo primero en la ficha, no en la tabla.** En la ficha caben el
   footprint completo, el motivo de rechazo y las marcas sobre el gráfico, y el
   usuario puede auditar el cálculo con sus ojos. Un fallo de uno de cada seis es
   asumible cuando la evidencia está a la vista; no lo es en una columna que se
   lee sin contexto.
3. **Quitar `lower_low_drift` del detector de producción** aunque no se muestre
   nada nuevo. Hoy marca el 33,5% de las filas por un rasgo que las tres fuentes
   consideran constructivo. Es un error de criterio, no de umbral.
4. **Repetir la prueba hacia delante en una ventana bajista** antes de creerse
   cualquier cosa sobre rendimiento. Las tres ventanas de este documento son
   alcistas.

---

## CONFIANZA

**Alta** (medido, con procedimiento reproducible y muestras grandes):

- Lo que dicen las fuentes sobre sacudidas (Parte A). Son cuatro pasajes en tres
  libros distintos, con capítulo y sección localizables, y los tres coinciden.
- El estudio de la zona de salida: **48.774 rupturas y 39.818 perforaciones**
  sobre el universo líquido completo, con las barras agregadas filtradas. Que el
  53% de las perforaciones se recuperan, y que los umbrales óptimos escalan de
  forma sub-lineal, son hechos medidos sobre esa muestra.
- Que **log y potencia empatan** y que ambas ganan a la constante por poco
  (Youden 0,249 y 0,251 frente a 0,236). El ajuste es por rejilla exhaustiva
  sobre los eventos completos, no sobre medias.
- Los resultados de D.1 y D.2: una sola parametrización, sin ajustes por caso,
  fecha de corte fija.
- La prueba hacia delante de D.4: 6.584 pares valor-fecha, tres cortes, y el
  intervalo de confianza por remuestreo. Que **las bases caen 2,7 puntos menos**
  con IC [1,30; 3,77] es un resultado sólido dentro de esta ventana.
- Que la regla profundidad-tiempo mejora las tres medidas de resultado
  simultáneamente, medido sobre datos que no se usaron para calibrarla.

**Media** (fundamentado, con juicio de por medio):

- **La precisión del 83%.** Son 36 casos revisados por mí con una lista fijada de
  antemano, pero el instrumento es mi ojo, el mismo que produjo las etiquetas que
  este documento cuestiona. El intervalo de confianza al 95% para 30/36 es
  **[68%, 92%]**: el número real puede estar bastante por debajo de 83.
- La pendiente 0,8 de la regla profundidad-tiempo. La calibré sobre 30 casos
  revisados y la validé en otros conjuntos, pero el valor exacto es mío; lo que
  el libro dice es que la duración debe crecer con la profundidad, no cuánto.
- Mi juicio de que WOR y TECK son bases y sus etiquetas están mal.
- Los exponentes ajustados (0,55/0,35 arriba, 0,80/0,10 abajo). Salen de una
  rejilla sobre una definición concreta de «aguantó» —cierre por encima 20
  sesiones después—. Con otra definición de éxito saldrían algo distintos.

**Baja** (opinión declarada como tal):

- Que 40+40 casos sean suficientes para el corpus nuevo. Es un cálculo de
  intervalo, no experiencia.
- Que la ficha sea el sitio correcto para estrenarlo antes que la tabla.
- Que las señales de calidad del libro (sacudida, asa, volumen) acaben
  sosteniéndose con más datos. Hoy apuntan al revés y no sé si es la ventana, mi
  operacionalización o la regla.

---

## LO QUE NO HE VERIFICADO

1. **No he ejecutado el detector de producción** (`lib/setupPatterns.js`). Las
   cifras de v1 y v2 vienen de sus documentos. Lo único que he vuelto a ejecutar
   es el prototipo, sobre las mismas barras y fechas.

2. **Los 8 casos del corpus con fechas de 2022-2025 siguen sin poder probarse**,
   y con ellos cualquier conclusión sobre bases históricas largas.

3. **Una sola ventana de mercado, y alcista.** Los tres cortes de la prueba hacia
   delante (feb, abr y jun de 2026) están dentro del mismo tramo y se solapan
   entre sí: no son tres muestras independientes. El universo subió en los tres.

4. **La definición de «aguantó» es mía**: cierre por encima del techo 20 sesiones
   después. Es razonable y es la que usaría un operador, pero no es la única.

5. **El estudio de la zona de salida usa todos los máximos y mínimos locales**,
   no solo los que son techos de consolidación. La población es más ancha que el
   caso de uso del detector; los umbrales podrían ser distintos si se restringe.

6. **No he medido el coste de cálculo.** El prototipo es Python y hace más
   trabajo que v2 (recorre candidatos y calcula bandas). Sigue siendo lineal en
   el número de barras, pero no puedo dar una cifra en milisegundos para el
   detector de producción, que es JavaScript.

7. **No he probado fuera de Estados Unidos** salvo 3988.HK. Y sigue sin
   verificarse el efecto de los splits: el prototipo usa `close` sin ajustar,
   igual que el detector actual.

8. **No he borrado ni corregido ninguna barra.** Las agregadas se filtran en
   memoria; en `daily_bars` siguen exactamente igual, incluidas las de COST,
   WELL, AAPL, MSFT, XOM, MCD y 3988.HK.

9. **La comparación de falsos positivos entre v1 y v2/v3 no es estricta**: v1
   midió sobre 60 negativos y v2/v3 sobre los 43 recuperables por nombre.

10. **No he probado el detector con datos intradía ni con barras semanales**,
    que es como Minervini mira realmente los gráficos (semanal para la
    estructura, diario para el pivote).

---

## APÉNDICE — Las piezas nuevas

```python
def exit_margin(atrPct, depthPct, p, side="up"):
    """Zona de salida: cuánto puede alejarse el precio del techo (o del suelo)
    sin haber salido del rango. Ajustada sobre 48.774 rupturas y 39.818
    perforaciones del universo líquido (Parte B)."""
    a = max(0.01, atrPct); d = max(0.01, depthPct)
    if side == "down":
        m = 1.05 * (a ** 0.80) * (d ** 0.10)     # abajo manda la volatilidad
    else:
        m = 0.80 * (a ** 0.55) * (d ** 0.35)     # arriba, volatilidad y amplitud
    return min(12.0, max(1.0, m))


def first_exit(bars, anchor, ceiling, floorRef, atrPct, p):
    """Primer momento en que el precio sale de la banda de forma sostenida.
    Dos cierres consecutivos fuera: un pico intradía que vuelve dentro no saca
    al valor del rango — es la misma lógica que la sacudida, en el otro sentido."""
    depth = (ceiling - floorRef) / ceiling * 100
    up = exit_margin(atrPct, depth, p, "up")
    dn = exit_margin(atrPct, depth, p, "down")
    hiLimit = ceiling * (1 + up/100.0)
    loLimit = floorRef * (1 - dn/100.0)
    uc = dc = 0
    for i in range(anchor+1, len(bars)):
        c = bars[i]["c"]
        uc = uc + 1 if c > hiLimit else 0
        dc = dc + 1 if c < loLimit else 0
        if uc >= p["exitConfirmBars"]: return i, "breakout", up, dn
        if dc >= p["exitConfirmBars"]: return i, "breakdown", up, dn
    return None, None, up, dn


def shakeouts(bars, cs):
    """Sacudidas: mínimos de contracción que perforan un mínimo anterior de la
    base. Se cuentan como atributo; NO invalidan (Parte A)."""
    n = 0; marks = []
    for k in range(1, len(cs)):
        prev = min(c["lo"] for c in cs[:k])
        if cs[k]["lo"] < prev:
            n += 1; marks.append(k+1)
    return n, marks


# Y la regla que más aportó, en una línea:
#   semanas_exigidas = 3 + 0,8 · max(0, profundidad% − 15)      (TLSMW p.212)
```

El resto del detector —ancla, zigzag de dos umbrales, puertas— está en el
apéndice de [v2](diseno-contracciones-v2-2026-08-18.md), sin cambios salvo la
eliminación de `lower_low_drift` y `trend_saw_tooth`.
