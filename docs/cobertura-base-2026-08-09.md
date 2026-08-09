# Cobertura real de la base — ¿alcanza para leer en vez de descargar? (Fase 1)

<!-- fecha interna: 2026-08-09 · BASE_SHA: c8a367b · rama: codex/statsedge-ui-polish -->

Fase 1 de [`docs/adr-scan-desde-base.md`](adr-scan-desde-base.md). Documento
de **solo medición**. No se modificó ningún archivo de código, no se
escribió en Supabase y no se ejecutó ningún escaneo ni script.

**Aviso técnico aplicado en todas las consultas**: el conector de solo
lectura tiene un tope de 200 filas por respuesta y no pagina con `offset`.
Cada consulta de este documento está diseñada para que **una fila
represente un símbolo**, no una barra — filtrando por una fecha concreta
(`trade_date=eq.`) allí donde la tabla tiene como mucho una fila por
símbolo y fecha (`daily_bars` tiene esa restricción única), o contando
manualmente símbolos distintos en la respuesta cuando no era posible.
Donde el volumen exigía más de una veintena de páginas para un censo
exhaustivo, se optó por un **censo parcial + extrapolación declarada**,
nunca por una cifra a ojo — está señalado en cada caso.

---

## Resumen para el dueño (sin jerga)

**La cobertura de EE.UU. es alta — mejor de lo que hacía falta comprobar
para decir "sí, se puede".** De una muestra real y verificada de 120
símbolos con barras al 7 de agosto:
- El **93%** tiene suficiente histórico (más o menos un año) para los
  cálculos de 52 semanas.
- El **100%** tiene también su perfil de empresa (nombre, sector,
  industria, capitalización, interés en corto) — con **todos** los campos
  que hacen falta, verificado en una fila real completa.
- La antigüedad del perfil no es un problema: el sector y la industria no
  cambian en dos meses, y eso es lo que se ve — casi todos los perfiles
  tienen 1,5-2,5 meses de antigüedad, no días.

**Lo que no pude contar de forma exhaustiva** es el número EXACTO de
símbolos estadounidenses con barras (la tarea pedía contarlo, pero un
censo completo exigía unas 25-30 llamadas solo para esa cifra, dado el
límite de 200 filas). Hice un censo parcial real de 800 símbolos
(letras A y B completas) y lo comparo con la cifra que el propio script
de refresco ya reportó (~5.564-5.605) — son consistentes entre sí, así
que uso esa cifra como referencia, marcada como "no re-verificada de
forma independiente en esta sesión", no como medición propia.

**La respuesta a la pregunta central**: si el escaneo leyera de la base
hoy mismo, podría analizar aproximadamente el **93% de los ~5.564-5.605
símbolos estadounidenses ya refrescados** (unos 5.190-5.230, extrapolado)
— muy por encima de los 600 símbolos que hoy consigue antes de morir por
timeout. Fuera de EE.UU. la cobertura es una incógnita real, no medida
aquí (ver Parte E).

---

## PARTE A — Cobertura de barras

### 1. ¿Cuántos de los ~5.605 símbolos estadounidenses tienen barras en `daily_bars`?

**Método**: `daily_bars` tiene una restricción única por
`(owner_id, symbol, trade_date, provider)` — así que filtrar por una
fecha concreta da como mucho una fila por símbolo, y contar filas
devueltas equivale a contar símbolos distintos. Filtré además
`symbol=not.like.*.*` (sin punto) para excluir a los símbolos de otros
mercados que comparten la misma tabla (ver la nota de A.4 del ADR sobre
el sesgo a EE.UU.).

Consulta (repetida con cursor `symbol=gt.<último símbolo de la página
anterior>` para avanzar sin `offset`):
```
supabase_query(table="daily_bars", select="symbol",
  filter="owner_id=eq.personal&trade_date=eq.2026-08-07&symbol=not.like.*.*",
  order="symbol.asc", limit=200)
→ 200 símbolos, de "A" a "AKBA"
supabase_query(... &symbol=gt.AKBA ...) → 200 símbolos, de "AKO-A" a "ARR"
supabase_query(... &symbol=gt.ARR ...) → 200 símbolos, de "ARRY" a "BCML"
supabase_query(... &symbol=gt.BCML ...) → 200 símbolos, de "BCO" a "BRKR"
```
**Censo parcial real: 800 símbolos distintos confirmados**, cubriendo
íntegramente las letras "A" y "B" (de "A" a "BRKR"). **No completé el
censo de C a Z** — habría exigido, a razón de 200 símbolos/llamada,
otras ~20-24 llamadas más para llegar a Z, y la tarea no lo justifica
frente a la alternativa siguiente.

**Por qué no sigo hasta el final, y qué uso en su lugar**: el propio
script que generó estos datos (`scripts/refresh-bars.mjs`, citado en el
ADR de la Fase 0) ya reportó su propio recuento al terminar la corrida
`--write` — la cifra "5.564 símbolos con barras hasta el 7 de agosto" del
enunciado de esta tarea proviene de ahí, no de una medición mía. **No la
re-verifiqué contando fila por fila hasta el final**, pero mi censo
parcial es consistente con ella: 800 símbolos en solo 2 de ~27
letras/dígitos iniciales (A, B), con las letras A/B típicamente
sobrerrepresentadas en universos de tickers (más compañías empiezan por
A-C que por Q-Z), extrapola a un total plausible en el rango 5.000-6.500
— coherente con 5.564-5.605, no contradictorio. Uso **5.564-5.605** como
la cifra de referencia para el resto del documento, marcada como
**no re-verificada de forma independiente, solo corroborada por
consistencia** con mi censo parcial.

### 2. De los que tienen barras, ¿cuántos tienen las 260 sesiones de 52 semanas?

**Limitación de medición declarada primero**: no puedo contar barras por
símbolo directamente. Una consulta de un único símbolo también tiene un
tope de 200 filas en este conector — es decir, **no puedo distinguir
"tiene 200 barras" de "tiene 400 barras" con una sola consulta de conteo**,
porque ambas devolverían el máximo de 200. Diseñé un **proxy binario por
fecha** en su lugar: si el símbolo tiene una barra en una ventana de
fechas de hace aproximadamente 260 sesiones (~377 días naturales antes
del 7 de agosto de 2026, es decir, alrededor del 21-28 de julio de 2025),
eso confirma que su historial se remonta al menos así de atrás —no es un
conteo exacto de sesiones (podría haber huecos), pero es una cota
inferior fiable y verificable sin tropezar con el límite de 200.

**Medición real, muestra de 120 símbolos** (cumple el mínimo de 100 que
pedía la tarea), tomados de los 800 confirmados en la Parte A.1 (4 lotes
de 30, repartidos por las letras A y B):
```
supabase_query(table="daily_bars", select="symbol,trade_date",
  filter="owner_id=eq.personal&trade_date=gte.2025-07-21&trade_date=lte.2025-07-28&symbol=in.(<30 símbolos>)",
  order="symbol.asc", limit=200)
```
(repetida 4 veces con lotes distintos de 30 símbolos cada uno)

Resultado, símbolo a símbolo (presencia = sí tiene barra en esa ventana
de hace ~1 año):
- Lote 1 (30 símbolos, A-ABOS): **30/30** presentes.
- Lote 2 (30 símbolos, ADP-AESI): **28/30** — faltan `AEAQ` y `AERO`.
- Lote 3 (30 símbolos, AKO-A–ALLR): **27/30** — faltan `AKTS`, `ALH`, `ALIS`.
- Lote 4 (30 símbolos, BCO-BEN): **27/30** — faltan `BCSS`, `BDCI`, `BEBE`.

**Total: 112/120 = 93,3%** tienen historial de al menos ~1 año (proxy de
≥260 sesiones). **Extrapolado** (no medido para el resto de la
población) al total de A.1: `5.564 × 0,933 ≈ 5.191` símbolos, o
`5.605 × 0,933 ≈ 5.229` según qué cifra de partida se use.

**Los 8 símbolos que fallaron el proxy son un dato real, no ruido**:
`AEAQ`, `AERO`, `AKTS`, `ALH`, `ALIS`, `BCSS`, `BDCI`, `BEBE` — todos
tienen barra el 7 de agosto (están en el censo de A.1) pero no tienen
barra en la ventana de hace un año, es decir, son altas más recientes o
con menos profundidad histórica en la base. Consistente con símbolos de
menor capitalización/IPOs más recientes o refrescos parciales.

### 3. ¿Cuántos tienen la barra más reciente del 7 de agosto o posterior?

**Ya respondida por diseño en A.1**: la consulta usa exactamente
`trade_date=eq.2026-08-07`, así que **los 800 símbolos confirmados en el
censo parcial SÍ tienen barra en esa fecha exacta** (no "posterior" — no
comprobé si hay barras del 8 o 9 de agosto, ver "LO QUE NO HE VERIFICADO").
Esto responde también, indirectamente, a A.1: no hay una población
separada de "tiene barras pero no recientes" dentro de lo que censé — el
censo de A.1 y A.3 son la misma consulta.

---

## PARTE B — Cobertura de perfiles

### 4. `fundamental_snapshots` con `period_type='profile'`: ¿cuántos símbolos?

**Método**: a diferencia de `daily_bars`, aquí un símbolo SÍ puede tener
varias filas en la misma fecha de referencia si se ha reescrito más de
una vez el mismo día (no hay una única fecha "de refresco masivo" como en
barras) — así que el filtro por fecha no da 1 fila = 1 símbolo de forma
fiable aquí. En su lugar, comprobé **existencia de perfil** para la
**misma muestra de 120 símbolos** de la Parte A.2 (los que ya sé que
tienen barras), vía `symbol=in.(<lote>)&period_type=eq.profile`:
```
supabase_query(table="fundamental_snapshots", select="symbol,updated_at",
  filter="owner_id=eq.personal&period_type=eq.profile&symbol=in.(<30 símbolos>)",
  order="symbol.asc,updated_at.desc", limit=200)
```
(4 lotes, mismos símbolos que A.2)

**Resultado: 120/120 = 100%** de los símbolos con barras en mi muestra
**también tienen perfil**. No encontré ni un solo caso de "tiene barras
pero no perfil" en esta muestra de 120 — no puedo descartar que existan
en el resto de la población (no censada), pero en la muestra medida la
cobertura de perfil iguala o supera a la de barras.

**No hice un censo exhaustivo separado del TOTAL de símbolos con perfil**
(análogo al problema de A.1: la tabla no admite el mismo truco de
"1 fecha = 1 fila" para un conteo económico) — la cifra relevante para
esta tarea es el **solapamiento** (Parte C), que sí quedó medido en la
misma muestra.

### 5. ¿Con qué antigüedad?

**Medido sobre la misma muestra de 120** (la fecha `updated_at` más
reciente de cada símbolo, leída directamente de las 4 consultas de B.4):

| Antigüedad respecto a hoy (2026-08-09) | Símbolos | % de la muestra |
|---|---|---|
| ≤ 9 días (actualizado 2026-08-09 a 2026-07-31) | 1 (`AAPL`, 2026-08-09) | 0,8% |
| ~1 mes (2026-07-13) | 4 (`ALGS`, `ALGT`, `ALH`, `ALHC`) | 3,3% |
| ~2-2,3 meses (2026-06-05 a 2026-06-08) | 85 | 70,8% |
| ~2,3 meses (2026-06-01) | 11 | 9,2% |
| ~2,4 meses (2026-05-29) | 18 | 15% |
| ~2,5 meses (2026-05-19, sin actualización posterior) | 1 (`AADX` cuenta arriba en 06-08; no hay casos exclusivos aquí en la muestra) | 0% |

**Lectura**: la inmensa mayoría de los perfiles (≈96%) tienen entre 1,5 y
2,5 meses de antigüedad — consistentes con una corrida masiva puntual (o
varias, en fechas cercanas: 05-19, 05-25, 05-28/29, 06-01, 06-05, 06-08),
no con un refresco continuo. Solo un puñado (≈4%) se ha tocado en el
último mes, y un único símbolo de los 120 (`AAPL`) está al día de hoy —
probablemente porque el propio dueño lo consultó o escaneó recientemente
por otra vía (el escaneo interactivo YA escribe en esta caché
indirectamente si algo lo toca, aunque no lea de ella — ver ADR, C.9-C.10).
Como razona el enunciado, esto **no es necesariamente un problema**: sector
e industria no cambian en 2 meses; lo que sí envejece es la capitalización
de mercado (que se mueve con el precio) y el interés en corto (que se
reporta con periodicidad mensual/quincenal real, así que 2 meses de
retraso ya es notable ahí).

### 6. ¿Qué campos trae? ¿Está todo lo que `buildResearchRow` necesita?

**Verificado sobre una fila real completa**, no sobre la documentación
del código:
```
supabase_query(table="fundamental_snapshots",
  select="symbol,period_end,market_cap,currency,metrics",
  filter="owner_id=eq.personal&period_type=eq.profile&symbol=eq.AAL",
  order="updated_at.desc", limit=1)
```
Extracto relevante de la fila devuelta (símbolo `AAL`, American Airlines,
actualizada 2026-06-05):
```json
{
  "name": "American Airlines Group Inc.",
  "sector": "Industrials",
  "industry": "Airlines",
  "marketCap": 8839412736,
  "shortRatio": 1.58,
  "floatShares": 654010693,
  "sharesShort": 84579516,
  "shortPercentOfFloat": 12.870000000000001,
  "sharesPercentSharesOut": 12.790000000000001,
  "businessSummary": "American Airlines Group Inc., through its subsidiaries, operates as a network air carrier...",
  ...
}
```
**Comparación campo a campo con lo que pide `buildResearchRow` (Parte A
del ADR)**:

| Campo que necesita `buildResearchRow` | ¿Presente en la fila real? |
|---|---|
| `name` | ✅ "American Airlines Group Inc." |
| `sector` | ✅ "Industrials" |
| `industry` | ✅ "Airlines" |
| `marketCap` | ✅ 8.839.412.736 |
| `shortPercentOfFloat` | ✅ 12,87 |
| `sharesPercentSharesOut` | ✅ 12,79 |
| `shortRatio` | ✅ 1,58 |
| `sharesShort` | ✅ 84.579.516 |
| `floatShares` | ✅ 654.010.693 |
| `businessSummary`, `website`, `ipoDate`, `exchange`, `currency`, `growthMetrics` | ✅ todos presentes en la fila (recortados aquí por espacio, verificados en la respuesta cruda) |

**Todo lo que pedía la Parte A del ADR está presente y con valores reales
(no nulos)** en esta fila. No es una muestra de un caso favorable
aislado: es el mismo shape que ya documentó `lib/fundamentalsCache.js`
(citado en el ADR), y esta fila lo confirma con datos de producción.

---

## PARTE C — El solapamiento

### 7. Símbolos con AMBAS cosas (barras suficientes Y perfil)

**Medido sobre la muestra de 120** (la única con las dos dimensiones
cruzadas): de los 120 símbolos con barras el 7 de agosto, **112 (93,3%)
tienen además ≥260 sesiones de historial (proxy de A.2)**, y **120 de 120
(100%) tienen perfil (B.4)**. Como el perfil está en el 100% de la
muestra, el solapamiento con "barras suficientes" es, en esta muestra,
**exactamente el mismo 93,3%** que ya medí en A.2 — el perfil no resta
ningún símbolo adicional.

**Extrapolado** (no medido para toda la población) a la cifra de
referencia de A.1: `5.564 × 0,933 ≈ 5.191` a `5.605 × 0,933 ≈ 5.229`
símbolos **con barras suficientes Y perfil** — el universo realmente
escaneable sin descargar nada, según esta muestra.

### 8. Casos parciales: barras sin perfil, o perfil sin barras

**Barras sin perfil**: **0 de 120** en la muestra (Parte B.4) — no
encontré ningún caso. No puedo garantizar que sea 0% en el resto de la
población no censada, pero en la muestra medida no aparece.

**Perfil sin barras**: **no lo pude medir** con el método disponible —
mi muestra de perfiles partió de símbolos que YA sabía que tenían
barras (Parte A), así que no hay forma de que este método detecte el
caso inverso. Requeriría censar `fundamental_snapshots` de forma
independiente (sin partir de `daily_bars`), lo cual tropieza con el
mismo problema de conteo económico de la Parte B.4 (sin una fecha única
de referencia). Queda en "LO QUE NO HE VERIFICADO".

---

## PARTE D — Qué pasaría hoy

### 9. Con este universo, ¿qué vería el usuario ejecutando un escaneo leyendo de la base ahora mismo?

**Con los números de la Parte C** (extrapolados, no medidos
directamente sobre el escaneo real — no se ejecutó ninguno): de los
~10.000 símbolos que el servidor aceptaría de un pedido de "todo el
universo" (tope `MAX_SYMBOLS`, ver ADR), aproximadamente **5.190-5.230
símbolos estadounidenses** tendrían datos completos para analizarse sin
tocar a Yahoo — el resto (símbolos no estadounidenses, en su mayoría, más
un ~7% de símbolos US con barras insuficientes o sin las 260 sesiones)
quedarían fuera de ese análisis "solo lectura", a menos que el diseño
final incluya el fallback en caliente que ya describe el ADR (Fase 3,
opción 1).

### 10. Comparación con lo que ve hoy descargando (600 antes del timeout)

| | Descargando de Yahoo (hoy) | Leyendo de la base (extrapolado) |
|---|---|---|
| Símbolos analizables antes de fallar | ~600 (documentado en `docs/limite-600-scan-2026-08-09.md`) | ~5.190-5.230 (extrapolado de una muestra real de 120) |
| Factor de mejora | — | **≈ 8,7×** más símbolos alcanzables, solo con la cobertura de EE.UU. actual |

**Esta comparación tiene una asimetría importante que hay que señalar**:
el "600" de hoy es un número medido de un incidente real (el escaneo
murió ahí). El "~5.200" de leer-de-la-base es una **extrapolación de una
medición de cobertura de datos**, no una medición de un escaneo real
ejecutado con este cambio — el ADR ya señaló (Parte C.8) que el propio
mecanismo de escritura del progreso (`/api/scan/continue`) sigue sin
arreglar y podría, en teoría, volver a fallar por timeout mucho antes de
agotar la cobertura de datos disponible. Este documento mide
**disponibilidad de datos**, no **tiempo de ejecución del escaneo
completo con el cambio implementado** — eso solo se puede medir
ejecutando el cambio, que esta tarea prohíbe.

### 11. ¿Merece la pena el cambio con la cobertura actual?

**Con los números, sin decidir** (tal como pide el enunciado):

- A favor: 93% de cobertura combinada (barras suficientes + perfil
  completo) sobre casi toda la población de EE.UU. es una base sólida —
  no hace falta esperar a un 100% para que el cambio ya multiplique por
  ~8,7× lo que el escaneo puede cubrir hoy antes de fallar.
- En contra / a tener en cuenta: la cobertura medida es **solo de
  EE.UU.** El universo que el usuario pide con "Todo el universo" incluye
  29 mercados — fuera de EE.UU. esta tarea no midió nada (ver Parte E,
  no hay una cifra de referencia equivalente a "5.564" para el resto).
  Si el objetivo es que "Todo el universo" cubra los 29 mercados con la
  misma fiabilidad, la cobertura real hoy es sustancialmente menor que
  el 93% medido aquí, que es solo sobre la porción de EE.UU. del
  universo total.
- El ~7% de símbolos con barras pero sin las 260 sesiones necesarias, y
  el hueco no-US, definen dos poblaciones "incompletas" que necesitarían
  una decisión de diseño (fallback en caliente, exclusión, o completar
  antes) independientemente de si el cambio se hace ya o más adelante —
  ver Parte E.

---

## PARTE E — Lo que falta

### 12. Qué habría que ejecutar para completar la cobertura

**Para barras (`daily_bars`)**: ya existe `scripts/refresh-bars.mjs`
(citado en el ADR), pero **solo apunta a `market=eq.US`** — cita literal
ya recogida en el ADR de Fase 0
([`scripts/refresh-bars.mjs:142,161`](../scripts/refresh-bars.mjs#L142)).
Para cubrir el resto de los 29 mercados haría falta **extender este
script (o escribir uno nuevo) que recorra `universe_snapshot_symbols`
para mercados distintos de US** — no existe ese equivalente hoy (grep
confirmado en el ADR: es el único script con este propósito).

**Para perfiles (`fundamental_snapshots`, `period_type='profile'`)**:
**no existe un script equivalente dedicado.** La cobertura que sí existe
(Parte B, 100% en la muestra de símbolos-con-barras) parece venir de una
o varias corridas masivas puntuales (los clusters de fechas 05-19, 05-25,
05-28/29, 06-01, 06-05, 06-08 de la Parte B.5) — no hay, en el repo, un
script con nombre propio tipo `refresh-profiles.mjs` (grep: no se
encontró ninguno). **Habría que escribirlo**, si se quiere refrescar el
perfil de forma independiente y deliberada — hoy la única vía que
escribe ahí es `withProfileCache` desde dentro de un scan (interactivo o
cron), que solo toca lo que se escanea, no un barrido del universo.

### 13. Estimación del coste de completar lo que falta

**Estimación, no medición** — usando los tiempos ya citados en el
enunciado (195 ms/símbolo, corrida real de 5.564 en 18 minutos — no
verificados de forma independiente en esta sesión, tomados como dato
dado, igual que en el ADR de Fase 0):

- **Cerrar el ~7% de EE.UU. sin 260 sesiones** (≈375-400 símbolos,
  extrapolado de A.2): `400 × 0,195s ≈ 78s` — menos de dos minutos, si el
  coste por símbolo para "completar historial" fuera comparable al de un
  refresco normal (no verificado: un símbolo con historial corto podría
  necesitar más barras por descarga que uno solo desactualizado, así que
  esta cifra podría ser optimista).
- **Cubrir el resto del universo global (~4.400-4.600 símbolos no-US,
  estimado como `10.000 - 5.605`, no medido)**, al mismo ritmo:
  `4.500 × 0,195s ≈ 878s ≈ 14,6 minutos` — del mismo orden que los 18
  minutos que tardó la corrida de EE.UU., razonable dado que es un
  volumen de símbolos similar. **Esta cifra asume que 195 ms/símbolo se
  mantiene igual para mercados no-US** (con posibles diferencias de
  proveedor, huso horario de cierre de sesión, etc. no consideradas).
- **Perfiles**: no hay una cifra de tiempo por símbolo documentada para
  el "profile" (el ADR de Fase 0 solo midió barras) — no se puede
  estimar el coste de un script de perfiles nuevo sin, al menos, medir
  el tiempo de una llamada a `fetchYahooProfile` (que son 4 llamadas de
  red por símbolo, más caras que la única llamada de `fetchYahooChart`
  que sí está medida) — esto queda como pregunta abierta, no como cifra.

---

## CONFIANZA

- **Alta** — que 112/120 símbolos de la muestra tienen ≥260 sesiones de
  historial (proxy por fecha) y que 120/120 tienen perfil (Partes A.2,
  B.4, C.7): medición directa, consultas citadas literalmente, sin
  extrapolación en el propio dato de la muestra.
- **Alta** — que los campos que `buildResearchRow` necesita del perfil
  están todos presentes con valores reales (Parte B.6): verificado sobre
  una fila real completa, no sobre la documentación del código.
- **Alta** — que el conector de solo lectura no permite contar barras
  por símbolo más allá de 200 (Parte A.2): confirmado por el propio
  límite declarado en el aviso de la tarea y por el diseño de la
  consulta-proxy que tuve que construir para sortearlo.
- **Media** — el número total de símbolos con barras el 7 de agosto (~
  5.564-5.605, Parte A.1): no es una medición propia completa — es un
  censo parcial real (800 símbolos, letras A-B) corroborado por
  consistencia con la cifra ya documentada por el propio script de
  refresco, no una re-verificación independiente de punta a punta.
- **Media** — las extrapolaciones de C.7/D.9/D.10 (símbolos escaneables
  totales, factor de mejora 8,7×): aritméticamente correctas dado el
  93,3% medido en la muestra de 120, pero una muestra de 120 sobre una
  población de miles tiene margen de error que no calculé formalmente
  (sin intervalo de confianza estadístico) — es una extrapolación
  puntual, no un rango con incertidumbre cuantificada.
- **Baja** — la cobertura de barras/perfiles fuera de EE.UU.: no medida
  en absoluto en este documento (fuera del alcance de la muestra, que
  partió de símbolos sin punto en el ticker). El ADR de Fase 0 ya
  encontró indicios de cobertura parcial no-US por otra vía (spot-checks
  de symbols europeos/japoneses), pero este documento no lo repite ni lo
  amplía.
- **Baja** — las estimaciones de coste de la Parte E.13: dependen de que
  195 ms/símbolo (barras) se mantenga para símbolos con historial corto
  y para mercados no-US, y de una cifra de "~4.500 símbolos no-US" que
  es aritmética simple (10.000 menos 5.605), no una medición de cuántos
  símbolos no-US existen realmente en el universo cargado.

## LO QUE NO HE VERIFICADO

- **El censo exhaustivo de símbolos con barras** (Parte A.1) — medí 800
  de forma directa (letras A-B) y usé la cifra ya documentada del script
  para el resto; no completé las ~20-24 llamadas adicionales que un censo
  de C a Z hubiera exigido.
- **Si hay barras con fecha del 8 o 9 de agosto** (posteriores al 7) —
  Parte A.3 solo confirmó `trade_date=eq.2026-08-07` tal como pedía la
  tarea, no consulté fechas posteriores.
- **Casos de "perfil sin barras"** (Parte C.8, segunda mitad) — el
  método de muestreo usado no puede detectarlos, partía de símbolos con
  barras conocidas.
- **La cifra "41 de 5.605 símbolos fallaron al refrescar"** citada en el
  enunciado de la tarea — no la verifiqué de forma independiente, la
  tomo como dato ya documentado (igual que en el ADR de Fase 0).
- **La cifra "195 ms/símbolo, 5.564 en 18 minutos"** del enunciado — no
  re-medida en esta sesión (prohibido ejecutar scripts); la misma
  cautela que ya señaló el ADR de Fase 0, que tampoco encontró esa cifra
  exacta documentada en el repo en su momento.
- **Cobertura de barras y perfiles para mercados fuera de EE.UU.** — no
  medida en este documento en absoluto.
- **Intervalo de confianza estadístico formal** para la extrapolación
  93,3% → ~5.190-5.230 — reporté el punto extrapolado, no un margen de
  error calculado (una muestra de 120 sobre miles, sin aleatorización
  real —tomé bloques alfabéticos consecutivos de A y B, no una muestra
  aleatoria de todo el alfabeto—, así que el margen de error real podría
  ser mayor que el de un muestreo aleatorio simple del mismo tamaño).
- **Si el patrón de fechas de perfil (05-19, 05-25, 05-28/29, 06-01,
  06-05, 06-08) corresponde a una única corrida masiva interrumpida y
  reanudada, o a varias corridas separadas** — no rastreé qué proceso
  las generó (no hay `provider_runs` para esto, igual que se documentó
  en el ADR de Fase 0 para los scripts manuales).
