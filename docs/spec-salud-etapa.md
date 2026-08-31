# Spec — Índice 0–100 de salud de etapa (MET-5)

- **Fecha:** 2026-08-31
- **Rama:** `codex/statsedge-ui-polish`
- **Estado:** **aceptado** por el dueño 2026-08-31 (con addendum abajo). Implementación = muestreo pre-5b → **MET-5b**.
- **Contratos reconciliados:** `docs/spec-muletas-tendencia.md` (aceptado, MET-4) · `docs/spec-rs-global-multi-mercado-fx.md` (MET-1) · `docs/spec-rs-pais.md` (MET-2) · `docs/spec-rs-tema.md` (MET-3) · `docs/principios-producto.md` · decisión dueño 2026-08-27 (`docs/backlog-activo.md`) · código vivo (`lib/weeklyStage.js`, `lib/trendSupport.js`, `lib/descriptiveStrip.js`, `lib/indicators.js`, `lib/marketVolume.js`, `lib/materializedScanner.js`) · auditoría etapas (`docs/auditoria-etapas-2026-08-16.md`, C-15, vía comentarios del código vivo).

### Addendum aceptación dueño (2026-08-31)

1. **Etapas con índice (v1):** solo **2 y 4** (analizadas). Coherente con la propuesta del spec.
2. **Etapas 1 y 3:** **fuera de v1** — quedan como **potenciales** para un track futuro **combinado con VCP / bases** (perfil propio de insumos, no reabrir aquí). No se muestra número 0–100 de «salud de etapa» en 1/3 hasta ese ticket.
3. **Umbrales (26 / 10 sem · extensión 15/50%):** muestreo **MET-5-calibrate** hecho (`scripts/stage-health-calibrate.mjs`, informe `docs/scratch/stage-health-calibrate.md`). Sobre lote nocturno US (~1208 filas; 505 E2 / 176 E4 con índice): salud p50≈70/66,5; p90−p10≈44 pts; ~30% E2 en techo 26 sem; extensión ≥50% casi nula en E4. **Recomendación orquestador: mantener 26/10/15/50.** Pendiente **OK explícito del dueño** → MET-5b.
4. Resto del spec (5 insumos, pesos, solo ficha, scoring off, `weeklyStage` intacto) **aceptado**.

---

## Veredicto

La **salud de etapa** es **un número entero 0–100 por símbolo** que responde una sola pregunta de mesa: **«¿con qué solidez sostiene el valor la etapa en la que está?»**. Es una **suma ponderada declarada** de cinco componentes, todos ya existentes en producto: los datos de las tres muletas de MET-4 (persistencia sobre las medias de 30 y 10 semanas, aceleración del avance, reparto up/down de volumen) más la **extensión sobre la media de 30 semanas** como penalización de fragilidad.

Propiedades duras:

1. **Relativo a la etapa, no re-codificación de la etapa.** El índice se define solo para las **etapas tendenciales (2 y 4)** y mide la solidez *dentro* de ellas: una Etapa 2 con salud 85 avanza con apoyo; una Etapa 2 con salud 30 avanza con la tendencia colgando de un hilo. **No** es un interruptor 1–4 continuo: dos símbolos en etapas distintas no se ordenan entre sí por este número.
2. **Absoluto por símbolo, no percentil.** Función determinista de las barras del propio valor; sin denominador cruzado, sin ranking, sin snapshot semanal. Un 70 no significa «mejor que el 70% del universo»: significa 70 de los 100 puntos definidos en la metodología.
3. **Sin veredicto.** Ni semáforo, ni «sana/débil», ni umbrales con nombre. El número se muestra con su desglose accesible; el usuario decide qué salud le basta.
4. **`lib/weeklyStage.js` no se modifica.** La clasificación de etapa, `stage2RejectDetail` e `isConfirmedStage2` quedan intactos; el índice **lee** la etapa y sus campos, nunca los corrige.
5. **Scoring off.** Nada entra en `objectiveScore`, `compositeScore`, `totalScore`, `weaknessScore` ni en scores persistidos. Sin job, sin tabla nueva, sin `engine_version`.

Las muletas MET-4 son **insumo** (sus mismos datos, ventanas y umbrales — una definición por métrica), pero el bloque «Sostén de la tendencia» de la ficha **sigue existiendo como tres lecturas independientes**: el índice las agrega bajo contrato propio, no las sustituye ni las colorea. La cláusula de MET-4 «no fusionar las muletas en un score sin spec MET-5» queda satisfecha precisamente por este documento.

Implementación = **MET-5-calibrate** (umbrales) → **MET-5b** (ficha), en ese orden.

---

## Resolución vs MET-1…4 / principios / dueño

| Cláusula | Origen | Resolución |
|---|---|---|
| Índice 0–100 de salud de etapa, **ponderado**, no interruptor 1–4 ni semáforo | Dueño 2026-08-27 (`docs/backlog-activo.md`), ticket MET-5 | **Gana.** Suma ponderada declarada, relativa a la etapa; sin categorías con nombre ni colores. |
| Muletas = insumo *candidato* del índice, no el índice | Ticket MET-5, spec MET-4 §Pregunta 9 | **Se cumple.** Tres de los cinco componentes consumen los datos MET-4 (mismas funciones de `lib/trendSupport.js`); el bloque de ficha MET-4b no cambia. |
| La herramienta clasifica, no recomienda | Principios §1 | **Se conserva.** El copy describe solidez de estado, nunca acción. Sin ordenación por salud en tabla (ordenar por un agregado y destacar el primero es señalar). |
| Tabla de 7 columnas; añadir exige quitar | Principios §7 | **Se conserva.** Sin columna nueva. Superficie v1 = ficha. |
| Dato ausente = ausente con motivo, no cero ni renormalización | Principios §3 | **Se conserva.** Índice todo-o-nada: si falta un componente, no hay índice — hay motivo (pregunta 8). |
| La metodología vive en un solo sitio | Principios §5 | **Se conserva.** Componentes, pesos, rampas y umbrales van a la página de metodología; la ficha muestra número + desglose, no fórmulas. |
| Etapa = solo precio vs media 30 + pendiente (D.14, C-4…C-15) | `lib/weeklyStage.js`, auditoría etapas | **Se conserva literalmente.** El índice no entra en la clasificación ni crea subtítulos «Etapa 2 sana/débil». La lección C-15 (etapa mostrada ≠ filtrada) no se repite: la salud no altera ningún filtro de etapa. |
| Una definición por métrica | MET-1…4 | **Se conserva.** El índice consume `consecutiveWeeksRelativeToMa`, `advanceAccelerationWord`/`ADVANCE_DEAD_BAND_PP`, `UP_DOWN_VOLUME_THRESHOLD`/`UP_DOWN_VOLUME_RATIO_BALANCED` y `distanceSlowMaPct` **tal cual existen**. Cero redefiniciones. |
| Scoring off por defecto | MET-1/2/3 pregunta scoring, MET-4 pregunta 6 | **Se conserva** (pregunta 6). |
| Pin RS global / motores país / tema; `rs_weekly_*` | MET-1b/2b/3b | **No se tocan.** El índice no lee ni escribe `rs_weekly_*`; el RS queda explícitamente fuera de los insumos (pregunta 2). |
| VCP / bases / pivote = track aparte | Backlog, principios §7 «Aplazado» | **Se conserva.** Ningún dato de `lib/setupPatterns.js` entra en el índice. |
| MET-4c opcional y paralelo, no requisito | Ticket MET-5 §Contratos 5 | **Se respeta.** Este spec no depende de MET-4c ni lo activa. |

---

## Definición

### Pregunta 1 — Qué es «salud de etapa» y qué no es

**Propuesta — frase de mesa (trader-facing):**

> **«¿Con qué solidez sostiene el valor la etapa en la que está?»**

Un solo número 0–100 junto a la etapa. En **Etapa 2**, salud alta = avance apoyado en sus medias, con ritmo y volumen a favor, sin sobreextensión. En **Etapa 4**, salud alta = declive firmemente en vigor (los mismos ingredientes, leídos en la dirección de la etapa) — lectura deliberada: es exactamente lo que la mesa de **Deterioro** necesita para distinguir un declive sólido de un rebote en marcha. En **etapas 1 y 3** el índice **no existe**: la media está plana, no hay tendencia que sostener, y cualquier número ahí sería madurez de base — que es detección de bases (track VCP, aplazado), no salud de etapa.

**Qué NO es** (lista explícita):

- **No es calidad de setup ni de entrada.** Ni pivote, ni base, ni VCP, ni distancia a máximos: eso mide *dónde entrar*, no *si la etapa aguanta*.
- **No es RS.** El RS (global/país/tema) compara contra otros; la salud es absoluta al propio valor. Un líder RS 95 puede tener salud 40 (avance estirado y frenándose) y esa divergencia es información.
- **No es un veredicto ni un score de caza.** No dice «comprar», no ordena la mesa, no alimenta scores.
- **No es la etapa con decimales.** Un 80 en Etapa 4 no está «más cerca de Etapa 2» que un 20 en Etapa 4 — está más firmemente en declive.

**Alternativa rechazada:** definir salud para las cuatro etapas (reinterpretando los ingredientes por etapa: en Etapa 1, «madurez de base»; en Etapa 3, «deterioro del techo»). Rechazada porque (a) en etapas de media plana las tres muletas no tienen dirección definida — habría que inventar métricas de base que son el track VCP aplazado; (b) un índice que exige re-explicar su semántica etapa por etapa deja de ser un número y pasa a ser cuatro; (c) la superficie crecería sin caso de uso del dueño (la caza vive en Etapa 2 y el deterioro en Etapa 4).

**Alternativa rechazada:** definir salud solo para Etapa 2. Rechazada porque deja la mesa de Deterioro (uso real del producto, ~1030 filas en el backlog) sin el número, e invita a un «índice de deterioro» separado más adelante — dos definiciones hermanas del mismo concepto, el anti-patrón que MET-1…3 pasaron tres specs eliminando.

---

## Insumos

### Pregunta 2 — Lista cerrada

**Propuesta:** **cinco componentes**, todos derivados de datos que scan y ficha ya calculan. Ninguno nuevo, ninguna redefinición:

| # | Componente | Dato base (existente) | Fuente única |
|---|---|---|---|
| 1 | **Persistencia media 30 sem** | `weeksAboveSma30w` + lado (`weeksAboveSma30wAbove`) | `consecutiveWeeksRelativeToMa` (`lib/trendSupport.js`) |
| 2 | **Persistencia media 10 sem** | `weeksAboveSma10w` + lado | ídem |
| 3 | **Aceleración** | `advanceRecentPct` / `advancePriorPct`, banda `ADVANCE_DEAD_BAND_PP = 5` | `advancePriorPct` / `advanceAccelerationWord` (`lib/trendSupport.js`) |
| 4 | **Volumen** | `upDownVolRatio` 50 sesiones, umbrales 1 / 1,25 | `udVol` (`lib/indicators.js`) + constantes `lib/marketVolume.js` |
| 5 | **Extensión sobre media 30 sem** | `distanceSlowMaPct` | `weeklyStageForBars` (`lib/weeklyStage.js`) |
| — | **Etapa** (`weeklyStageState` + campos) | Puerta y dirección de lectura, **no** componente puntuado | `lib/weeklyStage.js`, intacto |

Los componentes 1–4 son los datos de las tres muletas MET-4 (la muleta de medias aporta dos contadores). El componente 5 (extensión) es el único insumo no-muleta: mide si el precio está colocado de forma sostenible o estirado lejos de su muleta — fragilidad, no dirección.

**Queda fuera del índice** (lista explícita, con motivo):

- **RS global / país / tema** (`weeklyRs*`): introduce denominador cruzado y dependencia de snapshots/pins — rompería la propiedad determinista por símbolo que hace trivial la cadencia (pregunta 7), y mezcla el eje «contra otros» con el eje «consigo mismo».
- **`weekInStage`**: cuenta semanas en el *estado*, no sobre la *media*; solaparía con las persistencias midiendo casi lo mismo con otra definición.
- **Magnitud de la pendiente** (`slowMaSlopePct` más allá de la banda `flatPct`): el signo ya es la puerta de la etapa; puntuarla doblaría el peso de la misma media que la persistencia ya mide, y la escuela no publica escala de «cuán ascendente».
- **Distancia a máximos de 52 semanas**: es timing de entrada (columna 6 de la tabla), no sostén.
- **`volumeDryUpRatio`, `latestVolumeRatio`, `volumeSurgePct`**: lecturas de setup/evento (MET-4 pregunta 4 ya lo cerró).
- **`requirePulso` / trend template, `momentumScore`, fundamentales, series de RS semanal**: otros ejes, otras maquinarias.

**Alternativa rechazada:** incluir el RS como sexto componente («una etapa sana debería liderar»). Rechazada porque convierte el índice en dependiente de cobertura de snapshots (intl sin FX apto perdería la salud entera), acopla dos tracks con ciclos de versión distintos, y — sobre todo — destruye la divergencia informativa: si el RS alimenta la salud, «líder con salud baja» deja de poder existir como lectura.

**Alternativa rechazada:** solo las tres muletas, sin extensión. Rechazada porque las muletas miden si el apoyo existe y se mantiene, pero no si el precio está *estirado* sobre él: una Etapa 2 un 45% sobre su media de 30 con 20 semanas de persistencia puntuaría perfecta mientras cuelga en el vacío. La extensión ya existe en producto (`distanceSlowMaPct`) y es el complemento de fragilidad natural.

---

## Fórmula

### Pregunta 3 — Ponderación, rampas y cómo se documenta

**Propuesta:** suma ponderada de cinco subscores en [0, 1], redondeada a entero:

```
salud = round( 25·persistencia30 + 10·persistencia10 + 20·aceleración + 25·volumen + 20·extensión )
```

Todos los componentes se leen **en la dirección de la etapa** («lado de etapa» = encima de la media en Etapa 2, debajo en Etapa 4; la clasificación garantiza el lado de la media de 30 en la semana actual):

| Componente | Peso | Subscore |
|---|---|---|
| **Persistencia 30 sem** | 25 | `min(semanas_en_lado_de_etapa / 26, 1)` — rampa lineal, satura a 26 semanas (media ventana anual, la 26w ya existe en la fórmula RS) |
| **Persistencia 10 sem** | 10 | Si el cierre está en el lado de etapa de la media de 10: `min(semanas / 10, 1)` (satura a una ventana completa). Si está en el lado contrario (p. ej. Etapa 2 con la media de 10 perdida): **0** |
| **Aceleración** | 20 | `delta = r1 − r0` (mismas ventanas y banda de MET-4); en Etapa 4 se lee con signo invertido (`delta' = −delta`: un avance que «se frena» es un declive que se afirma). `delta' > +5 pp` → **1** · `|delta| ≤ 5 pp` → **0,75** · `delta' < −5 pp` → **0** |
| **Volumen** | 25 | Etapa 2: `ratio ≥ 1,25` → **1** · `1 ≤ ratio < 1,25` → **0,6** · `< 1` → **0**. Etapa 4, espejo con las mismas constantes: `< 1` → **1** · `1 ≤ ratio < 1,25` → **0,6** · `≥ 1,25` → **0** |
| **Extensión** | 20 | `e = abs(distanceSlowMaPct)`. `e ≤ 15` → **1** · `15 < e < 50` → `(50 − e) / 35` · `e ≥ 50` → **0** |

Justificación de pesos (decisión de producto declarada, no backtest): la muleta-madre — la media — pesa 35 en conjunto (25 + 10) porque *es* la definición literal de sostén en Weinstein; el volumen pesa 25 porque la escuela exige que el volumen confirme; la aceleración 20 (ritmo, más ruidosa ventana a ventana); la extensión 20 como penalización de fragilidad. «Mantiene» puntúa 0,75 (no 0,5) porque una tendencia que ni gana ni pierde ritmo **se sostiene** — el índice mide sostén, no momentum: una Etapa 2 estable perfecta alcanza 95, no 100, y eso es correcto (los 100 exigen ritmo creciente).

Nota de coherencia con MET-4: las **palabras** de las muletas en ficha no cambian ni se re-etiquetan por etapa («se frena» siempre describe el avance del precio; «en contra» siempre describe el reparto comprador/vendedor). El índice consume los mismos **números** leyéndolos en la dirección de la etapa, y esa lectura espejo se documenta una vez en metodología. Que una Etapa 4 muestre «Avance: se frena» y eso sume salud es divergencia aparente, no contradicción: el declive se está afirmando.

Umbrales nuevos que este spec introduce (los únicos): saturaciones **26** y **10** semanas de las rampas de persistencia, y la rampa de extensión **15/50%**. Como `flatPct=2` y la banda de 5 pp, son decisiones de producto declaradas — la escuela no publica números — configurables y recortables por el dueño con casos reales delante.

**Ejemplo trabajado** (va también a la página de metodología): Etapa 2 confirmada, 23 semanas sobre la media de 30 (`23/26 → 0,885 → 22,1`), 8 semanas sobre la de 10 (`0,8 → 8`), avance «mantiene» (`0,75 → 15`), volumen «acompaña» 1,4× (`1 → 25`), extensión +12% (`1 → 20`) → **salud 90**.

**Cómo se documenta** (principio 5, una sola vez):

1. **Página de metodología**: sección «Salud de etapa» con la tabla completa de componentes/pesos/rampas/umbrales, la lectura espejo de Etapa 4 y el ejemplo trabajado.
2. **Código**: constantes con nombre en un único módulo (`lib/stageHealth.js`, nombre orientativo MET-5b), testeadas; cambiar un peso = diff de una constante + actualización de metodología en el mismo commit.
3. **Ficha**: número + desglose por componente accesible en el mismo sitio (tooltip/expandible); la fórmula nunca se repite en la interfaz.

**Alternativa rechazada (obligada por el ticket):** caja negra / pesos aprendidos (ML, regresión contra retornos futuros, optimización por backtest). Rechazada porque (a) un peso que nadie puede explicar convierte el índice en un oráculo — lo contrario del principio 1 y del compromiso de metodología publicada; (b) optimizar contra retornos futuros transforma «describe el estado» en «predice y por tanto recomienda», con las implicaciones legales del principio 1; (c) no existe dataset etiquetado ni infraestructura de backtest en el repo, y construirla para esto es un track de investigación, no un spec de producto; (d) los pesos aprendidos cambiarían con cada re-entreno, rompiendo la reproducibilidad que todo el track MET ha defendido.

**Alternativa rechazada:** normalizar el índice como percentil del universo («salud 80 = más sano que el 80%»). Rechazada porque introduce denominador cruzado → snapshots, `engine_version`, cobertura y jobs (toda la maquinaria MET-1/2/3) para una métrica que no lo necesita; y porque un *ranking* de salud es un leaderboard — ordenar la mesa por él es señalar (principio 1).

**Alternativa rechazada:** multiplicar subscores en vez de sumar (salud = producto de factores). Rechazada: un solo componente en 0 anularía el índice entero aunque los demás estén perfectos, lo que en la práctica lo convierte en un semáforo binario con decimales; la suma ponderada degrada gradualmente, que es la semántica de «solidez».

---

## Relación con la etapa

### Pregunta 4 — `weeklyStageState`: complemento, nunca subtítulo

**Propuesta:** reparto de papeles explícito, heredando la tabla de MET-4 pregunta 8:

| | Etapa (`weeklyStage*`) | Salud de etapa |
|---|---|---|
| Pregunta | ¿En qué **fase del ciclo** está? | ¿Con qué **solidez** sostiene esa fase? |
| Naturaleza | Clasificación (1–4, confirmada/tentativa) | Entero 0–100, suma ponderada |
| Ingredientes | Precio vs media 30 + pendiente, nada más (D.14) | Datos MET-4 + extensión, leídos en la dirección de la etapa |

Contratos duros:

1. **`lib/weeklyStage.js` no se toca.** Ni la clasificación, ni `stage2RejectDetail`, ni `isConfirmedStage2`, ni ningún filtro que defina etapa. El índice lee `weeklyStageForBars` y calcula encima.
2. **Prohibido el subtítulo.** «Etapa 2 sana», «Etapa 2 débil» o cualquier calificador derivado de la salud **no** aparece dentro del rótulo de etapa, ni en el clasificador, ni en filtros, ni en copy. La etapa y la salud son dos datos adyacentes, cada uno con su nombre.
3. **La divergencia es contenido.** «Etapa 2 confirmada · Salud 28» es exactamente la lectura que el dueño pidió: la etapa dice dónde está, la salud dice cómo de firme llega. Ninguna «corrige» a la otra.
4. **Al cambiar la etapa, el índice cambia de referencia** (los componentes se releen en la nueva dirección). Un vuelco Etapa 2 → Etapa 4 puede saltar de salud 15 a salud 60 sin transición suave: es el comportamiento correcto de una métrica relativa a su etapa, y se documenta en metodología para que no se lea como bug.

**Alternativa rechazada:** subdividir la etapa con la salud («Etapa 2 sana / débil») en clasificador, rótulo o filtro. Rechazada porque (a) repite el bug C-15 ya pagado — la etapa mostrada dejaría de ser la etapa filtrada; (b) nombrar rangos del índice es el semáforo con otra sintaxis: dos categorías con nombre son un veredicto binario; (c) el ticket lo prohíbe literalmente.

**Alternativa rechazada:** un índice «absoluto de tendencia alcista» (100 = etapa 2 perfecta, 0 = etapa 4 perfecta, etapas por rangos intermedios). Rechazada porque es el interruptor 1–4 continuo que el dueño excluyó: re-codifica la clasificación como gradiente, invita a leer «60 → casi Etapa 2» (falso: la etapa no es un continuo, es una relación estructural precio/media), y su información marginal sobre la etapa ya mostrada es casi nula.

---

## Superficie

### Pregunta 5 — Ficha / columna / truth / research

**Propuesta:** superficie v1 = **solo la ficha**, junto al bloque de etapa de la franja descriptiva. Una línea:

```
Salud de etapa: 90/100
```

con el desglose por componente accesible desde el mismo sitio (tooltip o expandible: «media 30 sem 22,1 de 25 · media 10 sem 8 de 10 · avance 15 de 20 · volumen 25 de 25 · extensión 20 de 20» — copy orientativo MET-5b). El número nunca viaja solo ni coloreado.

| Superficie | Decisión |
|---|---|
| **Ficha** (franja descriptiva, junto a etapa) | **Sí** — línea de arriba. Es la profundización por valor donde el principio 4 la sitúa. |
| **Tabla** | **No.** Contrato de 7 columnas; además, columna de salud + sort = ordenar la mesa por un agregado = señalar (principio 1). Si algún día entra, sale otra columna y lo decide el dueño. |
| **Línea de verdad / truth** | **No.** Habla de población y mercados, no de lecturas por símbolo. |
| **Vista rápida / `/review`** | **No en v1.** Mismo cálculo reutilizable si el uso real lo pide (ticket de superficie posterior, sin re-especificar). |
| **Ficha compartible** | Candidata natural junto al estado de tendencia, pero fuera de MET-5b — entra cuando se trabaje esa ficha. |
| **Filtros / hunt** | **No en v1** (pregunta 6). |
| **Página de metodología** | **Sí** — fórmula completa, una sola vez (pregunta 3). |
| **Solo research/interno** | **No** — el dueño pidió el índice para leerlo en uso real; esconderlo en research impide validarlo. |

**Etiqueta trader-facing:** «Salud de etapa» (el nombre que el dueño usó). En Etapa 4 el copy no cambia — salud alta = declive firmemente en vigor — y la metodología lo explica; si en uso real el nombre confunde en Etapa 4, el recambio de rótulo es decisión de copy del dueño, no de fórmula.

**Motivos de ausencia** en la propia línea (pregunta 8), patrón `DESCRIPTIVE_ABSENCE`.

**Alternativa rechazada:** columna en tabla desde v1. Rechazada por el contrato de 7 columnas y porque una columna ordenable de salud convierte el índice en el VEREDICTO que el rediseño eliminó — el usuario ordenaría la mesa por «lo mejor» según nosotros, que es recomendar por otra vía.

**Alternativa rechazada:** empezar también en vista rápida «ya que el cálculo es barato». Rechazada por disciplina de superficie mínima (mismo argumento MET-4 pregunta 5): la ficha basta para que el dueño valide si el número le sirve; cada superficie extra multiplica coste de smoke antes de saber si la fórmula sobrevive al uso real.

---

## Scoring y filtros

### Pregunta 6 — Default NO; puerta futura

**Propuesta: confirmar la prohibición heredada (MET-1…4), sin excepción en v1.** La salud de etapa no entra en `objectiveScore`, `compositeScore`, `totalScore`, `weaknessScore`, ni en ningún score persistido en `scan_results`; tampoco alimenta puertas hunt ni la taxonomía de filtros (UX-FILTERS, cerrada) en v1.

**Puerta futura (la única):** si tras uso real el dueño quiere filtrar por salud (p. ej. «salud mínima 60 en Etapa 2»), eso es un **ticket de filtro propio** con decisión explícita del dueño — lectura del campo, nunca entrada en scores — por el mismo camino que los filtros de RS semanal. Requisitos previos que ese ticket deberá cumplir: (a) el índice validado en fichas reales durante un período que el dueño juzgue suficiente; (b) constancia de la distribución real del índice sobre el universo (hoy no muestreada — ver LO QUE NO VERIFIQUÉ), para que el umbral del filtro no se elija a ciegas. Cualquier entrada en scores persistidos exigiría además reabrir la auditoría de coherencia de scoring — este spec no lo autoriza.

**Alternativa rechazada:** alimentar `weaknessScore` con la salud (baja salud → más deterioro). Rechazada porque condiciona un score persistido a la cobertura de los insumos (IPOs sin aceleración perderían el score entero o lo sesgarían), reabre la auditoría de coherencia sin validación del dueño, y es la misma razón por la que RS país/tema y las muletas quedaron fuera de scores.

**Alternativa rechazada:** usar la salud como desempate de ordenación en presets hunt («a igual RS, primero el más sano»). Rechazada: es scoring de facto sin llamarlo así — ordena la mesa con un agregado nuestro, y el principio 1 exige que el criterio de ordenación sea elegible y explícito, no incrustado.

---

## Cadencia

### Pregunta 7 — Derivado vs job; `engine_version`

**Propuesta: derivado, sin job, sin `engine_version`.** Herencia directa del argumento MET-4 pregunta 7: los cinco componentes son funciones deterministas de las barras del propio símbolo — no hay denominador cruzado, no hay población que versionar, no hay «semana W» que congelar. Mismas barras → misma salud.

| Dónde | Qué |
|---|---|
| **Scan / materializado** (`lib/materializedScanner.js`, junto a `weeklyStageFields` y los campos MET-4b) | Campo de fila `stageHealthScore` (nombre orientativo; `null` con motivo cuando no computa). Coste marginal ~0: todos los insumos ya están calculados por fila. |
| **Ficha** | Cálculo desde las barras del chart vía el mismo módulo puro (`lib/stageHealth.js`, patrón `lib/trendSupport.js`), para no depender de que el símbolo esté en el último scan. |

Sin tabla nueva, sin cron, sin escritura fuera de los campos de fila del scan. **Versionado sin maquinaria:** como el índice no se persiste como serie histórica (no hay snapshots que comparar entre semanas), no necesita `engine_version`; la trazabilidad de cambios de fórmula se cubre con (a) las constantes con nombre en un solo módulo, (b) la página de metodología actualizada en el mismo commit, y (c) el historial de git. Si algún día el dueño quiere una **serie temporal** de salud (¿cómo evolucionó la salud de NVDA este año?), eso sí exige snapshots versionados — y es un ticket nuevo con su spec, no este.

**Alternativa rechazada:** job semanal con snapshots (patrón `rs_weekly_*`) «para poder auditar la salud histórica». Rechazada porque ese patrón existe para versionar un denominador (invariante 10) y aquí no lo hay; compraría ops (cron, idempotencia, MIGRATE en pausa) para una auditabilidad que la función determinista ya da gratis, y adelantaría una feature (serie histórica) que nadie ha pedido.

**Alternativa rechazada:** calcular solo en ficha, sin campo en scan. Rechazada por el mismo argumento que MET-4: dejaría cualquier superficie futura (filtro de salud si el dueño lo decide, vista rápida) sin dato consistente con la mesa, recalculando en ficha lo que el scan tiró.

---

## Ausencias

### Pregunta 8 — Falta una muleta o la etapa

**Propuesta: todo-o-nada con motivo visible.** El índice existe solo si existen **la etapa tendencial y los cinco componentes**. Si falta cualquiera, no hay número — hay ausencia con el motivo del insumo que falta (principio 3; el motivo va en el sitio, la fórmula en metodología). **Prohibido** renormalizar sobre los componentes disponibles: un «70 sobre 75 puntos posibles» y un 70 completo no son la misma métrica, y publicarlos bajo el mismo nombre es la incoherencia multi-superficie que los lectores canónicos de RS existen para impedir.

Casuística cerrada (códigos orientativos MET-5b, texto único componente/tests, patrón `DESCRIPTIVE_ABSENCE`):

| Situación | Código | Texto UX (orientativo) |
|---|---|---|
| Etapa `insufficient_history` | `health-stage-missing` | Sin salud de etapa: el histórico semanal no alcanza para clasificar la etapa. |
| Etapa 1 o 3 (incl. tentativas y sin contexto) | `health-non-trending-stage` | Sin salud de etapa: la etapa actual no es una tendencia en curso; el índice mide etapas 2 y 4. |
| Sin aceleración (histórico < 126 sesiones) | `health-accel-history` | Sin salud de etapa: histórico inferior a 6 meses para la lectura de aceleración. |
| Serie discontinua (≥3×) | `health-discontinuous` | Sin salud de etapa: salto sin ajustar en la serie de precios. |
| Volumen sin cobertura (<80% en 50 sesiones) | `health-volume-coverage` | Sin salud de etapa: cobertura de volumen insuficiente en 50 sesiones. |

Notas: (a) las persistencias y la extensión no tienen fila propia — si la etapa clasifica, la media de 30 existe y esos componentes también; (b) el bloque MET-4 de la ficha sigue mostrando las muletas que **sí** existan aunque el índice esté ausente — cada lectura conserva su ausencia propia, el índice no las arrastra; (c) la consecuencia honesta es que IPOs recientes casi nunca tendrán salud de etapa, y es correcto: con menos de 6 meses de histórico no hay sostén demostrable que agregar.

**Alternativa rechazada:** renormalización parcial (calcular sobre los pesos disponibles y declarar cobertura). Rechazada porque el mismo número pasaría a significar cosas distintas según el símbolo — un 80 sin pierna de volumen no es un 80 —, porque «salud 64 (sobre 75 pts disponibles)» es ilegible como copy de mesa, y porque degradar la definición en silencio es exactamente lo que MET-4 prohibió para la aceleración (no degradar a ventanas cortas) elevado a índice.

**Alternativa rechazada:** imputar el componente ausente con un neutro (0,5) para no perder el índice. Rechazada: un neutro inventado es un dato que el sistema no puede demostrar (principio 3) — el maquillaje contra el que está escrito el inventario de dato ausente.

---

## Fuera

### Pregunta 9 — Qué NO es MET-5

MET-5 (y su eventual MET-5b) **no** incluye:

- **MET-4c** — vista rápida / filtro de persistencia: opcional y paralelo, ni requisito ni parte de este spec.
- **MET-5b** — la implementación misma: solo con OK explícito del dueño sobre este documento.
- **MET-6** — RS en stress / bajadas.
- **VCP, bases, pivote** — track `research/contracciones/` + `lib/setupPatterns.js`; nada de eso puntúa aquí.
- **Semáforo, categorías con nombre, colores por rango, «sana/débil»** — prohibidos en cualquier superficie.
- **Interruptor 1–4 continuo** — el índice no re-codifica la etapa (pregunta 4).
- **Columna de tabla, filtros hunt, cambios en línea de verdad, vista rápida** — superficie v1 = ficha; lo demás son tickets posteriores con decisión de dueño.
- **Scoring** — ni entrada en scores ni cambios en `lib/scoring.js` / `scoringEngine.js` / `weaknessScore`.
- **Schema, jobs, cron, `engine_version`, serie histórica de salud** — sin escrituras nuevas fuera del campo de fila del scan.
- **Tocar `lib/weeklyStage.js`, `lib/trendSupport.js`** (el índice importa sus funciones, no las modifica), **el pin RS global ni los motores país/tema**.
- **Indicadores nuevos** — MACD, RSI, OBV, ADX, ni ningún oscilador.
- **Chart** — sin overlays ni marcas de salud.
- **MIGRATE, THEME-SERIES, línea pública US-only** — otros tracks.

**Alternativa rechazada (al recorte mismo):** aprovechar MET-5b para «ya que estamos» añadir la columna de salud o el filtro mínimo. Rechazada: cada pieza extra antes de validar la fórmula con uso real multiplica el coste de un rechazo del dueño; este spec entrega la unidad mínima aceptable o rechazable — un número en la ficha con su desglose y sus ausencias honestas.

---

## Tickets siguientes

| Ticket | Contenido | Condición |
|---|---|---|
| **MET-5-calibrate** (pre-5b) | Script read-only: distribución persistencia 30/10, `|distanceSlowMaPct|`, índice propuesto en Etapa 2 y 4; percentiles y ejemplos; **sin write** | **Activo** tras aceptación 2026-08-31 |
| **MET-5b** (implementación) | Módulo puro + campo scan + línea ficha + metodología + tests + smoke | Tras calibrate + OK umbrales del dueño |
| **Salud etapas 1/3 + VCP** (futuro) | Perfil propio de «potencial» / madurez de base·techo, no el mismo 0–100 de tendencia | Track VCP; no empieza aquí |
| **Filtro de salud** (futuro) | Lectura de `stageHealthScore` como filtro hunt | Tras uso real de MET-5b + decisión explícita |
| **Serie histórica de salud** (futuro) | Snapshots si el dueño quiere evolución temporal | Spec propio |

---

## LO QUE NO VERIFIQUÉ

- **Nada ejecutado:** ni tests, ni scan, ni Supabase, ni navegador — spec only, sin diff de código de producto.
- **Pesos (25/10/20/25/20) y valores discretos (0,75 «mantiene», 0,6 «neutro»):** decisión de producto razonada por analogía con la escuela, sin backtest ni muestreo; el dueño puede recortarlos, y cualquier cambio es diff de constantes + metodología.
- **Saturaciones de persistencia (26 y 10 semanas) y rampa de extensión (15/50%):** números propuestos a juicio, no calibrados contra la distribución real del universo. El muestreo opcional pre-5b existe para esto.
- **Distribución del índice resultante** sobre el universo (¿se apelotona en 70–90? ¿discrimina?): hipótesis razonada, no medida — es justo lo que el uso real de MET-5b debe enseñar.
- **Utilidad real de la lectura espejo en Etapa 4** para la mesa de Deterioro: diseñada sobre el caso de uso del backlog, no validada con el dueño delante de casos.
- **Cobertura conjunta de los cinco insumos** (cuántas filas de Etapa 2/4 tendrían índice vs ausencia por aceleración/volumen): asumida desde las convenciones del scanner, no contada.
- **Espacio en la franja descriptiva** para la línea + desglose: no comprobado en pantalla; si no cabe, es maquetación de MET-5b, no metodología.
- **`docs/auditoria-etapas-2026-08-16.md` y `docs/diseno-salud-y-cambio-2026-08-16.md`** citados vía los comentarios del código vivo y los specs MET previos, no releídos enteros en esta sesión.
- **Specs MET-1/2/3/4, principios, `weeklyStage.js`, `trendSupport.js`, `descriptiveStrip.js`**: sí leídos enteros en esta sesión.
