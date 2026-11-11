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
| Máximo de 20 sesiones | no existe | 303 |
| Mínimo 52 semanas | 24 («Nuevos mínimos 52s (≤1 % sobre el suelo)») | 79 |
| Mínimo de 20 sesiones | no existe | 282 |

Los valores guardados exactos tampoco sirven: `distance52w ≥ 0` da 20 máximos y
`lowAdvance52w ≤ 0` da 2 mínimos, porque comparan el **cierre** con una ventana que ya incluye
el máximo/mínimo del propio día. Un máximo nuevo (el máximo del día supera al anterior) casi nunca
cierra en el máximo. **No se puede derivar el evento de los campos que ya se guardan.**

Variación diaria alta: nuevos máximos 52s del 2 al 10-nov = 169, 86, 302, 304, 44, 113, 88.

Efecto lateral vigente: desde que el nocturno guarda `lowAdvance52w` (11-nov), «Nuevos mínimos
52s» aparece por primera vez en la web (antes caía bajo la cobertura mínima del 60 %) con la
cifra engañosa de 24.

## 2. Definiciones (una por indicador, estrictas)

Sesión de referencia = la última barra de la fila. «Previas» = las N−1 sesiones anteriores.

| Indicador | Evento |
|---|---|
| Nuevo máximo local | máximo de la sesión > máximo de las 19 previas (20 sesiones) |
| Nuevo máximo 52s | máximo de la sesión > máximo de las 251 previas (exige ≥252 barras) |
| Nuevo máximo histórico | máximo de la sesión > máximo histórico semanal ajustado (`long_history_stats`); **fase 2** |
| Nuevo mínimo local / 52s | simétricos con el mínimo de la sesión |

- Dato insuficiente (menos barras que la ventana) = **`null`, nunca 0**. Un valor sin evento es `0`.
- Se conserva «Cerca del techo (≤1 %)» como indicador **aparte y con ese nombre**, para no perder
  la serie que ya existe. Deja de llamarse «Nuevos máximos».
- Weinstein recomienda leer las cifras **semanales**, no las diarias, porque filtran ruido
  (`diseno-indicadores-mercado-2026-08-17.md`, A.1.3). La vista debe poder agregar por semana.

## 3. Dónde se calcula

**Por fila, en el nocturno** (fase A). Una función pura nueva `newExtremes(bars)` en
`lib/indicators.js` junto a `highDist`/`lowAdv`, que devuelve cuatro campos:
`newHigh20`, `newHigh52`, `newLow20`, `newLow52` (1/0/null). Se llama desde las dos copias de la
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

- `lib/marketBreadth.js`: sustituye `nearHigh52w`/`nearLow52w` por pares reales (máx/mín 20
  sesiones, 52 semanas) con `measured`/cobertura como el resto; «Cerca del techo (≤1 %)» queda
  como indicador propio. Añade las dos claves nuevas al `select` de `readNightlyRows`.
- `app/market-health/UniverseBreadth.jsx`: los pares se pintan juntos (máximos | mínimos) y la
  diferencia neta; con la serie de la fase B, un minigráfico y el interruptor Diario/Semanal.
- Rótulo explícito del evento: «máximo de la sesión superior al de las 251 previas».
- Si falta cobertura (<60 %) el indicador se declara ausente, como hoy.

## 5. Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| Barras mensuales incrustadas en `daily_bars` (`daily-bars-barras-mensuales`) inflan el «máximo previo» y esconden máximos | La función exige cadencia diaria (ya existen guardas en `dailyBarsCache`); medir cuántas filas afecta antes de publicar |
| Splits: barras sin ajustar crean máximos/mínimos falsos | El nocturno usa `calcBars` ajustadas como el resto de distancias; la medición del 11-nov usó `daily_bars` crudas, así que sus cifras son una **cota con ruido** hasta repetirla con barras ajustadas |
| La población cambia (altas/bajas del universo) y mueve los porcentajes | Mostrar recuento y % sobre `universe_n` de cada día |
| Última sesión parcial o escaneo con fecha atrasada | Los símbolos con `lastDate` anterior a la fecha de mercado se excluyen de `measured`, como en la amplitud actual |
| Fuera de EE. UU. (decisión 10) | Mismo cálculo por mercado/región en una fase posterior; la tabla ya lleva `market` |
| Tests | Función pura con fixtures (máximo igualado ≠ máximo superado; ventana corta = null) + test de la lista blanca + mutación |

## 6. Plan en pasos (cada uno comiteable y reversible)

1. `newExtremes` en `lib/indicators.js` + tests + prueba con barras ajustadas de la base del Mini
   (repite la medición del 11-nov y confirma la cota). Sin tocar nada visible.
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

- ¿Aprobar el rumbo (evento real por fila + serie aparte)?
- ¿Conservar «Cerca del techo (≤1 %)» como indicador propio o retirarlo?
- ¿Diario por defecto con vista semanal opcional, o semanal por defecto (como recomienda Weinstein)?
- ¿Autorizas crear la tabla `market_extremes_daily` (fase B)?
- ¿Aplico ya el paso 0 (renombrar los dos indicadores actuales)?
