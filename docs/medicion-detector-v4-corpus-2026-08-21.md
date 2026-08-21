# Medición del detector v4 contra los 21 casos, con fechas

<!-- 2026-08-21 · BASE_SHA: 0184bfa · rama: codex/statsedge-ui-polish -->

Documento de **medición**. No toca `lib/setupPatterns.js`, no escribe en
Supabase, no ejecuta escaneos, no hay commit.

Continúa [`v4`](diseno-contracciones-v4-2026-08-18.md) y
[temporalidad](temporalidad-contracciones-2026-08-21.md). La hipótesis del
encargo era que, si dos reglas aparecieron con doce casos, podrían quedar más
escondidas en los que el detector aún falla. **La hipótesis se confirma, pero
no donde se esperaba**: la regla que aparece no separa bases de no-bases, sino
*contracciones de desplomes*, y sale de mirar las fechas, no los veredictos.

Todo lo de aquí se reproduce con:

```bash
node --env-file=.env.local --loader ./scripts/loader.mjs research/contracciones/arneses/medicion-corpus.mjs
```

y los tres arneses nuevos que lo acompañan (`estabilidad-ventana.mjs`,
`reglas-simulacion.mjs`, `reglas-universo.mjs`).

---

## El resumen, en dos números

| | |
|---|---|
| v4 acierta el **sí/no** | **15 de 21** (4 falsos positivos, 2 falsos negativos) — reproduce lo publicado |
| v4 acierta el sí/no **y la estructura** | **7 de 21** |

Los ocho aciertos de diferencia son casos donde el veredicto coincide y las
fechas no. Tres de ellos son graves: **FLG, IP y NDSN**, donde el detector
marca una estructura que el dueño no etiquetó, o que ni siquiera existe como
tal. Contarlos como aciertos ha estado escondiendo el defecto que más veces
aparece.

---

## PARTE A — Caso por caso, con fechas

`ancla` = distancia en sesiones entre el máximo con el que abre la secuencia del
detector y el del primer tramo etiquetado. `solape` = intersección sobre unión
de los dos intervalos.

| Caso | Dueño | v4 | Motivo | Estructura de v4 (fechas) | Estructura del dueño | Veredicto de la medición |
|---|---|---|---|---|---|---|
| ICE @04-13 | BASE | no | contexto | — | 29-ene→12-feb · 02-mar→27-mar · 08-abr→10-abr | **FN por diseño** |
| GOOGL @04-24 | BASE | BASE | ok | [15,7→12,9→3,2] 03-feb→09-mar · 18-mar→30-mar · 17-abr→21-abr | [22,0→3,2] 03-feb→30-mar · 17-abr→21-abr | acierto, **parte la taza en dos** (ancla 0, solape 1,00) |
| PNC @06-08 | BASE | BASE | ok | [19,0→8,9→3,5] 06-feb→19-mar · 21-abr→13-may · 27-may→02-jun | [18,8→8,9→3,5] 06-feb→09-mar · idem · idem | **acierto pleno** (ancla 0, solape 1,00) |
| KO @05-13 | BASE | BASE | ok | [9,0→4,8→3,2] 27-feb→25-mar · 09-abr→22-abr · 28-abr→04-may | [9,1→4,7→3,2] idem (min 21-abr) | **acierto pleno** |
| MPC-asc @06-02 | BASE | BASE | ok | [17,6→10,5→8,6] 30-mar→17-abr · 05-may→07-may · 20-may→27-may | idéntica | **acierto pleno** |
| MPC-sierra @03-30 | NO | no | reexpansión | evalúa [19,6→7,3] de **nov-ene**, corta con 9,1 | 05-mar→10-mar · 12-mar→16-mar · 19-mar→23-mar | acierto, **otra estructura** |
| NDAQ @12-17 | NO | **BASE** | ok | [11,2→8,8→3,8] **11-ago**→02-oct · 21-oct→18-nov · 28-nov→03-dic | [5,0→3,8→2,1] 12-nov→18-nov · 28-nov→03-dic · 11-dic→16-dic | **FP** · ancla **−66 ses**, solape **0,16** |
| V @07-24 | NO | no | no lateral | ancla en **abr-jun** | 06-jul→09-jul · 16-jul→23-jul | acierto, motivo y periodo distintos |
| ORCL @05-28 | NO | no | contexto | — | 22-abr→30-abr · 07-may→20-may · 22-may→27-may | **acierto pleno** (mismo motivo) |
| AMT @08-19 | NO | no | última ancha | seq [17,6→9,9] jun-ago | — (lateral perpetuo) | acierto, motivo distinto |
| BEKE @08-19 | NO | **BASE** | ok | [30,1→10,4→3,7] 13-may→26-jun · 16-jul→24-jul · 03-ago→06-ago | — («solo el de 17-jul, y es pequeño») | **FP** |
| CPT @08-19 | NO | no | menos de 2 | 10 legs sin secuencia | — («intentos, ninguno claro») | acierto alineado |
| DECK @08-19 | BASE | no | contexto | — | 26-feb→27-mar · 21-abr→15-may · 27-may→jun | **FN por diseño** (confianza baja) |
| ELV @08-19 | NO | **BASE** | ok | [16,8→4,7] 14-jul→28-jul · 29-jul→05-ago | — («ruidoso») | **FP** |
| FCX @08-19 | BASE | BASE | ok | [22,5→10,9→11,1→7,9] 17-jun→08-jul … 10-ago→14-ago | acepta la lectura del detector | **acierto pleno** |
| FLG @08-19 | BASE | BASE | ok | [11,7→4,6] **16-jul**→27-jul · 03-ago→10-ago | 18-dic→28-ene **y** 09-feb→05-jun | acierto, **estructura no etiquetada** |
| IP @08-19 | BASE | BASE | ok | [32,5→10,7] 12-feb→20-mar · **28-jul**→07-ago | «taza con asa / cheat» | acierto, **salta 88 sesiones y un mínimo un 12,8 % más bajo** |
| MSGS @08-19 | NO | **BASE** | ok | [9,8→8→6,2→3,6] 12-jun→17-jun … 06-ago→10-ago | — («poca profundidad, errático») | **FP** |
| NDSN @08-19 | BASE | BASE | ok | [8,9→4,6→3,5] **25-jun**→08-jul · 17-jul→20-jul · 28-jul→31-jul | seis tramos desde **19-feb** | acierto, ancla **+87 ses**, solape **0,20** |
| QRVO @08-19 | BASE | BASE | ok | [25,7→7,4] 27-may→15-jul · **29-jul→29-jul** | «posible cheat» (confianza media) | acierto, **2.º tramo = una sola barra** |
| VPG @08-19 | NO | no | reexpansión | [30,4→16,3→10,2], corta con 16,7 | — | acierto alineado |

**Aciertos plenos (7)**: PNC, KO, MPC-asc, ORCL, CPT, FCX, VPG.
**Aciertos con estructura distinta (8)**: GOOGL, MPC-sierra, V, AMT, FLG, IP,
NDSN, QRVO.
**Fallos (6)**: ICE y DECK (falsos negativos por contexto), NDAQ, BEKE, ELV y
MSGS (falsos positivos).

---

## PARTE B — Los fallos, agrupados por causa

Cuatro causas cubren los seis fallos y los ocho aciertos parciales.

### Causa 1 — el detector no distingue una contracción de un desplome (5 casos)

Es la causa más repetida y la que no estaba identificada. Una contracción de
volatilidad es un **proceso**: la oferta se agota a lo largo de sesiones. Un
hueco por noticia es un **evento**: el precio salta y el resto de la caída no
existe. La secuencia de profundidades no los distingue, porque los dos dejan
el mismo número.

Medido: qué fracción de la primera contracción se produce en su **peor sesión**.

| Caso | Dueño | Tramo 1 | Peor sesión | Fracción |
|---|---|---|---|---|
| GOOGL | BASE | 23 sesiones, 15,7 % | 2,5 % | **16 %** |
| QRVO | BASE | 33 sesiones, 25,7 % | 5,5 % | **21 %** |
| BEKE | NO | 30 sesiones, 30,1 % | 6,5 % | 22 % |
| KO | BASE | 18 sesiones, 9,0 % | 2,1 % | **23 %** |
| IP | BASE | 25 sesiones, 32,5 % | 7,8 % | **24 %** |
| PNC | BASE | 28 sesiones, 19,0 % | 5,2 % | **28 %** |
| NDSN | BASE | 8 sesiones, 8,9 % | 2,6 % | **29 %** |
| MPC-asc | BASE | 13 sesiones, 17,6 % | 5,5 % | **31 %** |
| FCX | BASE | 13 sesiones, 22,5 % | 6,9 % | **31 %** |
| — hueco — | | | | |
| MSGS | **NO** | **3 sesiones**, 9,8 % | 3,8 % | **38 %** |
| NDAQ | **NO** | 37 sesiones, 11,2 % | 4,5 % | **41 %** |
| FLG | BASE(otra) | 7 sesiones, 11,7 % | 5,8 % | **50 %** |
| ELV | **NO** | 10 sesiones, 16,8 % | 8,5 % | **51 %** |

Los ocho casos cuya estructura el dueño acepta están **todos** por debajo del
32 %; los tres falsos positivos que quedan tras descontar BEKE están todos en el
38 % o por encima. Las dos excepciones aparentes se explican solas: BEKE cae del
lado bajo y el dueño lo rechaza por otro motivo —el que ninguna regla alcanza
(§B, causa 4)—, y FLG cae del lado alto siendo un «BASE», pero la estructura que
el detector marca en FLG **no es la que el dueño etiquetó** (§D.2).

Lo que hay detrás, mirado en los datos crudos:

- **ELV** cae de 436,24 a 362,98 en dos semanas, con una sola sesión del −8,5 %
  y volumen 1,48x. Es un desplome de aseguradora, no una base. El dueño escribió
  «gráfico ruidoso, nada claro».
- **MSGS** hace su «primera contracción» en **tres sesiones** (12→17 de junio).
- **QRVO** tiene como segunda contracción una **única barra**, la del 29 de julio
  (o 86,40 · h 92,39 · l 85,51 · c 89,50, rango del 8,0 %, volumen 2,18x). Es un
  día de resultados, no un tramo.

### Causa 2 — la base se construye saltándose lo que hay en medio (4 casos)

El detector elige el ancla (el máximo más alto que pasa el umbral) y luego
encadena tramos cuyo máximo esté a menos de 4 ATR del techo. **Nunca comprueba
qué pasó en lo que se salta.**

- **IP** es el caso de manual. v4 pega la caída del 12-feb→20-mar (32,5 %) con
  una contracción del 28-jul→07-ago (10,7 %), y entre las dos hay **88 sesiones**
  en las que el precio hizo un mínimo de **28,51 el 21 de mayo — un 12,8 % por
  debajo** del suelo de la secuencia. Los dos tramos que junta pertenecen a
  estructuras distintas. La lectura humana (taza con fondo en mayo, asa en
  julio-agosto) es coherente; la del detector no.
- **NDSN**: el dueño lee seis tramos desde el 19 de febrero; v4 ancla el 25 de
  junio. **+87 sesiones.**
- **NDAQ**: v4 ancla el 11 de agosto de 2025 y el dueño el 12 de noviembre.
  **−66 sesiones**, solape 0,16.
- **FLG**: v4 marca 16-jul→10-ago; el dueño nombra 18-dic→28-ene y 09-feb→05-jun.
  No hay solape ninguno.

NDAQ y FLG aparecen en esta causa y en la anterior: fallan por partida doble.

Esta causa ya estaba descrita como «el ancla se queda corta» y como problema de
escala. Lo que añade esta medición es que **también se queda larga** (IP, NDAQ)
y que el síntoma es medible sin etiquetas: el mínimo real de la ventana queda
por debajo del suelo de la secuencia, o hay un hueco desproporcionado entre
tramos.

### Causa 3 — el filtro de contexto tumba dos bases estructuralmente válidas (2 casos)

ICE y DECK. Es la decisión de producto ya tomada, no un defecto: los dos
fracasaron. Sin novedad respecto a v4.

### Causa 4 — falta el concepto de «esto no va a ningún sitio» (1 caso, +1 acertado por otro motivo)

**BEKE** es el único falso positivo que ninguna regla nueva alcanza, y AMT es el
único acierto cuyo motivo sigue siendo el equivocado. Los dos necesitan R1
(lateral perpetuo) o R2 (anidamiento), que siguen sin medida — y esta sesión ha
comprobado que **no la tienen** (§C.6).

---

## PARTE C — Las reglas candidatas

Para cada una: qué caso la revela, cómo se formularía, y cuántos de los 21
cambiarían de veredicto. La simulación aplica cada condición a posteriori sobre
lo que v4 ya detectó (`reglas-simulacion.mjs`), sin tocar el detector.

### C.1 — R7: la primera contracción tiene que ser un proceso, no un evento

- **La revela**: ELV, y la confirman MSGS, NDAQ y FLG.
- **Formulación**: *la mayor caída de una sola sesión dentro de la primera
  contracción no puede explicar más de un tercio de su profundidad*. Con cierres,
  no con rango intradía.
- **Cuántos cambian**: **4 de 21**. Tres falsos positivos pasan a rechazo
  (NDAQ, ELV, MSGS) y FLG pasa de acierto contable a rechazo. **15/21 → 17/21**,
  con BEKE como único falso positivo.
- **Por qué no es sobreajuste, y dónde sí lo sería**: la regla es estructural y
  viene del concepto, no del corpus — un hueco por noticia no es una contracción
  de volatilidad. **El número (un tercio) sí saldría de estos 21 y no debe
  fijarse aquí.** Se valida en el universo, que no necesita etiquetas: aplicada a
  los 36 marcados reproducibles de la muestra de 400, quita **10 (28 %)** y la
  cobertura baja del 9,3 % al 6,5 %. Y lo que quita se sostiene solo con mirarlo:

  | | Estructura | Tramo 1 | Peor sesión |
  |---|---|---|---|
  | PSA | [8,3→3,3] | **1 sesión** | 44 % de la caída |
  | OZK | [8,5→6,9→3,4] | 4 sesiones | **67 %** |
  | ACHC | [25,7→8,1] | 6 sesiones | **64 %** |
  | VG | [21,6→9,0] | 3 sesiones | 48 % |
  | FIVE | [26,6→5,9] | 34 sesiones | 52 % |

  La mediana de los 36 es 0,30 y el percentil 75 es 0,38: el corte no está en la
  cola, está donde la distribución se abre.

### C.2 — R8: la base no puede saltarse su propio suelo

- **La revela**: IP (12,84 %). El segundo caso, FLG, perfora un 0,51 %: tan poco
  que ninguna tolerancia razonable lo cazaría, y es correcto que no lo haga.
- **Formulación**: *entre el máximo que ancla la base y el corte, ningún cierre
  puede quedar por debajo del suelo de la secuencia de forma sostenida. Si lo
  hace, la base termina ahí y hay que reanclar a partir de ese punto.*
- **Cuántos cambian**: **1 de 21** con tolerancia del 2 % (IP). En sí/no eso es
  **15/21 → 14/21**; en la contabilidad con estructura no pierde nada, porque el
  acierto de IP era falso.
- **Ya existe implementada**: es exactamente la zona de salida de v5 aplicada al
  revés — cortar y reanclar en lugar de descartar. Ver §E.

### C.3 — R9: los mínimos de la secuencia no se perforan entre sí

- **La revela**: NDAQ (mínimos 85,61 → **83,94** → 86,94; perfora un 1,95 %).
- **Formulación**: *el mínimo de una contracción no puede quedar por debajo del
  mínimo de la anterior.* Es la vieja `lower_low_drift` medida **entre tramos**,
  no barra a barra — la que v3 quitó saltaba con perforaciones intradía del
  0,31 % al 0,66 %; esta mide otra cosa.
- **Cuántos cambian**: **2 de 21**, y se compensan: NDAQ pasa a rechazo (+1) y
  **GOOGL pasa a rechazo (−1)**. Neto cero.
- **Está bloqueada por otro defecto**: GOOGL solo la incumple porque v4 parte la
  taza en dos (15,7 % + 12,9 %) y el fondo de la taza queda por debajo del mínimo
  del primer trozo. En la lectura del dueño (22,0 → 3,2) los mínimos ascienden
  (271,95 → 331,15) y la regla se cumple sin reparos. **Arreglar la fusión de la
  taza desbloquea esta regla**; sin arreglarla, aplicarla no aporta.

### C.4 — R10: la segunda contracción tiene que contraerse de verdad

- **La revela**: MSGS (9,8 → 8,0, un −18 %) y NDAQ (11,2 → 8,8, un −21 %).
- **Formulación**: *la segunda contracción debe reducirse sustancialmente
  respecto a la primera; una secuencia de tramos de tamaño parecido es un canal,
  no una contracción.*
- **Cuántos cambian**: **3 de 21** — NDAQ y MSGS a rechazo (+2), GOOGL a rechazo
  (−1). Neto +1.
- **Mismo bloqueo que R9, y solapa con R7**: los positivos van del −40 % (MPC) al
  −71 % (QRVO) y los dos negativos están en −18 % y −21 %; el único positivo en la
  zona baja es otra vez GOOGL por la taza partida. Sobre el universo quita solo 4
  de 36 (11 %). Es una regla real pero redundante con R7 en los dos casos que
  tiene: no aporta por sí sola.

### C.5 — Regla profundidad-tiempo del libro: medida y descartada por ahora

`semanas exigidas = 3 + 0,8 · max(0, profundidad% − 15)` (TLSMW p. 212, ya usada
en v3). Aplicada a las 13 secuencias, marca dos como inmaduras: **BEKE** (13,4
semanas cuando exige 15,1) y **FCX** (8,6 cuando exige 9,0). Uno es falso
positivo y el otro es positivo del dueño: **cambia 2 y el neto es cero**. Los dos
están al borde. No la propongo como puerta, pero deja una observación útil: los
dos «cheats» del corpus (QRVO 11,6 vs 11,5 exigidas; IP 25,8 vs 17,0) son bases
que **apuran el mínimo de tiempo**, lo cual es coherente con lo que el cheat es
— una entrada antes de que la base madure.

### C.6 — Lo que se ha medido y NO separa

Conviene dejarlo escrito para que no se vuelva a intentar:

| Medida | Idea | Resultado |
|---|---|---|
| Avance en 130 sesiones | R1, lateral perpetuo | **No separa**: BEKE −0,2 % (NO) contra FLG −0,8 % e IP −13,4 % (BASE) |
| Rango de 52 semanas | R1 | **No separa**: AMT 22,6 y CPT 21,3 son noes; KO 20,9 es un sí |
| Eficiencia de Kaufman a 130 sesiones | R3, calidad del trazo | **No separa**: BEKE 0,001 y FLG 0,005 caen juntos; MSGS 0,203 es el más alto y es un no |
| Densidad de pivotes | R3 | **No separa**: CPT y MSGS empatan a 19,3 (noes) con NDSN 17,9 (sí) |
| Hueco de apertura / ATR | R3 | Solo aísla BEKE (0,58 frente a 0,12-0,33). **Un caso no es una regla** |
| Peso de la base en la estructura mayor | R2, anidamiento | **No separa**: BEKE 91 % del rango anual, pero QRVO 81 % e IP 79 % son síes |
| Estabilidad de la lectura al mover la ventana | R3 | **No separa**: MSGS es estable del todo (8/8, una estructura) y es un no; IP aparece en 3/8 y es un sí |
| Nº de estructuras distintas al mover la ventana | R2 | Aísla NDAQ, y **BEKE solo si el barrido llega a 250 sesiones** — depende de cuánta historia haya. Frágil |

**R1 (lateral perpetuo) y R3 (calidad del trazo) siguen sin medida después de
probar siete candidatas.** Ese es el resultado, y no conviene forzar una octava.

---

## PARTE D — Etiquetas que hay que revisar

La tanda anterior descubrió que un supuesto falso positivo no lo era porque la
etiqueta estaba incompleta (MPC). Hay **cuatro casos más** en esa situación, y
uno de ellos tiene una explicación material.

### D.1 — NDAQ: el dueño no pudo ver la estructura que el detector marca

Los gráficos de etiquetado —los de las dos tandas— cubren **199 sesiones, de
2025-11-03 a 2026-08-19** (`graficos.html`, `graficos-tanda2.html`). v4 ancla
NDAQ el **2025-08-11**, sesenta sesiones antes de que empiece el gráfico.

Lo que el dueño juzgó fue la estructura de nov-dic (5,0 → 3,8 → 2,1, «geometría
ascendente limpia pero primera contracción de solo 2,7x ATR»), que es la única
que estaba dibujada. Lo que v4 marca es otra (11,2 → 8,8 → 3,8, ago-dic) sobre la
que **no hay etiqueta**.

Y hay una comprobación que lo respalda: si al detector se le restringe la ventana
a lo que el gráfico enseñaba (`lookback: 40`, unas ocho semanas), NDAQ sale
`menos_de_2_contracciones` — coincide con el dueño. **El desacuerdo es de
ventana, no de criterio.**

Esto no absuelve a NDAQ: su estructura larga sí perfora mínimos (R9) y sí es una
escalera (R10), y el desenlace fue malo (rompió, +7,8 % y luego −24 %). Pero
contarlo como falso positivo del *criterio* es incorrecto mientras nadie haya
juzgado esa estructura.

> **Consecuencia de método**: los gráficos de etiquetado deben cubrir, como
> mínimo, la ventana que el detector mira (140 sesiones de estructura, y la SMA
> de 150 por detrás). Con 199 sesiones y el corte en cualquier fecha anterior a
> agosto, el etiquetador ve menos que el detector. Es barato de arreglar y evita
> desacuerdos que no son desacuerdos.

### D.2 — FLG: las dos bases etiquetadas ya estaban resueltas en la fecha de corte

El corpus define `asOf` como *«la estructura ya está completa pero aún no
resuelta»*. En FLG el dueño etiquetó **18-dic→28-ene** y **09-feb→05-jun**, y el
corte es el **19 de agosto**: las dos habían resuelto hacía semanas o meses. Lo
que el detector marca (16-jul→10-ago) no es ninguna de las dos.

Como está, **FLG no es evaluable como sí/no a fecha de corte**: la etiqueta y el
detector hablan de cosas distintas, y el «acierto» es un empate contable. Hace
falta preguntar explícitamente: *¿la caída de julio-agosto es una base?* La
respuesta cambia el veredicto de R7 (§C.1) en un caso.

### D.3 — IP: falta la lectura con fechas, y la que se intuye no cabe en el detector

El dueño escribió «taza con asa, cheats, como el de GOOGL» sin dar tramos. Los
datos dicen que la taza real va del máximo **48,47 (12-feb)** al mínimo **28,51
(21-may)**: una caída del **41,2 %**, con el asa en julio-agosto. Eso encaja con
su descripción, y **no cabe en el detector**: el tope `firstContractionMaxPct` es
del 35 %. v4 acierta el veredicto ensamblando dos tramos de estructuras
distintas. Merece una etiqueta con fechas antes de sacar conclusiones sobre el
tope.

### D.4 — QRVO y DECK: confianza declarada baja o media

- **QRVO** (`confianza: media`, «posible cheat»): la segunda contracción que v4
  usa es una sola barra, la del 29 de julio. Aunque el veredicto coincida, la
  estructura no se sostiene, y la etiqueta no dice cuál es la buena.
- **DECK** (`confianza: baja`, «se podría considerar un intento; tampoco tenía una
  tendencia demasiado buena», «acabó fracasando») tiene además un tramo con la
  fecha incompleta (`min: "2026-06"`). Cuenta como falso negativo contra el
  detector, y el propio dueño no lo defiende.

### D.5 — BEKE, con menos motivo de duda

El dueño escribió «no veo un patrón claro **más allá** del que comienza el 17 de
julio», lo cual implica que la estructura de mayo-agosto que v4 marca tampoco le
parece patrón claro. Es la etiqueta más defendible de las cinco; aun así,
confirmarlo cuesta una frase y cierra el único falso positivo que queda.

---

## PARTE E — La zona de salida: la conclusión de v4 no se sostiene al mirar las fechas

v4 concluyó que la banda **mide peor** (14/21 frente a 15/21) porque cambia un
veredicto y lo cambia a peor: IP pasa de BASE a `fuera_de_rango`. Reproducido y
confirmado: es el único caso que cambia, en 20 de 21 la banda es **inerte** (no
hay salida que registrar).

Pero con las fechas delante, ese único caso se lee al revés. La banda de IP
detecta una **rotura el 2026-05-01, 75 sesiones antes del corte**. Ese es
exactamente el momento en que el precio perdió el suelo de la secuencia y bajó a
28,51, un 12,8 % por debajo (§B, causa 2). **La banda no se equivoca: está
señalando que la estructura que v4 le entrega está mal formada.** Lo que falla es
la contabilidad, que apunta el rechazo como error porque el dueño dijo «base»
refiriéndose a otra estructura.

Tres conclusiones, y ninguna es la de v4:

1. **La banda no empeora la medición; empeora el marcador.** En la contabilidad
   con estructura, v5 ≥ v4: v4 tiene un acierto falso más.
2. **La banda tampoco es la pieza que falta.** Es inerte en 20 de 21 casos. Con
   las reglas nuevas de la tanda 1 ya incorporadas en v4, no aporta nada más.
3. **Donde sí aporta es en otro papel.** Hoy la banda solo sabe *descartar* («la
   base salió y caducó, fuera»). Usada para *cortar y reanclar* es la regla R8
   (§C.2), que ataca la segunda causa más frecuente de fallo. En IP, reanclar
   después del 1 de mayo devuelve `primera_contraccion_superficial` — no hay
   base a partir de ahí, y la que el dueño ve necesita una primera contracción
   del 41,2 %, por encima del tope actual.

La recomendación de v4 («quitar `ceiling_break` y sustituirlo por la zona de
salida») sigue en pie. Lo que cambia es el motivo: no por el marcador, sino
porque es la única pieza que sabe decir dónde se acaba una base.

---

## PARTE F — Qué implementar y qué necesita más corpus

### Implementar ya

1. **R7 — la primera contracción debe ser un proceso, no un evento** (§C.1).
   Es la única regla nueva que mejora la medición por sí sola (15/21 → 17/21),
   la única validada fuera del corpus (quita 10 de 36 en el universo, y lo que
   quita son desplomes de una a seis sesiones), y la única cuya formulación no
   depende de un número fino. **El umbral del tercio no se fija con estos 21
   casos**: se fija mirando la distribución del universo, que está medida y no
   necesita etiquetas.
2. **R8 — cortar y reanclar donde el precio sale de la banda** (§C.2). No mejora
   el marcador, pero elimina el peor defecto estructural que queda: bases
   ensambladas con tramos de estructuras distintas. Es la zona de salida ya
   calibrada, en otro papel.

### Arreglar antes de que otras reglas puedan entrar

3. **La fusión de la taza.** GOOGL bloquea R9 y R10 él solo, y es un problema
   conocido desde v4 (documentado en `detector/v4.mjs`, comentario del bloque de
   fusión). Mientras no se arregle, esas dos reglas empatan a cero. Con la taza
   bien leída, R9 y R10 pasan a valer +1 cada una sin coste.

### Necesita más corpus, y ahora se sabe exactamente cuál

4. **R1 (lateral perpetuo) y R3 (calidad del trazo)** siguen sin medida después
   de probar siete candidatas (§C.6). No son un problema de ajuste: **ninguna de
   las magnitudes obvias separa**. Hasta que haya más casos, no hay nada que
   implementar.
5. **Cerrar las cinco etiquetas de la Parte D**, empezando por FLG e IP, que son
   los que cambian veredictos. Cuesta cinco preguntas.
6. **Generar los gráficos de etiquetado con la ventana del detector** (§D.1).
   Es un cambio en `build-charts.mjs`, no en el detector, y evita desacuerdos
   que no lo son.

### Y la respuesta a la pregunta de fondo

**El detector no está en su techo, pero está cerca, y el corpus sí.** Queda una
regla real por implementar (R7) y un defecto por arreglar (la fusión de la taza)
que desbloquea otras dos. Con eso, el corpus llega a 17 o 18 de 21 y **los fallos
que quedan son todos de etiqueta o de contexto, no de criterio**: ICE y DECK son
decisiones de producto ya tomadas, FLG es una etiqueta que habla de otra cosa, y
BEKE necesita un concepto que estos 21 casos no pueden dar.

A partir de ahí, subir de 17 exige etiquetas nuevas —y de un tipo concreto: casos
laterales perpetuos y gráficos erráticos etiquetados **con tramos**, también
cuando la respuesta es NO. Los seis «NO» del corpus con `tramos: []` no dejan
comprobar si el detector falla en el veredicto o en el sitio.

Si se implementa R7 y se arregla la taza, **la precisión estimada sobre lo que el
detector enseñaría pasa de 5 de 8 (62,5 %) a 4 de 5 (80 %)**, con la cobertura
bajando del 9,3 % al 6,5 % del universo líquido. Es una estimación sobre cinco
casos y no debe tratarse como una medida.

---

## LO QUE NO HE VERIFICADO

1. **El umbral de R7 (un tercio) sale de estos 21 casos.** La regla es
   estructural; el número no está calibrado. La distribución del universo (36
   marcados) es la única evidencia externa y tiene mediana 0,30 y p75 0,38: el
   corte cae dentro de la masa, no en la cola. **Hay que fijarlo con el universo
   o con más etiquetas, no aquí.**
2. **R8 no se ha implementado ni medido como reanclaje.** Lo único medido es que
   la banda corta bien en IP y que el reanclaje manual con ventanas cortas
   devuelve `primera_contraccion_superficial`.
3. **El efecto de R7 sobre el universo se mide con 243 barras por símbolo**
   (desde 2025-09-01, como el arnés original), mientras que la medición del
   corpus usa las ~400 disponibles. Las dos corridas no son estrictamente
   comparables.
4. **La cifra de «7 de 21 con estructura correcta» depende de un criterio que he
   fijado yo**: veredicto correcto más ancla a ≤5 sesiones y solape ≥0,5, o —para
   los casos sin tramos etiquetados— que el dueño aceptara explícitamente la
   lectura del detector. Con otro criterio saldría otro número; el orden de los
   casos no cambiaría.
5. **Diez de los veintiún casos no tienen tramos etiquetados**: seis «NO» (AMT,
   BEKE, CPT, ELV, MSGS, VPG) y cuatro «BASE» que solo llevan anotada la lectura
   del detector (FCX, FLG, IP, QRVO). En esos diez la comparación de fechas no
   existe. Solo **nueve** de los veintiún casos tienen tramos con fechas
   completas, y son los nueve de la tanda 1.
6. **Sigue sin tocarse el detector de producción.** Nada de lo medido dice qué
   haría `lib/setupPatterns.js` con estos cambios.
7. **AAPL, JPM, MSFT, TXN y WELL** siguen con barras mensuales residuales. En
   este corpus no aparece ninguno de los cinco, así que la medición no está
   contaminada — pero la corrida del corpus antiguo sí (AAPL@2026-06-01 sigue
   saliendo BASE por la barra corrupta del 2026-03-01).

---

# ANEXO — La monotonía relajada, implementada y medida

<!-- añadido el 2026-08-21, misma sesión · BASE_SHA: 0184bfa -->

Encargo: implementar la monotonía relajada —*un tramo intermedio puede repuntar,
pero la última contracción tiene que ser la más superficial de toda la
secuencia*— y medir qué cambia, sin tocar ningún otro umbral.

**Una precisión de origen**: esta regla es **R5 del corpus**
(`corpus-manual.json` → `reglasPendientes`, «tolerancia a la no-monotonía»),
que reveló FCX. El cuerpo de este documento la daba por pendiente; las que
formula como nuevas son R7 a R10. La formulación exacta que se implementa aquí
es la de Alejandro.

## A — Qué se ha implementado

`research/contracciones/detector/v6.mjs`, prototipo de research. Producción sin
tocar. El diff contra v4 es de tres piezas y **ningún umbral cambia de valor**:

```js
// v4, dentro del bucle que encadena tramos:
if (leg.depth > seq.at(-1).depth * p.decreaseTol) {
  return rejL("reexpansion", …);        // ABORTA la detección entera
}
seq.push(leg);

// v6:
seq.push(leg);                          // un repunte intermedio ya no corta

// …y una sola comprobación al final, sobre la secuencia completa:
if (seq.at(-1).depth > Math.min(...seq.map((s) => s.depth))) {
  return rejL("ultima_no_es_la_mas_superficial", …);
}
```

`decreaseTol: 1.02` **sigue en el fichero pero ya no decide nada**; se deja para
poder correr los dos detectores con los mismos parámetros. La comprobación final
es sin tolerancia: «la más superficial» significa el mínimo de la secuencia.

Se reproduce con:

```bash
node --env-file=.env.local --loader ./scripts/loader.mjs research/contracciones/arneses/monotonia-test.mjs
```

y `monotonia-universo.mjs` / `monotonia-adelante.mjs` para los otros dos cortes.

## B — Contra los 21 casos: no cambia ni un veredicto ni una fecha

| | v4 | v6 |
|---|---|---|
| Aciertos | 15/21 | **15/21** |
| Falsos positivos | 4 (NDAQ, BEKE, ELV, MSGS) | **los mismos 4** |
| Falsos negativos | 2 (ICE, DECK) | **los mismos 2** |
| Estructuras (fechas) | — | **idénticas en los 13 casos con base** |

**Ningún caso que antes acertaba falla ahora.** La respuesta al punto 4 del
encargo es que no hay nada que detallar: cero regresiones en el corpus.

Lo que sí cambia son **dos motivos de rechazo**, y uno de ellos es una mejora
real:

| Caso | v4 | v6 |
|---|---|---|
| **MPC-sierra** | `reexpansion` sobre `[19,6 → 7,3]`, cortando al llegar al 9,1 | `tendencia_no_lateral` |
| **VPG** | `reexpansion` sobre `[30,4 → 16,3 → 10,2]`, cortando al llegar al 16,7 | `ultima_no_es_la_mas_superficial` sobre `[30,4 → 16,3 → 10,2 → 16,7 → 17,5 → 17,2]` |

En **MPC-sierra** el motivo pasa a ser **el que dio el dueño**. Su nota decía:
«profundidades oscilan, volumen no se seca, **techo avanza 3,3 %/semana**». v4 lo
rechazaba por la oscilación; v6 deja que la secuencia se complete y entonces la
mata el criterio de lateralidad — el avance del techo. Es el mismo veredicto por
la razón correcta, que es justo lo que este documento venía señalando como
problema en cinco casos más.

### Y un beneficio que no se ve en el marcador: FCX deja de colgar de un hilo

FCX es `[22,5 → 10,9 → 11,1 → 7,9]` y el dueño lo acepta sin reparos. Su tercer
tramo repunta un **1,13 %** sobre el segundo (10,9415 % → 11,0653 %) y la
tolerancia de v4 es del 2 %: lo salvaba **por 0,095 puntos porcentuales**
(el límite estaba en 11,1603). Medido bajando solo esa tolerancia:

| | v4 con `decreaseTol` 1,02 | 1,01 | 1,00 | v6 |
|---|---|---|---|---|
| FCX | BASE | **rechazado** | **rechazado** | **BASE** |

Un positivo etiquetado dependía de que la tolerancia fuera 1,02 y no 1,01. Con
v6 no depende de nada: el repunte está permitido por definición. **Ese es el
argumento a favor de la regla, y no aparece en ningún marcador.**

## C — Contra la muestra de 400: ensancha el filtro un 21 %

| | v4 | v6 |
|---|---|---|
| Marcados | 38 (9,5 %) | **46 (11,5 %)** |
| Nuevos | — | **8** |
| Perdidos | — | **0** |
| Con la misma base y otras fechas | — | **0** |

> v4 marca hoy 38 y no los 37 de `universo-v4.json`: la corrida original es del
> 21 de agosto y hay una sesión más de datos. Entran MEDP y RLI, sale SMG. No
> afecta a la comparación, que corre las dos versiones sobre las mismas barras.

El reparto de motivos enseña la mecánica: `reexpansion` pasa de **106 a 0**, y
de esos 106, **91 reaparecen** como `ultima_no_es_la_mas_superficial`, 8 pasan a
`ok`, y el resto se reparte entre `tendencia_no_lateral` (3 → 9) y
`ultima_contraccion_ancha` (15 → 16). La regla no es un colador: filtra casi lo
mismo, por una condición distinta.

Los ocho nuevos, con su estructura:

| | Estructura | Reparo a simple vista |
|---|---|---|
| CM | [9,6 → 3,7 → 3,4 → **5,5** → 3,5 → 2,5] | primera contracción en 3 sesiones |
| DHT | [19,1 → 7,3 → **8,1** → 6,5] | — |
| **DY** | [23,8 → 9,6 → **27,9** → 7,6] | **el tramo intermedio es más profundo que el ancla** |
| GM | [18,1 → 14,8 → 5,7 → **7,2** → **13,1** → 4,9] | seis tramos, de febrero a julio |
| HAS | [17,8 → 10,4 → **16,5** → 8,1] | el mínimo real queda un 8,5 % por debajo de la secuencia |
| JPM | [14,5 → 5,3 → **8,3** → 4,8 → **5,4** → 4,6] | JPM tiene barras mensuales residuales conocidas |
| SAN | [21,1 → 6,4 → **10,7** → 6,9 → 6,4 → 3,4] | — |
| **TER** | [28,5 → 19,2 → 11,4 → **19,1** → **39,2** → 11,1] | **un tramo del 39,2 %, más profundo que el ancla** |

Dos de los ocho contienen un tramo **más profundo que la primera contracción**.
Eso no necesita etiqueta para juzgarse: contradice la definición de contracción
de volatilidad. La regla, tal como está formulada, **no pone techo al repunte**,
y ahí es por donde entran.

## D — La prueba hacia delante: lo que añade rinde peor que no filtrar

Sin etiquetas humanas, con el método de `peso-escala.mjs`: tres cortes pasados
(15-dic-2025, 13-feb-2026, 15-abr-2026), 1.200 pares valor-fecha, y se mira qué
hizo el precio después.

| Grupo | n | Duración | Horizonte | Rendimiento | Caída máx | Rompió | Y aguantó |
|---|---|---|---|---|---|---|---|
| universo | 1200 | — | 50 ses | 3,22 % | −10,09 % | — | — |
| **común** (v4 y v6) | 97 | 6 sem | 59 ses | **8,33 %** | **−6,58 %** | 79 % | 59 % |
| **nuevo** (solo v6) | 10 | 18 sem | 160 ses | **−5,21 %** | **−17,37 %** | 70 % | 60 % |

Con el mismo horizonte que el universo, que es la única comparación limpia
—el proporcional le da 160 sesiones a los nuevos y 50 al universo—:

| Grupo | n | Rendimiento a 50 ses | Contra el universo |
|---|---|---|---|
| común | 97 | 8,53 % | **+5,31 pts** · caída **+4,35 pts** mejor |
| nuevo | 10 | −5,00 % | **−8,22 pts** · caída −0,57 pts |

**Siete de los diez pierden dinero**, y los cuatro que llevan un tramo más
profundo que el ancla tienen una mediana del −6,50 % frente al +2,70 % de los
otros seis. Lo que la regla añade no solo no bate al universo: queda ocho puntos
por debajo.

**n = 10.** Es ruido, y lo digo antes de que lo diga nadie. Pero no hay ni un
indicio en la otra dirección.

### Cruzado con las reglas del cuerpo de este documento

Aplicando a los ocho nuevos R7 (§C.1, proceso frente a evento) y R8 (§C.2, la
base no se salta su suelo):

| Sobrevive | Cae por R7 | Cae por R8 |
|---|---|---|
| DY, GM, JPM | CM (54 %), DHT (35 %), SAN (37 %), TER (68 %) | HAS (8,5 % por debajo) |

**Cinco de los ocho caen solos** en cuanto R7 y R8 estén. De los tres que
sobreviven, DY moriría con el tope del repunte en el ancla y JPM arrastra barras
corruptas conocidas. Es decir: **la regla es inofensiva acompañada y arriesgada
sola.**

## E — Punto 5: no arregla ninguna fecha, y no puede

La pregunta era si la regla ayudaría en los casos donde el detector acertaba el
sí/no pero situaba mal las contracciones — FLG, IP, NDSN. **La respuesta medida
es no: cero cambios de fechas en los 21 del corpus y cero en los 400 del
universo.**

Y no es casualidad, es estructural. v4 **aborta** la detección en cuanto
encuentra un repunte; por tanto, ninguna base que v4 acepte contiene uno. v6
solo puede añadir casos que v4 rechazaba, nunca reescribir los que aceptaba:
**v6 ⊇ v4, y las estructuras de la intersección son idénticas.** La regla es
puramente aditiva, así que por construcción no puede corregir un ancla mal
puesta.

### Y de paso, por qué NDSN sigue anclando en junio

Es la pregunta natural —el dueño lo lee desde el 19 de febrero con una
reconfiguración en medio, que suena a lo que la monotonía relajada debería
arreglar— y la respuesta descarta la sospecha. Los tramos de NDSN dentro de la
ventana del detector (2026-01-29 → 2026-08-19, así que **febrero sí entra**),
medidos contra el ATR de su fecha:

| Tramo | Profundidad | En ATR | Máximo |
|---|---|---|---|
| 19-feb → 20-feb | 5,9 % | 2,9x | 303,48 |
| **25-feb → 09-mar** | **11,2 %** | **4,9x** ✓ | **296,42** |
| 06-may → 19-may | 6,8 % | 3,3x | 289,20 |
| **25-jun → 08-jul** | **8,9 %** | **3,6x** ✓ | **307,74** |

Solo dos pasan el umbral de 3,5x ATR, y el ancla se define como **el máximo más
alto de los que lo pasan**: 307,74 (junio) gana a 296,42 (febrero). El tramo de
febrero existe, es más profundo y pasa el umbral — pero arranca de un máximo
once puntos más bajo.

**Lo que impide leer NDSN como el dueño no es la monotonía: es la regla del
máximo más alto**, la misma que en la tanda 1 arregló PNC, KO y MPC. En una base
con techo ascendente —una reconfiguración— esa regla ancla siempre en el tramo
más reciente. Es un hallazgo nuevo, va a la causa 2 de §B, y no se arregla con
esta regla ni con ninguna de las de §C.

## F — La variante que la medición pide: acotar el repunte al ancla

No es un umbral nuevo —el tope es la propia primera contracción—, así que se ha
medido, con la opción `topeRepunteEnAncla` **apagada por defecto** para no
mezclarla con lo que se pidió implementar.

| | Corpus | Universo | Nuevos que deja pasar | Rendimiento de esos |
|---|---|---|---|---|
| v6 tal cual | 15/21, 0 cambios | 46 (11,5 %) | 8 | −8,22 pts contra el universo |
| v6 + tope en el ancla | **15/21, 0 cambios** | 43 (10,8 %) | 5 | −8,22 pts (n=6) |

Quita DY, TER y RLI. Los dos primeros son los que llevan un tramo más profundo
que el ancla; RLI (`[10,6 → 10,6 → 4,9]`) ya lo marcaba v4 y **se pierde**, así
que el tope no es gratis. Sobre el corpus no cambia nada.

Mi lectura: el tope tapa el agujero más evidente y no cuesta nada en el corpus,
pero **con horizonte comparable sigue sin batir al universo**. Es una mejora de
la formulación, no una solución.

## G — Recomendación

**La regla está bien planteada y no debería activarse sola.** Las dos cosas a la
vez:

1. **Bien planteada**: FCX es un positivo etiquetado que hoy sobrevive por
   0,095 puntos porcentuales de tolerancia —su repunte es del 1,13 % y el margen
   del 2 %, así que con un 1 % se caería—, y eso no se sostiene. La condición
   «la última es la más superficial» expresa lo que el dueño lee y no depende de
   un margen arbitrario. Además arregla el motivo de rechazo de MPC-sierra.
2. **No sola**: cuesta **+8 marcados en 400** (9,5 % → 11,5 %) y lo que entra
   rinde **8 puntos por debajo del universo** en la prueba hacia delante, con
   siete de diez en pérdidas. En un detector cuyo problema declarado es la
   precisión (62,5 %), ensanchar un 21 % la superficie va en dirección
   contraria.

**Orden que propongo**: entra **después** de R7 y R8, no antes. Con las dos
puestas, cinco de los ocho nuevos caen solos, y el coste de la regla baja a tres
marcados —de los cuales uno (DY) muere también con el tope en el ancla y otro
(JPM) tiene barras corruptas. Entonces sí es lo que dice ser: una regla que
recupera FCX sin ensanchar nada.

Mientras tanto queda implementada, medida y apagada, en `detector/v6.mjs`.

## Lo que no he verificado en este anexo

1. **n = 10 en la prueba hacia delante**, y n = 6 para la variante. Es
   demasiado poco para concluir nada por sí solo; solo sirve porque apunta en la
   misma dirección que el reparo estructural (dos de los ocho tienen un tramo
   más profundo que el ancla).
2. **Los tres cortes están dentro de la misma ventana alcista** y se solapan.
   Mismo aviso que en v3 D.4 y en el documento de temporalidad §8.4.
3. **Nadie ha etiquetado los ocho nuevos.** Que DY y TER sean absurdos se ve en
   la estructura; de CM, DHT, GM, HAS, JPM y SAN solo tengo el rendimiento
   posterior, que no es lo mismo que el juicio del dueño — este corpus tiene un
   caso, ICE, donde base válida y operación ganadora no coinciden.
4. **JPM está entre los cinco símbolos con barras mensuales residuales.** Su
   base nueva es sospechosa por esa vía, no solo por la regla.
5. **La variante del tope en el ancla no se ha medido en el corpus antiguo** ni
   se ha cruzado con la zona de salida de v5.
6. **v6 no incluye nada más**: ni la zona de salida, ni R7, ni R8. La medición
   de la combinación R5+R7+R8 de §D es un cruce a posteriori sobre los ocho
   nuevos, no una corrida de un detector que las tenga todas.
