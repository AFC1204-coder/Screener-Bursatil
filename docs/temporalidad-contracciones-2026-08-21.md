# Temporalidad y fractalidad de las contracciones

<!-- 2026-08-21 · BASE_SHA: 34ecc09 · rama: codex/statsedge-ui-polish -->

Documento de **diseño y medición**. No modifica código de producto, no escribe
en Supabase, no ejecuta escaneos.

Planteado por el dueño: *«los VCP son fractales por naturaleza y pueden darse
varios dentro de uno mismo, así que habría que filtrar o mostrar por
temporalidad… y si no hay ninguno en esa temporalidad, pues no mostrarlo»*.

---

## 1. No es un tema nuevo: llevaba cinco casos apareciendo

| Caso | Lo que pasó |
|---|---|
| **ICE** | El dueño etiquetó la base de **ene-abr**; el detector reportaba la de **jun-ago**. Las dos existen. |
| **FLG** | *«Hay uno pequeño entre 18-dic y 28-ene, y otro más grande entre 9-feb y 5-jun»*. Dos bases **en secuencia**. |
| **BEKE** | *«No veo un patrón claro más allá del que comienza el 17 de julio, pero es muy pequeño y no tiene gran peso por ese contexto de ser pequeño en un patrón mucho más grande»*. Una base **anidada** en otra. |
| **NDSN** | Seis contracciones de feb a ago con una reconfiguración en medio; el detector veía tres, de may a jul. |
| **IP** | *«Taza con asa… cheats»*, comparándolo con GOOGL. |

El campo `PERIODO` de la plantilla de etiquetado se añadió como parche para
esto. Este documento es el intento de resolverlo en serio.

---

## 2. Dos mediciones, y la primera fue la equivocada

### 2.1 Mover la ventana de observación no sirve

Primer experimento: el mismo detector sobre 400 valores líquidos al azar, con
ventanas de observación de 60, 100, 140 y 200 sesiones.

| Ventana | Bases | 1.ª contracción (mediana) |
|---|---|---|
| 60 sesiones | 34 | 19,2% |
| 100 | 38 | 19,2% |
| 140 | 37 | 19,9% |
| 200 | 35 | 20,0% |

De los 38 valores con base en dos o más ventanas, **33 daban exactamente la
misma estructura** y solo 5 daban estructuras distintas. La mediana de
profundidad es prácticamente idéntica en las cuatro.

**Conclusión: el detector tiene una escala cocida en sus parámetros.** Mirar
más o menos historia no cambia lo que ve, porque el tamaño de lo que busca está
fijado por `maxLegBars` (45 sesiones), el radio del pivote (3) y los umbrales de
profundidad en ATR. La fractalidad del mercado es real; **el detector es ciego a
ella**.

### 2.2 Escalar TODOS los parámetros sí produce estructuras distintas

Segundo experimento: tres escalas, con duración, radio de pivote y umbrales de
profundidad escalados a la vez.

| Escala | `lookback` / `maxLegBars` / radio / min-ATR | Bases | Duración mediana | 1.ª contracción |
|---|---|---|---|---|
| **corta** | 60 / 15 / 2 / 2,0x | 46 (11,5%) | **3 semanas** | **10,1%** |
| **media** | 140 / 45 / 3 / 3,5x | 37 (9,3%) | **7 semanas** | **19,9%** |
| **larga** | 250 / 90 / 5 / 5,0x | 30 (7,5%) | **20 semanas** | **22,9%** |

- **17 valores** dan base en dos o más escalas.
- **13 de esos 17 tienen estructuras genuinamente distintas** — anidamiento real.

Ejemplo de manual, **IP**:

```
corta   [10,7 → 4,1]     3 semanas    28-jul → 17-ago
media   [32,5 → 10,7]   25 semanas    12-feb → 07-ago
larga   [32,5 → 10,7]   25 semanas    12-feb → 07-ago
```

La base «corta» **es literalmente la última contracción de la larga**. No son
dos patrones: es el mismo visto con distinta lente. Y el dueño etiquetó IP como
*«taza con asa»*, que es la lectura **media**, no la corta.

Otros: **AMT** (corta 3 sem / larga 9 sem), **CGON** (6 / 13 / 11 sem),
**MSGS** (la media solo añade una contracción por delante a la corta),
**FNV** (cada escala mayor añade un tramo al principio).

---

## 3. Qué significa «temporalidad», operativamente

Hay dos cosas que se confunden y conviene separarlas:

**El intervalo de barra** (diario, semanal, mensual) es una **decisión de
dibujo**. Una base de 20 semanas se ve perfectamente en un gráfico diario. Una
de 3 semanas en un gráfico semanal son tres velas: no se ve. El intervalo no
define el patrón, solo cómo se representa.

**La duración de la estructura** sí es una propiedad del patrón. Y no es
independiente de la profundidad: las dos están atadas por la regla del libro que
v3 ya usa (TLSMW p.212):

```
semanas exigidas = 3 + 0,8 · max(0, profundidad% − 15)
```

Comprobado contra las tres escalas medidas:

| Escala | Profundidad | Duración medida | La regla exige |
|---|---|---|---|
| corta | 10,1% | 3 sem | 3 sem ✓ |
| media | 19,9% | 7 sem | **6,9 sem** ✓ |
| larga | 22,9% | 20 sem | 9,3 sem ✓ (con holgura) |

La coincidencia en la escala media es notable: 7 semanas medidas contra 6,9
exigidas, sin haberlo buscado.

> **Lo que esto reencuadra**: la regla profundidad-tiempo **no es una puerta más**
> — es lo que *define* una escala. Una «temporalidad» es un par coherente
> (profundidad, duración). Filtrar por temporalidad es filtrar por ese par, no
> por el intervalo de las velas.

---

## 4. La regla de anidamiento

Los dos casos del corpus dan la regla, y dicen cosas distintas:

**FLG — bases en secuencia: las dos valen.**
Una de dic-ene y otra de feb-jun, una después de la otra. El dueño nombra las
dos sin problema. La primera se resolvió antes de que empezara la segunda.

**BEKE — base anidada en una mayor sin resolver: solo cuenta la mayor.**
*«Es muy pequeño y no tiene gran peso por ese contexto de ser pequeño en un
patrón mucho más grande»*. La estructura pequeña de julio vive dentro de una
caída del 30,1% que no ha resuelto.

**Regla, entonces:**

```
Si la base B está contenida en el rango de fechas de la base A
   y A no ha resuelto (sin salida sostenida de su banda):
       reportar A, nunca B.
Si A ya resolvió antes de que empezara B:
       son secuenciales; las dos valen.
```

Es implementable con lo que ya hay: la salida sostenida está definida en
[v4](diseno-contracciones-v4-2026-08-18.md) §A.2 con los parámetros de banda de
v3, calibrados sobre 88.000 eventos.

---

## 5. Propuesta para el producto

**5.1 Correr el detector a tres escalas, no a una.** Es la única forma de ver lo
que el dueño ve. Coste: triplica el cómputo por símbolo — sigue siendo lineal en
el número de barras.

**5.2 Reportar la estructura DOMINANTE**, que es la mayor sin resolver, y dejar
las anidadas como información secundaria de la ficha, no como filas propias del
screener.

**5.3 El filtro del usuario es una banda de duración, no un intervalo de vela:**

| Banda | Duración | Profundidad típica |
|---|---|---|
| Corta | ≤ 5 semanas | ~10% |
| Media | 5 – 15 semanas | ~20% |
| Larga | > 15 semanas | ~23% |

**5.4 Vacío es una respuesta válida.** Si no hay nada en la banda pedida, no se
muestra nada. Encaja con el criterio ya establecido de no enseñar por enseñar, y
con los estados vacíos contractuales del Hito 1.

**5.5 Y una advertencia sobre el coste**: correr tres escalas **triplica la
superficie de falsos positivos**. A escala corta el detector marca el 11,5% del
universo, y entre los doce etiquetados a ciegas, de los 4 que marca a esa
escala el dueño rechazó 2 (AMT y MSGS).

---

## 6. Lo que NO está medido

1. **La precisión por escala no es medible con lo que hay.** Sobre los doce
   etiquetados: corta marca 4 (2 buenos), media 8 (5 buenos), larga 3 (1 bueno).
   Con 3-8 casos por escala, esas diferencias son ruido. **No se puede concluir
   que la escala media sea la mejor**, aunque sea la que más se parece a las
   lecturas del dueño.
2. **Los parámetros de las tres escalas los elegí yo**, escalando a ojo
   (radio 2/3/5, ATR 2,0/3,5/5,0). No están calibrados contra nada. Las
   duraciones medianas resultantes (3/7/20 semanas) salieron limpias, pero eso
   no valida los parámetros de entrada.
3. **NDSN dice que falta una escala más larga aún.** El dueño lee ahí una
   estructura de feb a ago con seis contracciones y una reconfiguración; ni
   siquiera la escala «larga» (mediana 20 semanas) la captura. O falta escala, o
   falta el concepto de reconfiguración, o las dos.
4. **La regla de anidamiento no se ha implementado ni probado.** Está deducida de
   dos casos —FLG y BEKE— y escrita, nada más.
5. **Nada de esto se ha probado en el detector de producción.** Todo es sobre el
   prototipo, fuera del repo.

---

## 7. Lo que yo haría, y en qué orden

1. **Implementar la regla de anidamiento primero**, no las tres escalas. Es una
   condición sobre estructuras que ya se detectan, sale de dos casos etiquetados
   y no multiplica los falsos positivos — al contrario, los reduce, porque
   suprime las hijas espurias.
2. **Etiquetar a propósito para esto.** Una tanda donde cada valor se muestre y
   se pregunte explícitamente *«¿cuántas bases ves aquí y a qué escala?»*. Las
   tres tandas hechas hasta ahora preguntaban por una sola.
3. **Y solo después, las tres escalas.** Sin saber la precisión por escala,
   añadirlas es multiplicar por tres un problema que ya está en el 62,5% de
   precisión.

---

## 8. ¿Pesa más una base de escala mayor? Medido

Planteado por el dueño: *«conforme mayor escala temporal, mayor relevancia y
peso tiene»*, señalando además que los VCP existen hasta en minutos y segundos —
irrelevante para el producto, pero útil para ver que **esto es un bucle que se
repite a cada escala**.

Es comprobable sin depender de etiquetas humanas: detectar a fechas pasadas en
cada escala y mirar qué hizo el precio después. Muestra: los mismos 400 valores
líquidos, tres cortes (15-dic-2025, 13-feb-2026, 15-abr-2026), **1.200 pares
valor-fecha**.

### 8.1 El primer intento estaba sesgado

Con un horizonte fijo de 50 sesiones para todas las escalas, salía que la escala
**corta** era la mejor (rendimiento mediano 5,70% frente a 4,80% de la larga).

**Ese resultado es un artefacto del método.** Cincuenta sesiones son 3,3 veces la
duración de una base de 3 semanas y 0,7 veces la de una de 14: se estaba juzgando
a la larga **antes de que terminara de desarrollarse**. Comparar dos corredores
midiendo a los dos en el kilómetro 1.

### 8.2 Con horizonte proporcional a cada patrón (2× su duración)

| Escala | n | Duración | Horizonte | Rendimiento | Caída máx | Rompió el techo | Y aguantó |
|---|---|---|---|---|---|---|---|
| universo | 1200 | — | 50 ses | 3,22% | −10,09% | — | — |
| **corta** | 66 | 4 sem | 39 ses | **2,78%** | −6,88% | 80% | 59% |
| **media** | 97 | 6 sem | 59 ses | **8,33%** | −6,58% | 79% | 59% |
| **larga** | 53 | 8 sem | 79 ses | **8,33%** | **−6,02%** | **85%** | **62%** |

Diferencia contra el universo: corta **−0,44 pts** de rendimiento (peor que no
filtrar), media **+5,11**, larga **+5,11**. En caída máxima: +3,21 / +3,51 /
**+4,07** puntos de protección.

### 8.3 Qué confirma y qué no

**Confirma que la escala corta no vale.** No bate al universo en rendimiento
—queda 0,44 puntos por debajo— y solo aporta protección en la caída. Es la que
más marca (11,5% del universo en la corrida ciega) y la que menos aporta.

**Confirma que la calidad mejora con la escala** en las tres medidas que no son
rendimiento bruto:

| | corta | media | larga |
|---|---|---|---|
| Caída máxima | −6,88% | −6,58% | **−6,02%** |
| Rompió el techo | 80% | 79% | **85%** |
| Rompió **y aguantó** | 59% | 59% | **62%** |

Las tres mejoran de forma monótona al subir de escala. Eso es exactamente lo que
predice *«mayor escala, mayor peso»*.

**NO confirma que la larga bata a la media en rendimiento.** Empatan en absoluto
(8,33%), y por sesión la media gana: 0,141%/sesión frente a 0,105%. La ganancia
de la escala larga está en fiabilidad, no en velocidad.

### 8.4 Lo que este experimento NO mide

- **Los horizontes son distintos por escala** (39 / 59 / 79 sesiones), así que
  los rendimientos absolutos no son comparables entre sí. Es inherente al
  diseño: se mide cómo resuelve cada patrón **en su propia escala de tiempo**.
- **n = 53 en la escala larga**, más bajo en parte porque un horizonte de 79
  sesiones no cabe en los datos para los cortes más recientes. Hay un sesgo de
  selección hacia los cortes antiguos en esa fila.
- **Tres cortes solapados dentro de la misma ventana alcista.** El mismo aviso
  que en v3 D.4: no son tres muestras independientes, y el universo subió en las
  tres.
- **Nada dice qué pasaría por debajo del diario.** Que los VCP existan en
  minutos es cierto y coherente con el bucle, pero el producto no tiene datos
  intradía y no se ha medido.

### 8.5 Consecuencia para el diseño

Refuerza y **corrige** la propuesta de §5:

1. **La escala corta no debería mostrarse por defecto.** Marca mucho (11,5%),
   rinde peor que no filtrar, y de los cuatro casos que marcó entre los doce
   etiquetados a ciegas el dueño rechazó dos.
2. **Cuando hay estructura a varias escalas, la mayor manda** — ahora con una
   razón medida, no solo con la regla de anidamiento deducida de BEKE: rompe más
   (85%), aguanta más (62%) y cae menos (−6,02%).
3. **El defecto sensato es la escala media**, que es donde están las lecturas
   del dueño y donde el rendimiento por sesión es mejor, con la larga como
   filtro opcional para quien quiera fiabilidad sobre velocidad.
