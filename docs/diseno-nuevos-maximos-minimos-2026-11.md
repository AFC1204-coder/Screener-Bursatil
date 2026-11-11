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

**Pendiente de validar:** que los swings detectados coinciden con lo que ve a ojo el dueño en el
gráfico (casos concretos). La medición cuenta eventos, no comprueba que cada uno sea el que él
llamaría «ruptura de máximo relativo».

## 3. Dónde se calcula

**Por fila, en el nocturno** (fase A). Una función pura nueva `newExtremes(bars, { radius })` en
`lib/indicators.js` junto a `highDist`/`lowAdv`, que reutiliza la construcción de swings y devuelve:
`newHighRel`, `newLowRel` (1/0/null), su apellido `newHighRelKind`/`newLowRelKind` (`cont`/`giro`),
`newHigh52` y `newLow52` (1/0/null). Se llama desde las dos copias de la
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

- ¿Radio del swing: 3 días (el que ya usa el sistema), 5, o semanal (Weinstein)?
- ¿Mostrar «continuación» y «giro» como dos cifras, o un solo número de nuevos máximos relativos?
- ¿Aprobar el rumbo (evento real por fila + serie aparte)?
- ¿Conservar «Cerca del techo (≤1 %)» como indicador propio o retirarlo?
- ¿Diario por defecto con vista semanal opcional, o semanal por defecto (como recomienda Weinstein)?
- ¿Autorizas crear la tabla `market_extremes_daily` (fase B)?
- ¿Aplico ya el paso 0 (renombrar los dos indicadores actuales)?
