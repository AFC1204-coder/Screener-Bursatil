# Diseño: contracciones, cuarto intento — dónde termina la base

<!-- fecha interna: 2026-08-18 · escrito el 2026-08-21 · BASE_SHA: 34ecc09 · rama: codex/statsedge-ui-polish -->

Documento de **medición**. El prototipo vive fuera del repo; no se toca el
detector de producción, no se escribe en Supabase, no hay commit.

Continúa [`v3`](diseno-contracciones-v3-2026-08-18.md). Lo que trae:

1. **La regla del contacto con el máximo**, con una definición precisa de dónde
   termina la base y la justificación de por qué esa y no otra.
2. **Medición contra 21 casos etiquetados a mano** por el dueño en dos tandas,
   una de ellas a ciegas.
3. **Revisión del corpus antiguo**: qué etiquetas siguen valiendo y cuáles no.
4. Y un resultado que cambia el orden de trabajo: **el único falso positivo que
   aparecía al quitar `lower_low_drift` era una barra corrupta**, no un fallo
   del criterio.

---

## PARTE A — La regla del contacto, y dónde termina la base

### A.1 Lo que hace producción y por qué está mal

`lib/setupPatterns.js:380` construye un techo y rechaza en cuanto un máximo lo
supera:

```js
const ceiling = Math.max(anchor.high, pivotPrice) * 1.04;
const sameCeiling = item.high <= ceiling;
if (!sameCeiling) { contractionStructureStatus = "ceiling_break"; break; }
```

La base se **corta** al primer contacto que pase del +4%. Consecuencia medida:
una base ascendente —máximos y mínimos sucesivamente más altos, profundidades
decrecientes— es **inalcanzable por construcción**. MPC (mar-may 2026,
17,6 → 10,5 → 8,6, volumen secándose 1,45x → 0,92x → 0,81x, ruptura y +41%)
pasó por los pelos: su tercer máximo está un +3,7% sobre el techo, justo por
debajo del 4%. Con escalones algo mayores lo habría rechazado.

### A.2 La definición: la base termina cuando el precio SALE, no cuando TOCA

El contacto con el máximo de referencia —o incluso un máximo nuevo por encima—
**no** termina la base. La base termina cuando el precio **sale de forma
sostenida** de una banda alrededor del rango:

```
banda_arriba(%) = 0,80 · ATR20%^0,55 · profundidad%^0,35
banda_abajo(%)  = 1,05 · ATR20%^0,80 · profundidad%^0,10     acotadas a [1%, 12%]

salida  = dos cierres consecutivos fuera de la banda
caduca  = si la salida ocurrió hace más de 10 sesiones
```

**Por qué esta definición y no un umbral nuevo.** Es la zona de salida de v3,
ajustada allí sobre **48.774 rupturas y 39.818 perforaciones** del universo
líquido. Inventar aquí un umbral propio significaría calibrarlo sobre los 21
casos etiquetados, que es exactamente lo que hay que evitar. La regla
estructural es nueva; los números vienen de una muestra 4.000 veces mayor.

Dos cierres, y no uno, por el mismo motivo por el que una perforación aislada no
invalida: un pico intradía que vuelve dentro no saca al valor del rango.

### A.3 La segunda regla, y por qué no es implementable

La segunda lección de la primera tanda —«uno de los supuestos falsos positivos
no lo era: la etiqueta estaba incompleta»— **no es una regla del algoritmo**.
Fue MPC: yo lo clasifiqué como falso positivo de escalera, el dueño lo corrigió,
y su etiqueta original mencionaba de pasada un par de fechas alternativas
(20-may / 27-may) que resultaron ser la lectura correcta.

Lo que se deduce no es código: es que **la plantilla de etiquetado debe recoger
las lecturas alternativas que el etiquetador considera y descarta**. Ya está
aplicado — la plantilla lleva `TECHO`, `DISPARO` y `PERIODO` desde entonces, y
el campo `NOTA` recoge las dudas. No hay nada que implementar en el detector.

---

## PARTE B — Medición contra los 21 casos etiquetados

Tanda 1: nueve casos con fechas completas. Tanda 2: doce a ciegas, ocho de
ellos marcados por el detector sin que el dueño lo supiera. Corte en la fecha
en que cada estructura estaba viva.

| | v4 (sin banda) | v5 (con banda) |
|---|---|---|
| Aciertos | **15/21** | 14/21 |
| Falsos positivos | 4 | 4 |
| Falsos negativos | 2 | 3 |

**La zona de salida cambia exactamente un veredicto, y lo cambia a peor**: IP
pasa de BASE a `fuera_de_rango` (salida el 2026-05-01) y el dueño lo etiquetó
como base —«taza con asa, lo que Minervini llamaría *cheats*»—.

Un caso sobre 21 no demuestra que la banda esté mal, y sus parámetros vienen de
88.000 eventos frente a mis 21. **No la ajusto.** Lo que sí queda registrado es
que aquí no aporta.

### Los cuatro falsos positivos, que son los mismos en v4 y v5

NDAQ, BEKE, ELV y MSGS. Ninguno se arregla moviendo umbrales: los cuatro caen
en conceptos que el detector no tiene, identificados al etiquetar la tanda 2:

| Caso | Lo que dice el dueño | Concepto que falta |
|---|---|---|
| AMT (bien rechazado, mal motivo) | «tremendamente lateral, bucle infinito de patrones» | el lateral perpetuo no cuenta |
| BEKE | «pequeño dentro de un patrón mucho más grande» | jerarquía entre estructuras |
| ELV, MSGS | «ruidoso», «poco volumen y errático» | calidad del trazo ≠ liquidez |
| NDSN (acertado, estructura distinta) | «no rompe bien y **se reconfigura**» | la base que falla y se rehace |

### Los falsos negativos son correctos como comportamiento de producto

Los dos de v4 son **ICE y DECK**, y a los dos los tumba el filtro de contexto
(media de 30 semanas cayendo). **Los dos fracasaron**: ICE nunca disparó y cayó
un 27%; DECK, en palabras del dueño, «acabó fracasando». Como etiqueta
estructural son fallos; como decisión de qué enseñar, aciertos.

---

## PARTE C — El corpus antiguo

De sus 18 casos, **10 son reproducibles** con las barras que retiene el producto
(400 por símbolo; 1.260 si está referenciado). Los otros 8 tienen fechas de
2022-2025 y siguen fuera de alcance, igual que en v3.

| Caso | Esperado | v4/v5 | Veredicto sobre la etiqueta |
|---|---|---|---|
| BRK-B 2026-06-02 | block | no (`contexto_no_etapa2`) | **vale** |
| 3988.HK 2026-06-03 | block | no (`reexpansion`) | **vale** |
| ISRG 2026-06-02 | block | no (`contexto_no_etapa2`) | **vale** |
| AAPL 2026-06-01 | block | **BASE** | ver abajo — **artefacto de datos** |
| META 2026-06-02 | block | no (`contexto_no_etapa2`) | **vale** |
| MSFT 2026-06-02 | block | no (`contexto_no_etapa2`) | **vale** |
| 3988.HK 2026-05-28 | **plan** | no (`tendencia_no_lateral`) | **NO vale** |
| COST 2026-05-07 | watch | BASE [6,7 → 3,1] | **vale** |
| WELL 2026-05-14 | watch | BASE [13,7 → 7,5 → 5,0] | **vale** |
| NVDA 2024-05-22 | watch | BASE [22,4 → 4,3] | **vale** |

### C.1 La etiqueta que no sobrevive a la condición de dos caídas

**3988.HK@2026-05-28**, etiquetado `plan` — la categoría positiva más fuerte del
corpus. v3 ya midió sus contracciones: **4,6 → 3,5 → 5,1**. La última es la más
profunda, así que **incumple la condición mínima de dos caídas decrecientes**.
No es que el detector falle: la etiqueta está mal. Es el mismo caso que v3
señaló en D.2 y sigue sin corregirse.

### C.2 Cuatro de los seis `block` prueban una puerta que hay que quitar

Cuatro casos —BRK-B, 3988.HK, ISRG y AAPL de junio de 2026— llevan el arquetipo
`lower_low_false_positive`: existen para comprobar que **`lower_low_drift`** los
rechaza. Y esa es justo la puerta que v3 propone eliminar, con dos argumentos:
el 53% de las 39.818 perforaciones del universo se recuperan, y en esta sesión
se midió que salta con perforaciones minúsculas —**0,50%** en ICE, **0,31%** en
NDAQ, **0,66%** en GOOGL—.

**La pregunta que importa: si se quita la puerta, ¿cuántos de esos cuatro se
convierten en falsos positivos?**

Medido: **tres de los cuatro siguen rechazados por otros motivos** (contexto en
BRK-B e ISRG, reexpansión en 3988.HK). Solo AAPL pasa a BASE.

### C.3 Y ese único falso positivo no es real

AAPL@2026-06-01 sale como base con contracciones **22,1 → 3,9**, y su primera
contracción arranca el **2026-03-01**. Esa fecha es una de las **barras
mensuales residuales** que quedaron sin borrar en la limpieza de hoy:

```
AAPL 2026-03-01   máx 314,73   mín 245,30   cierre 311,79
                  rango 22,3%  (normal ~2-3%)   volumen 2.789 M
```

Quitando esa única barra, el veredicto se da la vuelta: **`no` (`fuera_de_rango`)**.

Es decir: **quitar `lower_low_drift` cuesta CERO falsos positivos** sobre los
cuatro casos que existían para justificarla, una vez los datos están limpios.
El único que aparecía lo producía una barra corrupta conocida.

> **Consecuencia operativa**: quedan 8 barras mensuales residuales en AAPL, JPM,
> MSFT, TXN y WELL, por debajo del umbral de la limpieza del 20 de agosto
> (AAPL 2026-03-01 va a 38,5x su vecina y el corte estaba en 40x). Mientras
> estén, cualquier medición sobre esos cinco símbolos es sospechosa. Este caso
> es la prueba de que no es teórico.

---

## PARTE D — Qué recomiendo

**Implementable ya, con evidencia suficiente y sin ajustar nada:**

1. **Quitar `ceiling_break`** y sustituirlo por la zona de salida. La regla del
   contacto está justificada por MPC y por la definición de base ascendente de
   O'Neil, y la definición de salida viene calibrada de v3.
2. **Quitar `lower_low_drift`.** Coste medido sobre el corpus: **cero falsos
   positivos**. Argumento de v3: el 53% de las perforaciones se recuperan.
3. **Bajar el mínimo de contracciones de 3 a 2.** La taza con asa tiene dos por
   definición; GOOGL (+17,2%) e IP y QRVO de la tanda 2 son ejemplos etiquetados.
4. **Corregir la etiqueta de 3988.HK@2026-05-28** en el corpus, o marcarla como
   inválida: incumple la condición de dos caídas y lleva dos versiones
   señalándose.
5. **Borrar las 8 barras mensuales residuales.** La Parte C.3 demuestra que
   producen bases falsas.

**NO implementable todavía, y por qué:**

- **El filtro de contexto** (media de 30 semanas subiendo) separa los dos
  fracasos del corpus y rechaza un tercio del universo. Es la puerta con más
  efecto de todas y solo tiene **dos casos** que la sostengan (ICE, ORCL).
  Antes de meterla en producción como filtro duro, hacen falta más.
- **Los cuatro conceptos de la tanda 2** —lateral perpetuo, jerarquía entre
  estructuras, calidad del trazo, reconfiguración— tienen uno o dos ejemplos
  cada uno. Son conceptos, no umbrales: implementarlos mal es peor que no
  tenerlos.
- **Los umbrales numéricos** (3,5x ATR para la primera contracción, 0,6 de
  desplazamiento) salen de 21 casos. No son medidas de acierto: son el resultado
  de haber ajustado sobre esos mismos casos.

**Y el dato que ordena el trabajo**: la corrida ciega sobre 400 valores al azar
dio **37 marcados (9,3%)**, y de los 8 que el dueño juzgó **5 eran base
(62,5%)**. A esa precisión, una de cada tres que se mostrara no lo sería. El
detector no está listo para la tabla, y lo que falta no son umbrales.

---

## LO QUE NO HE VERIFICADO

1. **La zona de salida solo se ha probado sobre 21 casos**, y en uno empeora.
   Sus parámetros vienen de v3 y no los he recalibrado ni comprobado sobre el
   universo completo.
2. **Los 8 casos no reproducibles del corpus** siguen sin poder probarse.
3. **El prototipo no es el detector de producción.** Nada de lo medido aquí
   dice qué haría `lib/setupPatterns.js` con estos cambios aplicados.
4. **AAPL, JPM, MSFT, TXN y WELL** tienen barras corruptas conocidas. Cualquier
   medición sobre ellos —incluida la de la Parte C— arrastra ese riesgo.
5. **La tanda 3 está preparada pero sin etiquetar.** Sus doce valores están
   elegidos por punto del avance (recién girada / bases encadenadas / madura),
   y esa hipótesis —que el criterio del dueño cambia según el contexto— sigue
   sin comprobarse.
