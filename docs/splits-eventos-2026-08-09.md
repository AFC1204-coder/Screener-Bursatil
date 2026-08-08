# Diagnóstico — ¿conoce Yahoo los splits que corrompen `daily_bars`?

<!-- fecha interna: 2026-08-09 · BASE_SHA: 2d06512 · rama: codex/statsedge-ui-polish -->

Documento de **diagnóstico**. No se modificó ningún archivo de código,
no se escribió en Supabase. Se usaron 10 de las 12 peticiones a Yahoo
permitidas (una por símbolo, 2s de espaciado).

**Respuesta corta a la pregunta que decide el diseño**: Yahoo reporta
al menos un evento de split para **6 de los 10** símbolos afectados —
pero esa cifra es engañosa si se usa sola. **En los 6 casos, la fecha
y el ratio del evento reportado NO coinciden con el salto de precio
real observado en la propia serie de Yahoo** (verificado numéricamente
para los 6, ver B.5). Es decir: Yahoo "conoce" que hubo splits en
estos tickers, pero su metadato de evento está desacoplado de su
propia serie de precios — no sirve, tal cual, para ajustar
retroactivamente el salto que realmente vemos en los datos.

---

## PARTE A — Qué hace el código con los eventos hoy

### A.1 — Dónde se pide y se procesa `events=div,splits`

Cita literal, `lib/yahoo.js:1226-1281` (función `fetchYahooChartDirect`):
```js
const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${encodeURIComponent(request.yahooRange)}&interval=${encodeURIComponent(request.yahooInterval)}&includePrePost=false&events=div%2Csplits`;
// ...
const splitEvents = Object.values(r.events?.splits || {})
  .map((event) => {
    const numerator = Number(event.numerator);
    const denominator = Number(event.denominator);
    const time = Number(event.date);
    return {
      date: Number.isFinite(time) ? new Date(time * 1000).toISOString().slice(0, 10) : "",
      numerator,
      denominator,
      ratio: Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? numerator / denominator : null,
    };
  })
  .filter((event) => event.date && Number.isFinite(event.ratio) && event.ratio > 0);
// ...
return {
  bars,
  meta: {
    ...(r.meta || {}),
    dataProvider: "Yahoo Finance",
    // ...
    splitEvents,
  },
};
```

**El array SÍ se parsea y SÍ se guarda** — en `meta.splitEvents` del
objeto que devuelve `fetchYahooChart`. No se descarta en el punto de
descarga.

**Pero se pierde después, camino a `daily_bars`.** `writeDailyBarsCache`
(`lib/dailyBarsCache.js:316-`) recibe el `chart` completo (con
`chart.meta.splitEvents` disponible) pero solo proyecta `chart.bars` a
través de `cleanWriteBar` — nunca lee ni persiste `chart.meta.splitEvents`
en ninguna parte de la fila que escribe. Confirmado también por el DDL
(A.2): no hay ninguna columna en `daily_bars` donde ese dato pudiera
ir. El único consumidor real de `splitEvents` en todo el repo es
`app/api/company-brief/route.js:1124-1163`
(`splitFactorAfterDate`/`normalizeEpsRowForSplits`), y solo para
ajustar filas de EPS por cambios en acciones en circulación — nunca
para precios.

### A.2 — ¿Existe alguna columna o tabla para persistir splits?

**No.** Búsqueda en el esquema:
```
grep -n "split" supabase/schema.sql
```
No devuelve ninguna tabla ni columna relacionada con splits/corporate
actions. El DDL de `daily_bars` (ya citado en el diagnóstico previo,
`docs/splits-daily-bars-2026-08-09.md`) no tiene columna para esto —
solo `close`/`adj_close`/`volume`/etc. No hay tabla `corporate_actions`,
`splits`, ni nada equivalente en todo `supabase/schema.sql`.

### A.3 — Qué haría falta para guardarlos (sin implementarlo)

Concretamente, para que `splitEvents` sobreviva más allá de la
memoria de una sola petición:
1. Una tabla nueva (ej. `symbol_split_events`) con columnas mínimas
   `symbol, event_date, numerator, denominator, ratio, source, discovered_at`
   — igual de sencilla que la estructura que ya arma
   `fetchYahooChartDirect` en `splitEvents`, solo habría que darle un
   hogar persistente.
2. Modificar `writeDailyBarsCache` (o un paso nuevo antes/después) para
   leer `chart.meta.splitEvents` y hacer upsert en esa tabla — hoy ese
   campo llega hasta `writeDailyBarsCache` pero se ignora.
3. Un criterio de qué hacer con las barras existentes cuando se
   detecta un split nuevo (¿ajustar retroactivamente en el momento? ¿solo
   registrar el evento y dejar el ajuste para un job aparte?) — esto ya
   es diseño de arreglo, fuera del alcance de este documento.

No implementado ni propuesto como solución — solo lo que técnicamente
falta para que el dato deje de perderse en el camino.

---

## PARTE B — Cuántos splits conoce Yahoo

### B.4/B.5 — Las 10 peticiones

**Método**: réplica exacta del endpoint/parámetros del código
(`lib/yahoo.js:1229`), `range=2y` (para cubrir con margen amplio todas
las fechas de salto conocidas, desde 2025-01 hasta 2026-03),
`interval=1d`, `events=div%2Csplits`. Una petición por símbolo, con
`sleep 2` entre cada una:
```
GET https://query1.finance.yahoo.com/v8/finance/chart/<SYM>?range=2y&interval=1d&includePrePost=false&events=div%2Csplits
```
Las 10 respuestas: `HTTP 200` en los 10 casos (DUKR, HKIT, HUBC, EZGO,
QMMM, BCTX, SBET, TDIC, IBO, PASW).

**Resultado, símbolo por símbolo** (eventos de split reportados por
Yahoo, y si el ratio/fecha coincide con el salto real observado en la
propia serie de esa misma respuesta):

| symbol | eventos de split en Yahoo | fecha(s) evento | ratio reportado | salto real más grande en la serie (fecha, factor) | ¿coincide fecha y magnitud? |
|---|---:|---|---|---|---|
| DUKR | 0 | — | — | 2026-03-05→06, **25,53x** | N/A (no hay evento que comparar) |
| HKIT | 3 | 2026-04-06, 2026-05-29, 2026-07-06 | 1:50, 1:3, 1:25 | 2026-06-01→02, **10,61x** | **No** — ninguna fecha de evento coincide con el salto observado, y en las fechas de los propios eventos el precio real casi no se mueve (ver tabla siguiente) |
| HUBC | 4 | 2025-03-31, 2026-01-16, 2026-04-20, 2026-06-08 | 1:10, 1:15, 1:50, 1:20 | 2026-06-03→04, **3,22x** | **No**, mismo patrón |
| EZGO | 2 | 2025-11-21, 2026-05-19 | 1:25, 1:150 | 2026-05-05→06, **11,88x** | **No**, mismo patrón |
| QMMM | 0 | — | — | 2025-09-08→09, **18,37x** (más extremo que el "congelado" del informe anterior) | N/A |
| BCTX | 1 | 2025-08-25 | 1:10 | 2025-01-29, **15,95x** | **No** — el evento reportado es 7 meses *posterior* al salto real que motivó la inclusión de BCTX en esta lista |
| SBET | 1 | 2025-05-06 | 1:12 | 2025-05-23→27, **5,33x** | **No exacto** — 17 días de diferencia entre el evento y el salto, y el ratio reportado (12x) no coincide con el factor observado (5,33x) en ninguna de las dos fechas |
| TDIC | 2 | 2026-04-20, 2026-06-15 | 1:5, 1:25 | 2026-05-13→14, **28,81x** | **No** — el salto real cae *entre* los dos eventos reportados, sin coincidir con ninguno |
| IBO | 0 | — | — | 2025-06-20→23, **4,45x** | N/A |
| PASW | 0 | — | — | 2026-01-08→09, **3,09x** | N/A |

**Verificación numérica de la no-coincidencia** (para los 6 símbolos
con evento reportado, ratio observado en el precio real exactamente en
la fecha del evento de Yahoo, comparado contra el ratio que el propio
evento afirma):

| symbol | fecha evento | ratio reportado | precio real antes→después de esa fecha exacta | ratio observado | factor real en esa fecha |
|---|---|---|---|---|---|
| HKIT | 2026-04-06 | 1/50 = 0,0200 | 135,00 → 140,25 | 1,0389 | **1,04x** (prácticamente sin movimiento) |
| HKIT | 2026-05-29 | 1/3 = 0,3333 | 40,80 → 36,50 | 0,8946 | 1,12x |
| HKIT | 2026-07-06 | 1/25 = 0,0400 | 4,13 → 4,28 | 1,0376 | 1,04x |
| HUBC | 2025-03-31 | 1/10 = 0,1000 | 56.550 → 43.050 | 0,7613 | 1,31x |
| HUBC | 2026-01-16 | 1/15 = 0,0667 | 4.545 → 4.660 | 1,0253 | 1,03x |
| HUBC | 2026-04-20 | 1/50 = 0,0200 | 148,00 → 111,00 | 0,7500 | 1,33x |
| HUBC | 2026-06-08 | 1/20 = 0,0500 | 3,82 → 1,76 | 0,4607 | 2,17x |
| EZGO | 2025-11-21 | 1/25 = 0,0400 | 285,00 → 318,00 | 1,1158 | 1,12x |
| EZGO | 2026-05-19 | 1/150 = 0,0067 | 1,95 → 2,18 | 1,1179 | 1,12x |
| BCTX | 2025-08-25 | 1/10 = 0,1000 | 7,00 → 7,49 | 1,0700 | 1,07x |
| SBET | 2025-05-06 | 1/12 = 0,0833 | 4,92 → 3,84 | 0,7805 | 1,28x |
| TDIC | 2026-04-20 | 1/5 = 0,2000 | 16,75 → 16,75 | 1,0000 | 1,00x |
| TDIC | 2026-06-15 | 1/25 = 0,0400 | 5,75 → 5,43 | 0,9443 | 1,06x |

**El resultado es inequívoco: en las 13 ocasiones donde Yahoo reporta
un evento de split con un ratio concreto, el precio real en esa fecha
exacta se mueve como mucho un 2,17x — nunca ni de lejos el ratio que
el propio evento afirma (5x a 150x).** Esto significa que, aunque
Yahoo "sabe" que hubo splits en estos tickers en algún momento, su
metadato de fecha/ratio de evento está desconectado de su propia serie
de precios — usar `events.splits` tal cual para ajustar retroactivamente
la serie de `close` no reconstruiría el salto real observado.

### B.6 — Recuento

- **De los 10 símbolos, Yahoo reporta al menos un evento de split para
  6: HKIT, HUBC, EZGO, BCTX, SBET, TDIC.**
- **Para 4 no reporta ninguno: DUKR, QMMM, IBO, PASW.**
- **De los 6 con evento reportado, en NINGUNO el ratio/fecha del
  evento coincide con el salto de precio real observado** (verificado
  arriba, 13 comparaciones directas, factor máximo real en cualquier
  fecha de evento: 2,17x, frente a ratios reportados de 5x-150x).

Dicho de otro modo: si la pregunta es "¿tiene Yahoo *algún* registro de
que hubo un split en este ticker alguna vez?", la respuesta es sí en
6/10. Si la pregunta es "¿puedo usar ese registro para corregir el
salto que veo en los datos?", la respuesta verificada es **no, en
ninguno de los 10**.

---

## PARTE C — Distinguir split de movimiento real

### C.7 — Volumen del día del salto vs. media de 20 días previos

Se calculó, para el salto más grande de cada uno de los 10 símbolos
(mismas respuestas de la Parte B, sin peticiones adicionales):

| symbol | fecha del salto | factor | volumen del día | volumen medio 20d previos | ratio vol. |
|---|---|---:|---:|---:|---:|
| DUKR | 2026-03-06 | 25,53x | 100 | 16.845 | **0,01x** |
| BCTX | 2025-01-29 | 15,95x | 17.960 | 88.379 | **0,20x** |
| HUBC | 2026-06-04 | 3,22x | 7.080.415 | 8.667.480 | 0,82x |
| QMMM | 2025-09-09 | 18,37x | 14.819.400 | 4.892.880 | 3,03x |
| HKIT | 2026-06-02 | 10,61x | 964.892 | 198.191 | 4,87x |
| TDIC | 2026-05-14 | 28,81x | 3.910.144 | 564.312 | 6,93x |
| EZGO | 2026-05-06 | 11,88x | 1.697.026 | 9.538 | 177,92x |
| SBET | 2025-05-27 | 5,33x | 54.492.800 | 503.901 | 108,14x |
| PASW | 2026-01-09 | 3,09x | 42.905.500 | 202.510 | 211,87x |
| IBO | 2025-06-23 | 4,45x | 427.611.600 | 268.840 | **1.590,58x** |

### C.8 — ¿El criterio separa con claridad?

**Mayormente sí, con una zona gris clara.**

- **Volumen muy por debajo de lo normal (ratio < 0,25x): DUKR (0,01x),
  BCTX (0,20x).** Un salto de precio de 15-25x con prácticamente cero
  acciones negociadas (100 acciones en el caso de DUKR) es la firma
  clásica de un ajuste mecánico (split/contrasplit) sin presión de
  compraventa real detrás — nadie "compró" ese salto, el precio se
  recalculó.
- **Volumen fuertemente elevado (ratio > 100x): SBET (108,14x), PASW
  (211,87x), IBO (1.590,58x), EZGO (177,92x, aunque sobre una base de
  volumen diario muy pequeña —9.538— que hace el ratio más ruidoso).**
  Estos muestran actividad de negociación real y masiva el día del
  salto — compatible con un catalizador de noticias genuino (o con un
  episodio de pump-and-dump, que también es volumen "real" aunque no
  necesariamente fundamentales sanos).
- **Zona gris: HUBC (0,82x), QMMM (3,03x), HKIT (4,87x), TDIC (6,93x).**
  Estos no caen limpiamente en ninguno de los dos extremos. HUBC en
  particular (0,82x, prácticamente volumen normal) es ambiguo: ni
  claramente "sin volumen" como DUKR/BCTX, ni claramente "elevado".
  QMMM y HKIT (3-5x) están en un rango donde un movimiento genuino de
  una acción volátil también podría producir ese nivel de actividad
  sin ser necesariamente un evento corporativo.

El criterio de volumen **separa con claridad los dos casos más
extremos en cada dirección**, pero no da un veredicto limpio para 4 de
los 10 símbolos.

### C.9 — ¿SBET se distingue por volumen?

**Sí, con claridad.** SBET: ratio de volumen **108,14x** (54,5 millones
de acciones negociadas frente a una media previa de 504.000) — muy
lejos de DUKR (0,01x) y BCTX (0,20x), los dos casos que sí parecen
ajustes mecánicos sin negociación real. Esto es consistente con que el
salto de SBET (5,33x, 2025-05-23→27) refleje un movimiento de mercado
genuino y no un artefacto de datos — aunque, como se vio en B.5, Yahoo
también reporta un evento de split (1:12) para SBET en una fecha
cercana (2025-05-06) que no coincide exactamente con este salto. Es
plausible que ambas cosas hayan ocurrido en la vida real del valor (un
split real seguido, semanas después, de un rally genuino por
catalizador) — el volumen por sí solo no distingue esas dos capas, solo
confirma que el salto medido no fue un ajuste silencioso sin
negociación.

---

## PARTE D — Las opciones

### D.10 — Salidas (sin recomendar ninguna)

1. **Usar el evento de split de Yahoo cuando exista, e inferirlo del
   precio cuando no.** Qué se toca: persistir `chart.meta.splitEvents`
   (A.3) y aplicar el ratio reportado en la fecha reportada; cuando no
   haya evento, caer a una heurística de precio como la de
   `docs/splits-daily-bars-2026-08-09.md` (ratio >3x/<1/3x). Qué cubre:
   los 4 casos sin evento (DUKR, QMMM, IBO, PASW) quedarían cubiertos
   por la inferencia de precio. Qué deja fuera: **según lo verificado
   en B.5/B.6, esta opción NO resuelve los 6 casos con evento
   reportado** — el evento de Yahoo no coincide con el salto real, así
   que aplicarlo tal cual produciría una corrección en la fecha y
   magnitud equivocadas, dejando el salto real intacto. Para que esta
   opción funcionara de verdad en los 6 casos con evento, haría falta
   además la inferencia de precio como respaldo — es decir, en la
   práctica, para estos 10 símbolos, "usar el evento cuando exista"
   habría cubierto 0 de 10 sin la inferencia de precio de todos modos.
2. **Inferirlo siempre del precio, con criterio de volumen.** Qué se
   toca: un detector como el de la Parte A del informe previo (ratio
   >3x/<1/3x) más el filtro de volumen de C.7-C.8. Qué cubre: los
   casos extremos en ambas direcciones (DUKR/BCTX como splits
   probables; SBET/PASW/IBO como movimientos probablemente genuinos).
   Qué deja fuera: la zona gris de C.8 (HUBC, QMMM, HKIT, TDIC) — para
   esos 4, el criterio de volumen no da un veredicto limpio, así que
   cualquier decisión automática ahí tendría una tasa de error no
   despreciable.
3. **Buscar otra fuente de eventos societarios** (ver D.11). Qué se
   toca: una integración nueva o extendida (ver D.11 sobre FMP, ya
   parcialmente presente en el repo). Qué cubre: potencialmente los
   casos donde Yahoo falla, si la fuente alternativa tiene mejor
   cobertura para estos micro-caps concretos — no verificado en esta
   tarea (no se consultó ninguna fuente alternativa con una petición
   real, solo se identificaron candidatas). Qué deja fuera: cualquier
   corporate action que tampoco esté en esa fuente alternativa —
   desconocido sin probarlo.
4. **Excluir los símbolos afectados.** Qué se toca: el mismo filtro ya
   descrito en el informe previo (Parte D, opción 3 de
   `docs/splits-daily-bars-2026-08-09.md`). Qué cubre: evita que el
   dato corrupto contamine cualquier cálculo agregado (RS, screener).
   Qué deja fuera: no corrige nada para quien consulte el símbolo
   individualmente (ficha), y no distingue los casos "movimiento real"
   (SBET, IBO, PASW) de los "artefacto" (DUKR, BCTX) — trataría a
   todos igual, excluyendo también movimientos de mercado legítimos.

### D.11 — ¿Hay alguna fuente gratuita de splits para valores US?

Búsqueda web realizada. Candidatas encontradas:

- **Financial Modeling Prep (FMP)** — ofrece un "Stock Splits Calendar
  API" con acceso gratuito según su documentación. **Dato relevante
  para este proyecto concreto**: FMP ya está parcialmente integrado en
  el repo (`lib/fmp.js`), usado hoy como fuente opcional de
  fundamentales/estados financieros (`app/api/company-brief/route.js`,
  gateado por la variable de entorno `FMP_API_KEY` — según lo visto en
  sesiones anteriores de este mismo repo, esa clave puede no estar
  configurada en este entorno, lo cual no se reverificó en esta
  tarea). Extender esa integración existente para pedir también el
  calendario de splits reutilizaría la plumbing ya presente
  (`FMP_BASE`, manejo de `FMP_API_KEY`) en vez de añadir un proveedor
  nuevo desde cero.
- **EODHD (End of Day Historical Data)** — plan gratuito con datos
  históricos de splits desde enero 2015 según su propia documentación,
  para NYSE/NASDAQ/AMEX. No integrado hoy en el repo.
- **Nasdaq Data Link, tabla ZUSP (Zacks Upcoming Splits)** — cubre
  splits *futuros* anunciados (prensa/8-K), no parece ser gratuita de
  forma clara según lo encontrado.
- **Barchart Corporate Action API** — de pago.

No se hizo ninguna petición real a ninguna de estas fuentes en esta
tarea (fuera del alcance: la restricción de peticiones era solo para
Yahoo, pero verificar cobertura real para los 10 símbolos afectados
habría requerido claves de API no disponibles en este contexto de
solo lectura). Esto queda como candidata a explorar, no como opción
verificada.

Sources:
- [Corporate Actions: Splits and Dividends API](https://eodhd.com/financial-apis/api-splits-dividends)
- [How to Track Stock Splits and Corporate Actions with a Free API | FMP](https://site.financialmodelingprep.com/how-to/how-to-track-stock-splits-and-corporate-actions-with-a-free-api)
- [Calendar API: Upcoming Earnings, Trends, IPOs and Splits | EODHD APIs](https://eodhd.com/financial-apis/calendar-upcoming-earnings-ipos-and-splits)
- [US Upcoming Splits](https://data.nasdaq.com/databases/ZUSP)
- [ZUSP | Zacks Upcoming Splits Documentation](https://data.nasdaq.com/databases/ZUSP/documentation)
- [Stock Splits Calendar API | Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs/stock-split-calendar-api)
- [Stock Splits Calendar 2026 | Upcoming Stock Splits](https://www.tickergate.com/stock-splits-calendar)
- [Corporate Action API](https://www.barchart.com/ondemand/api/getCorporateActions)

---

## CONFIANZA

- **Alta (petición HTTP real citada, o código citado literal)**: A.1
  (código de descarga/parseo/pérdida de `splitEvents`), A.2 (ausencia
  de tabla/columna en el DDL), B.5/B.6 (las 10 respuestas de Yahoo,
  la no-coincidencia numérica verificada en 13 comparaciones directas
  fecha-por-fecha), C.7/C.9 (volumen extraído de las mismas respuestas
  ya citadas, sin peticiones adicionales).
- **Media (interpretación razonada sobre datos medidos, no un hecho
  binario verificable)**: C.8 (dónde trazar la línea entre "sin
  volumen" y "volumen elevado" es una interpretación, no un umbral
  objetivo dado por el proveedor).
- **Baja / no verificado**: D.11 (las fuentes alternativas se
  identificaron por búsqueda web, ninguna se consultó con una petición
  real; no se sabe si cubrirían específicamente estos 10 micro-caps).

## LO QUE NO HE VERIFICADO

- **No consulté ninguna fuente alternativa a Yahoo con una petición
  real** (FMP, EODHD u otra) — no sé si alguna de ellas tiene el split
  real de DUKR, QMMM, IBO o PASW (los 4 sin evento en Yahoo) ni si sus
  eventos, de existir, coincidirían mejor con los saltos observados de
  lo que coincide Yahoo.
- **No verifiqué si `FMP_API_KEY` está configurada en este entorno** —
  mencioné que en sesiones previas de este repo pareció no estarlo,
  pero no lo reconfirmé en esta tarea.
- **No investigué la causa de que los eventos de Yahoo estén
  desalineados con el precio real** — no sé si es un problema de zona
  horaria en las fechas, un desfase de "ex-date" vs "fecha de
  anuncio", datos de terceros mal etiquetados por Yahoo, o algo más.
  Solo constaté el desalineamiento, no su origen.
- **No confirmé el origen real de los saltos en la zona gris** (HUBC,
  QMMM, HKIT, TDIC) más allá del criterio de volumen — no busqué
  noticias ni eventos societarios documentados externamente para
  ninguno de los 10 símbolos.
- **No verifiqué si HUBC, con sus 4 eventos de split reportados por
  Yahoo en ~15 meses, corresponde a un patrón real de "reverse splits
  en cadena"** (común en penny stocks en riesgo de deslistado) —  es
  una lectura plausible de los datos, no confirmada con una fuente
  externa.
- **El umbral de "salto anómalo" (>3x o <1/3x) usado para localizar el
  "mayor salto" en cada serie es el mismo del informe anterior** — no
  se probaron umbrales alternativos ni se verificó si alguno de estos
  10 símbolos tiene un segundo salto igual de significativo en otra
  fecha del rango de 2 años (el análisis se centró en el salto más
  grande de cada serie, no en todos los saltos).
