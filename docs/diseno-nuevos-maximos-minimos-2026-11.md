# Nuevos máximos y mínimos: del «cerca del techo» al evento real

Estado: **propuesta para aprobar o recortar** (2026-11-11). No hay código escrito.
Origen: decisión 8 del dueño (2026-11-10): diferenciar máximos locales, de 52 semanas e
históricos, y no usar «≤1 % del máximo» como «nuevo máximo». Diseño previo del catálogo:
`docs/diseno-indicadores-mercado-2026-08-17.md`, A.1.3 (aquí se concreta cómo construirlo).

## 1. El problema, medido

Medido el 2026-11-11 en el Mini sobre las 3.502 acciones del último escaneo US, con las
barras de `daily_bars`, sesión del 2026-11-10:

| Qué | Pantalla de salud hoy | Evento real |
|---|---|---|
| Máximo 52 semanas | 144 («Nuevos máximos 52s (≤1 % del techo)») | 88 (56 con cierre por encima) |
| Máximo de 20 sesiones (ventana fija; **descartado**, ver 2) | no existe | 303 |
| Mínimo 52 semanas | 24 («Nuevos mínimos 52s (≤1 % sobre el suelo)») | 79 |
| Mínimo de 20 sesiones (ventana fija; **descartado**, ver 2) | no existe | 282 |

Los valores guardados exactos tampoco sirven: `distance52w ≥ 0` da 20 máximos y
`lowAdvance52w ≤ 0` da 2 mínimos, porque comparan el **cierre** con una ventana que ya incluye
el máximo/mínimo del propio día. Un máximo nuevo (el máximo del día supera al anterior) casi nunca
cierra en el máximo. **No se puede derivar el evento de los campos que ya se guardan.**

Variación diaria alta: nuevos máximos 52s del 2 al 10-nov = 169, 86, 302, 304, 44, 113, 88.

Efecto lateral vigente: desde que el nocturno guarda `lowAdvance52w` (11-nov), «Nuevos mínimos
52s» aparece por primera vez en la web (antes caía bajo la cobertura mínima del 60 %) con la
cifra engañosa de 24.

## 2. Definiciones

**Corrección del dueño (2026-11-11):** el máximo «local» no debe ser «las últimas N sesiones»,
sino **superar un máximo relativo**, según la sucesión de máximos y mínimos locales (swings) que
se van dando. Por eso se abandona la ventana fija de 20 sesiones. 52 semanas e histórico sí son
niveles por definición (ventana temporal / toda la historia) y se mantienen.

**Swing** = pivote fractal: un máximo (mínimo) que supera (queda por debajo de) los `r` días de
cada lado; altos y bajos se alternan quedándose con el más extremo de cada tramo. Es la misma
construcción que ya usa `localPivots` (`lib/setupPatterns.js`, radio 3 sobre diario) y
`weeklyPivots` (`lib/weeklyStageStructure.js`, semanal); no se inventa un detector nuevo. Un
pivote solo existe `r` sesiones después de formarse (sin mirar al futuro).

| Indicador | Evento |
|---|---|
| **Nuevo máximo relativo** | el máximo de la sesión supera el **último swing alto confirmado**, y es la **primera** sesión que lo hace (si ya lo superó una sesión anterior es continuación, no un evento nuevo) |
| **Nuevo mínimo relativo** | simétrico con el último swing bajo confirmado |
| Nuevo máximo 52s | máximo de la sesión > máximo de las 251 previas (exige ≥252 barras) |
| Nuevo máximo histórico | máximo de la sesión > máximo histórico semanal ajustado (`long_history_stats`); **fase 2** |
| Nuevo mínimo 52s | simétrico |

El evento relativo lleva un **apellido** que sale de la misma sucesión de swings:
- **continuación** — el swing roto está por encima del swing alto anterior (máximos crecientes: la
  estructura alcista sigue); para mínimos, el swing roto está por debajo del anterior (mínimos decrecientes).
- **giro** — el swing roto es más bajo que el anterior (se rompe un máximo descendente: posible cambio
  de estructura); para mínimos, se rompe un mínimo creciente.

Dato insuficiente (menos de 60 barras, o ningún swing confirmado) = **`null`, nunca 0**. Un valor
sin evento es `0`. «Cerca del techo (≤1 %)» se conserva **aparte y con ese nombre**. Weinstein
recomienda leer las cifras semanales (`diseno-indicadores-mercado-2026-08-17.md`, A.1.3): el mismo
detector se puede aplicar a barras semanales (`weeklyPivots`).

### 2.1 Medición del criterio relativo (11-nov, solo lectura)

Sobre las 3.502 acciones US y `daily_bars` (barras con precios ajustados), sin mirar al futuro,
comparando con la ventana fija de 20 sesiones. Sesión 2026-11-10:

| | Radio 3 | Radio 5 | Ventana fija 20 |
|---|---|---|---|
| Nuevo máximo | 76 (48 continuación / 28 giro) | 47 (22 / 25) | 303 |
| Nuevo mínimo | 56 (33 / 23) | 41 (24 / 17) | 282 |

- El criterio relativo es **unas 4-6 veces más selectivo** que la ventana fija y **casi todos sus
  eventos también son máximos de 20 sesiones** (61 de 76): filtra ruido, no inventa señales.
- La serie diaria sigue siendo muy variable (radio 3, nuevos máximos del 2 al 10-nov: 272, 89, 506,
  154, 60, 146, 76), y la proporción continuación/giro oscila.
- El radio importa: pasar de 3 a 5 recorta el recuento un 20-40 %. Hay que elegirlo, no heredarlo.

### 2.2 Temporalidad: diario y semanal, no un radio único (decisión del dueño, 2026-11-11)

El radio correcto depende de la fractalidad de la estructura que se analice (un VCP largo se lee en
semanal, una base corta en diario), y en general se trabaja en **semanal o diario**. Por tanto no
se elige un solo radio: el detector es **parametrizable por temporalidad** y se calculan las dos,
con los radios que el sistema ya usa: **diario r=3** (`localPivots`) y **semanal r=2**
(`weeklyPivots`, `pivotRadius: 2`). Cada consumidor elige: el indicador de mercado muestra las dos,
y cada estructura (VCP, base) usará la que le corresponda.

Medición semanal (r=2, mismas 3.502 acciones, barras diarias agregadas a semanas de lunes a viernes;
la última semana es **parcial**: lunes y martes):

| Semana (lunes) | Nuevos máx. relativos (cont/giro) | Nuevos mín. relativos (cont/giro) |
|---|---|---|
| 14-sep | 146 (92/54) | 298 (114/184) |
| 21-sep | 154 (84/70) | 327 (124/203) |
| 28-sep | 92 (46/46) | 364 (107/257) |
| 5-oct | 156 (87/69) | 209 (86/123) |
| 12-oct | 236 (130/106) | 307 (130/177) |
| 19-oct | 261 (128/133) | 238 (118/120) |
| 26-oct | 241 (116/125) | 210 (108/102) |
| 2-nov | 393 (168/225) | 389 (194/195) |
| 9-nov (parcial) | 74 (39/35) | 48 (27/21) |

La serie semanal se lee mucho mejor que la diaria: los mínimos dominaban a finales de septiembre
(364 frente a 92 el 28-sep), los máximos los alcanzan desde mediados de octubre y la semana del 2-nov
empata (393/389). Es el comportamiento que Weinstein pide leer semanalmente.

Detalles: la **semana en curso** se evalúa con el máximo/mínimo acumulado hasta hoy (puede cambiar de
aquí al viernes) y debe etiquetarse «parcial»; los eventos semanales exigen ≥30 semanas de histórico.

**Pendiente de validar:** que los swings detectados coinciden con lo que ve a ojo el dueño en el
gráfico (casos concretos). La medición cuenta eventos, no comprueba que cada uno sea el que él
llamaría «ruptura de máximo relativo».

### 2.3 El cierre marca la zona y confirma la ruptura (decisión del dueño, 2026-11-11)

Se decide que **semanal es la temporalidad por defecto** en la pantalla de salud (con interruptor a
diario) y que **los cierres —diarios, semanales o de la barra que sea— son los que marcan la zona**
del máximo/mínimo relativo y los que deciden si se ha roto. Consecuencias para la definición:

- **Swing sobre cierres:** el pivote se detecta con el cierre de cada barra (el cierre más alto
  entre los `r` cierres de cada lado, y simétrico para el bajo), no con la mecha. La zona del
  máximo relativo es el cierre del pivote.
- **Ruptura confirmada por cierre:** hay nuevo máximo relativo solo si el **cierre** de la barra
  supera ese cierre-pivote, y es la primera barra que lo hace. Una mecha que sobrepasa y cierra por
  debajo **no** cuenta (es un intento fallido, no una ruptura). Simétrico para mínimos.
- **La temporalidad manda:** en semanal el cierre es el del viernes (o el último de la semana); en
  la semana en curso, el último cierre disponible, rotulado «parcial» (se confirmará al cierre del viernes).
- **Parametrizable:** `newExtremes(bars, { timeframe, radius, basis: "close" })`; `basis` queda como
  argumento por si otra estructura (p. ej. un techo en zona con mechas) pidiera máximos/mínimos
  intradía, pero el valor por defecto y el de la pantalla de salud es `close`.

Medición con esta definición (mismas 3.502 acciones, solo lectura; cont/giro):

| Semana (lunes) | Nuevos máx. rel. por cierre | Nuevos mín. rel. por cierre |
|---|---|---|
| 14-sep | 133 (93/40) | 298 (96/202) |
| 21-sep | 161 (99/62) | 353 (114/239) |
| 28-sep | 96 (43/53) | 326 (111/215) |
| 5-oct | 160 (93/67) | 208 (90/118) |
| 12-oct | 225 (134/91) | 331 (145/185) |
| 19-oct | 282 (145/137) | 218 (108/110) |
| 26-oct | 233 (115/118) | 189 (91/97) |
| 2-nov | 319 (131/188) | 403 (186/217) |
| 9-nov (parcial) | 98 (45/53) | 39 (25/14) |

Diario (r=3, cierres), 10-nov: **116** nuevos máximos relativos (85/31) y **54** mínimos (22/32),
frente a 76 y 56 con mechas.

- La lectura semanal es la misma que con mechas (mínimos dominando a finales de septiembre, máximos
  desde mediados de octubre, cruce en la semana del 2-nov), pero **con menos ruido y más señal de
  giro**: las cifras semanales de máximos suben un poco porque los cierres hacen el pivote más bajo
  y se supera con más facilidad, y el reparto continuación/giro cambia (en semanas alcistas el
  giro pesa más).
- Sin verificar: que el cierre-pivote coincida con lo que el dueño llama «zona» (a ojo con
  gráficos) y el efecto de usar cierres ajustados frente a sin ajustar en las acciones con splits
  recientes (`daily_bars` se supone ajustada, sin comprobar).

### 2.4 Giro con estructura y roturas falsas (decisión del dueño, 2026-11-12, medición)

**Caso ASIX.** Un «giro de máximo» que en realidad es el rebote tras una sucesión de mínimos decrecientes no es un máximo: para el dueño hace falta mínimo → rebote → **mínimo más alto** → ruptura del rebote. Además, la ruptura falsa de un mínimo (*spring*) o de un máximo (*upthrust*, «trampa») es por sí misma un indicador temprano de cambio de tendencia, y la mecha que no cierra se registra como **intento**, sin contar como máximo.

**Reglas medidas** (semanal, r=2, por cierre; script `/private/tmp/claude-501/swing/falsas.mjs`, solo lectura, 3.502 símbolos US, semana del 2-nov):
- *Estructura*: un giro de máximo solo vale si el último swing bajo confirmado es más alto que el anterior (simétrico en mínimos). La continuación no cambia.
- *Amplitud* (propia de esta medición, no la del informe `amplitud.md`): swing roto ≥ 5 % respecto a sus dos swings vecinos.
- *Rotura falsa*: rotura por cierre de un swing cuyo cierre vuelve al otro lado del nivel dentro de N semanas; dispara la semana del regreso. *Intento*: máxima (mínima) de la semana supera el último swing sin romperlo por cierre y cierra dentro.

| Semana 2-nov | Máximos | Mínimos |
|---|---|---|
| Eventos hoy | 261 | 375 |
| de ellos, giros | 181 | 197 |
| giros con estructura | 47 | 62 |
| giros con amplitud ≥ 5 % | 79 | 159 |
| giros con ambas | 21 | 44 |

Roturas falsas que disparan esa semana (upthrust / spring): N=1 → 113 / 76; N=2 → 172 / 128; N=3 → 211 / 158. Intentos: 663 de máximo / 356 de mínimo. Sobre las 8 últimas semanas (28.016 observaciones) los porcentajes son parecidos (giros con estructura 35 % en máximos, 43 % en mínimos).

**13 casos (N=2):** ASIX, BFST y BGR (giro) fallan la estructura, como pide el dueño; ASIX tiene un spring (cierre 15,36 bajo 15,80 y regreso). AEHL también falla la estructura, **y no debería**: su mínimo más alto (7,31) aún no está confirmado con r=2. Con esta regla un giro real se retrasa dos semanas. ALTG (mínimo giro) pasa. ACNB sale como intento; **ALLE y APD no** (la zona de la mecha en `casos.md` era el máximo de cierres de las últimas semanas, no el último swing, y aquí se usa el último swing).

**Decisión del dueño (12-nov, noche): solo estructura.** La fila del nocturno aplica `requireStructure` (semana del 2-nov, código real: 127 máximos / 240 mínimos frente a 261 / 375 sin filtro); sin umbral de amplitud (`minSwingPct` queda como opción sin usar). `falseBreaks` (upthrust, spring, intentos) está cableado a la fila con 8 campos (`upthrust`/`spring`/`attemptHigh`/`attemptLow` × D/W, 1/0/null) y a la lista blanca de `scanLightProjection`; el Mini aún no los calcula (requiere paquete nuevo con «sí» del dueño).

**Sin verificar:** que la rotura falsa preceda de verdad a un cambio de tendencia (solo se cuentan frecuencias, sin rentabilidad posterior); N correcto; que 663 intentos sean señal útil (falta exigir cercanía al nivel); el efecto de usar el mínimo no confirmado en vez del confirmado.

## 3. Dónde se calcula

**Por fila, en el nocturno** (fase A). Una función pura nueva `newExtremes(bars, { radius })` en
`lib/indicators.js` junto a `highDist`/`lowAdv`, que reutiliza la construcción de swings y devuelve:
`newHighRelD`/`newLowRelD` (diario) y `newHighRelW`/`newLowRelW` (semanal) (1/0/null), con su apellido
`…Kind` (`cont`/`giro`), más `newHigh52` y `newLow52` (1/0/null). `radius` y `timeframe` son
argumentos, no constantes: otras estructuras pueden pedir otra fractalidad. Se llama desde las dos copias de la
fila (`lib/researchRow.js` y `lib/materializedScanner.js`; la segunda es la copia, ver ADR de
consolidación) para que no diverjan, y se añade a `SCAN_LIGHT_FIELDS`
(`lib/scanLightProjection.js`) o se vuelve a perder al guardar (es exactamente lo que pasó con
`lowAdvance52w`). Beneficio añadido: una vista del screener «Nuevos máximos hoy» sale gratis.

**Serie diaria, fuera de la fila** (fase B). La fila solo conoce «hoy». Para ver la evolución
(y la lectura semanal) hace falta contar por sesión. Propuesta: tabla pequeña
`market_extremes_daily (owner_id, market, trade_date, universe_n, nh20, nh52, nl20, nl52)`,
escrita por un paso del nocturno con una consulta sobre `daily_bars` (la de la medición), y
reconstruible hacia atrás con las ~400 sesiones disponibles. **Crear la tabla es un cambio de
esquema: requiere tu aprobación explícita.**

## 4. Qué cambia en la interfaz (pantalla de salud de mercado)

- `lib/marketBreadth.js`: sustituye `nearHigh52w`/`nearLow52w` por pares reales (máx/mín relativo,
  52 semanas) con `measured`/cobertura como el resto; «Cerca del techo (≤1 %)» queda
  como indicador propio. Añade las dos claves nuevas al `select` de `readNightlyRows`.
- `app/market-health/UniverseBreadth.jsx`: los pares se pintan juntos (máximos | mínimos) y la
  diferencia neta; con la serie de la fase B, un minigráfico y el interruptor Diario/Semanal.
- Rótulo explícito del evento: «máximo de la sesión superior al de las 251 previas».
- Si falta cobertura (<60 %) el indicador se declara ausente, como hoy.

## 5. Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| Barras mensuales incrustadas en `daily_bars` (`daily-bars-barras-mensuales`) inflan el «máximo previo» y esconden máximos | La función exige cadencia diaria (ya existen guardas en `dailyBarsCache`); medir cuántas filas afecta antes de publicar |
| Splits y dividendos | Las barras de `daily_bars` y las `calcBars` del nocturno llevan precios ajustados (la exportación del 11-nov los muestra con decimales de ajuste); aun así, un ajuste posterior reescribe el pasado: repetir la comprobación tras un split reciente |
| La población cambia (altas/bajas del universo) y mueve los porcentajes | Mostrar recuento y % sobre `universe_n` de cada día |
| Última sesión parcial o escaneo con fecha atrasada | Los símbolos con `lastDate` anterior a la fecha de mercado se excluyen de `measured`, como en la amplitud actual |
| Fuera de EE. UU. (decisión 10) | Mismo cálculo por mercado/región en una fase posterior; la tabla ya lleva `market` |
| Tests | Función pura con fixtures (máximo igualado ≠ máximo superado; ventana corta = null) + test de la lista blanca + mutación |

## 6. Plan en pasos (cada uno comiteable y reversible)

1. `newExtremes` en `lib/indicators.js` + tests (swing alto roto por primera vez ≠ continuación;
   sin swing = null) + prueba con barras de la base del Mini, repitiendo la medición del 11-nov y
   comprobando a ojo 10-15 casos con el dueño. Sin tocar nada visible.
2. Cablear a `researchRow`/`materializedScanner` y a `SCAN_LIGHT_FIELDS`; paquete para el nocturno
   del Mini (sin activar hasta tu confirmación).
3. Cambio de `marketBreadth` + panel (cambio de interfaz; paquete web para el Mini).
4. Fase B: migración de la tabla, paso nocturno, reconstrucción hacia atrás, minigráfico y vista
   semanal.
5. Fase 2: máximo histórico con `long_history_stats`.

**Paso 0 opcional (parche rápido):** mientras tanto, rotular los dos indicadores actuales como
«Cerca del techo (≤1 %)» y «Cerca del suelo (≤1 %)». Es un cambio de texto, pero toca la
interfaz de hoy.

## 7. Decisiones que necesita el dueño

- ~~¿Radio del swing?~~ Resuelto: diario r=3 y semanal r=2, parametrizable por estructura.
- ~~¿Temporalidad por defecto?~~ Resuelto: **semanal**, con interruptor a diario.
- ~~¿Mecha o cierre?~~ Resuelto: el **cierre** marca la zona del pivote y confirma la ruptura (2.3).
- ¿Mostrar «continuación» y «giro» como dos cifras, o un solo número de nuevos máximos relativos?
- ¿Aprobar el rumbo (evento real por fila + serie aparte)?
- ¿Conservar «Cerca del techo (≤1 %)» como indicador propio o retirarlo?
- ¿Autorizas crear la tabla `market_extremes_daily` (fase B)?
- ¿Aplico ya el paso 0 (renombrar los dos indicadores actuales)?
