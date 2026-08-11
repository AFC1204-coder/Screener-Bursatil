# ADR — El escaneo del universo completo se mueve a un proceso nocturno en GitHub Actions

<!-- fecha interna: 2026-08-11 · BASE_SHA: 2d5307c · rama: codex/statsedge-ui-polish -->

Este documento es de **diseño**, no de implementación. No se ha modificado
ningún archivo de código, no se ha escrito nada en Supabase, no se ha
ejecutado ningún escaneo y no se ha hecho commit ni push. Todas las consultas
citadas son de solo lectura, vía la herramienta `supabase_query` (acotada,
sin `COUNT`/agregados).

**Decisión de arquitectura ya tomada, no se cuestiona aquí**: el escaneo del
universo completo sale de Vercel y pasa a un proceso nocturno en GitHub
Actions. El escaneo interactivo pasará después (fase futura) a leer lo ya
calculado en vez de calcularlo. **Esta tarea es solo la Fase 1**: que el
proceso nocturno cubra el universo estadounidense. No toca nada de lo que ve
el usuario.

**Resumen para el dueño, sin jerga**: hoy, cada noche, Vercel solo consigue
escanear entre 12 y 24 símbolos antes de que se le acabe el tiempo (60
segundos por invocación) — y de esos, como mucho 4 son de EE.UU., porque el
resto del cupo se lo reparten Hong Kong y Australia. A ese ritmo, cubrir los
~5.600 símbolos de EE.UU. tardaría años. GitHub Actions no tiene ese límite
de 60 segundos — el mismo mecanismo ya refresca las barras de precio de todo
el universo cada noche en 18 minutos. Este documento examina si se puede
hacer lo mismo con el escaneo completo (no solo las barras), cuánto
tardaría, qué haría falta cambiar, y qué pasa con la tabla `scan_results`,
que ya pesa ~490 MB sin ninguna política de retención real — un hallazgo
que resultó ser más grave de lo que parecía al empezar (ver Parte D).

---

## PARTE A — Qué hay hoy

### A.1 — `runMaterializedScan` de principio a fin

Firma y primeras líneas, [`lib/materializedScanner.js:1600-1608`](../lib/materializedScanner.js#L1600):
```js
export async function runMaterializedScan(options = {}) {
  const markets = normalizeMarketList(options.markets?.length ? options.markets : DEFAULT_MATERIALIZED_MARKETS, DEFAULT_MATERIALIZED_MARKETS);
  const maxPriceFreshnessDays = Number(options.maxPriceFreshnessDays || DEFAULT_PRICE_FRESHNESS_DAYS);
  options.onPhase?.("universe_select");
  const resolved = await resolveSymbols({ ...options, markets });
  options.onPhase?.("materialized_scan");
  const benchmarks = await hydrateBenchmarks({ ...options, maxPriceFreshnessDays });
  const selectedBySymbol = new Map((resolved.selectedRows || []).map((row) => [row.symbol, row]));
  const analyzed = await mapLimit(resolved.symbols, Number(options.concurrency || DEFAULT_CONCURRENCY), (symbol) => analyzeOne(symbol, benchmarks, {
    ...options,
    universeRow: selectedBySymbol.get(symbol),
    maxPriceFreshnessDays,
    maxFundamentalsAgeDays: Number(options.maxFundamentalsAgeDays || DEFAULT_FUNDAMENTALS_AGE_DAYS),
  }));
```

Paso a paso, con cita de cada pieza:

1. **Qué símbolos coge.** `resolveSymbols` (`lib/materializedScanner.js:1123-1205`) pide la
   instantánea de universo (`getUniverseEngineSnapshot`), la filtra a los
   mercados pedidos, lee qué se escaneó recientemente
   (`readRecentlyScannedSymbols`, consulta real contra `scan_results`) y
   selecciona filas con `selectUniverseRows` (`lib/materializedScanner.js:884-994`),
   que ordena por `materializationPriorityForRow` (nunca escaneado > escaneado
   hace tiempo con plan válido previo > el resto) y aplica `limit`/`perMarket`
   con un cursor por mercado (`selection.marketOffsets`/`nextMarketOffsets`,
   persistido en `app_settings` entre corridas — Parte D.10 del documento
   previo, sigue vigente).
2. **Qué calcula.** Para cada símbolo, `analyzeOne` (`lib/materializedScanner.js:1243-1268`)
   lee barras (`fetchChartForScan` → `withDailyBarsCache`) y perfil
   (`fetchProfileForScan` → `withProfileCache`) — leen de Supabase primero,
   Yahoo solo si falta o está caducado — y llama a `buildResearchRow`
   (`lib/materializedScanner.js:372-497`), que calcula SMA/RS/momentum/riesgo/
   patrón VCP/etapa semanal/composite, exactamente el mismo motor que usa el
   escaneo interactivo. Las filas que pasan `baseRejectReason` (turnover,
   market cap, cobertura mínima) se agrupan con `sectorize()`
   (`lib/materializedScanner.js:299-355`, copia local del cron — ver Parte C)
   y se filtran con `applyScreenerFilters`.
3. **Dónde escribe.** `runMaterializedScan` en sí **no escribe nada** — devuelve
   `{ scan, history, stats }` (`lib/materializedScanner.js:1678-1706`). Quien
   escribe es el caller: `app/api/cron/scan-refresh/route.js:225-238` llama a
   `writeMaterializedScan(result.scan)` (tabla `scans` + `scan_results`,
   `lib/materializedScanner.js:1535-1569`), `writeScanSymbolHistory(...)`
   (tabla `scan_symbol_history`) y `writeScanBatchCursor(...)`
   (`app_settings`, el cursor de la Parte A.1).

### A.2 — Qué lo limita a doce o veinticuatro símbolos por noche

**Es configuración, no un límite técnico** — pero el límite técnico real
(`maxDuration=60` en Vercel) es lo que fuerza esa configuración a ser tan
baja. Cita completa de `SCAN_CRON_GROUPS`, [`lib/cronPlan.js:21-70`](../lib/cronPlan.js#L21):
```js
export const SCAN_CRON_GROUPS = [
  { key: "core-us-hk-au", title: "Core US/HK/AU", markets: ["US", "HK", "AU"], limit: 12, perMarket: 4 },
  { key: "europe-priority", title: "Europe priority", markets: ["EU1"], limit: 24, perMarket: 3 },
  { key: "europe-secondary", title: "Europe secondary", markets: ["EU2"], limit: 21, perMarket: 3 },
  { key: "asia-japan", title: "Asia Japan", markets: ["JP"], limit: 24, perMarket: 24 },
  { key: "asia-taiwan", title: "Asia Taiwan", markets: ["TW"], limit: 20, perMarket: 20 },
  { key: "north-america-canada", title: "North America Canada", markets: ["CA"], limit: 24, perMarket: 24 },
  { key: "asia-singapore-africa", title: "Asia Singapore / Africa South Africa", markets: ["SG", "ZA"], limit: 24, perMarket: 12 },
];
```
**Matiz importante que el enunciado no recoge**: el único grupo que toca
EE.UU. es `core-us-hk-au`, con `limit: 12` **repartido entre US+HK+AU** y
`perMarket: 4` — es decir, **como mucho 4 símbolos de EE.UU. por invocación
de ese grupo**, no 12. Y el cron rota un grupo distinto cada vez que se
dispara — `app/api/cron/scan-refresh/route.js:176-181` (`scanCronGroupAt`,
`lib/cronPlan.js:222-226`, índice `+1` cada corrida exitosa,
`route.js:247`). El disparo en sí es **una vez al día**:
```
"path": "/api/cron/scan-refresh",
"schedule": "20 22 * * *"
```
(`vercel.json`). Con 7 grupos en rotación y una corrida diaria, `core-us-hk-au`
solo vuelve a tocarle turno **cada ~7 días** — así que la cobertura real de
EE.UU. hoy no es "hasta 4 símbolos por noche", es **hasta 4 símbolos cada
~7 días**, salvo que alguien dispare el grupo a mano con `?group=core-us-hk-au`
(el endpoint lo permite, `route.js:176`). Confirmado contra datos reales
(consulta `scans?select=local_id,row_count,created_at&order=created_at.desc&limit=200`,
30 días de historial): en esa ventana solo aparecen 3 corridas de
`materialized:US-HK-AU:*` (2026-07-21, 07-30, 08-06), con `row_count` 2, 3 y 2
respectivamente — consistente con el patrón de rotación semanal y el techo
`perMarket:4` (algunos de esos slots se pierden por símbolos que no pasan
`baseRejectReason`).

El límite técnico de fondo: `maxDuration = 60` (`app/api/cron/scan-refresh/route.js:13`).
`limit`/`perMarket` están dimensionados a mano por grupo para cubrir cada uno
en menos de 60s con `concurrency` 2-3 (`route.js:188`,
`DEFAULT_CONCURRENCY = 2`, [`lib/materializedScanner.js:60`](../lib/materializedScanner.js#L60)) —
son un **efecto** del techo de Vercel, no una elección de producto
independiente.

### A.3 — ¿Calcula los percentiles? No, y está documentado en el propio código

Confirmado, cita literal completa de `materializedScanProgress`,
[`lib/materializedScanner.js:1583-1585`](../lib/materializedScanner.js#L1583):
```js
// percentilesFinalized es SIEMPRE false: los percentiles del cron siguen siendo
// por lote (la finalización pertenece a la fase 3 del ADR de consolidación).
export function materializedScanProgress({ analyzed = [], savedRows = 0, total = 0, finishedAt = "" } = {}) {
```
El cron llama a su **propia copia local** de `sectorize()`
(`lib/materializedScanner.js:299-355`), que sí aplica `enrichRelativePercentiles`
— pero sobre `passedBase`, el conjunto de símbolos **de esa invocación**
(hoy, 2-24 símbolos), no sobre la población completa acumulada en
`scan_results`. El escaneo interactivo, en cambio, hace scoring por lote
(50 símbolos, igual de local) y luego **corrige** los percentiles con un
paso de finalización aparte, `finalizeScanResultsInDb`
(`lib/scanPercentileFinalization.js`, Parte C de este documento), que el
cron nunca invoca — ni se importa en `lib/materializedScanner.js`
(verificado por grep: sin coincidencias de `scanPercentileFinalization` en
ese archivo).

**Matiz que cambia el análisis de la Parte C**: la razón de que el cron NO
necesite finalización hoy no es que le falte una pieza — es que sus
invocaciones son tan pequeñas (2-24 símbolos) que "el lote" y "la población
completa de esta corrida" son la misma cosa. Si una corrida nocturna cubriera
los ~5.600 símbolos de EE.UU. **en una sola invocación de `runMaterializedScan`**,
`sectorize()` ya operaría sobre la población completa de esa corrida sin
ningún cambio de código — ver Parte C.10.

### A.4 — Qué escribe en `scan_results`: mismas columnas, `metrics` con más campos

`writeMaterializedScan` (`lib/materializedScanner.js:1535-1569`) escribe con
`scanResultPayload` (`lib/materializedScanner.js:1341-1533`); el escaneo
interactivo (`lib/serverScanRunner.js`) escribe con `resultPayload`
(`lib/serverScanRunner.js:103-127`). **Mismo juego de columnas** —
`owner_id, scan_id, symbol, company_name, country, sector, industry, theme,
rank_index, total_score, weinstein_score, minervini_score, risk_score,
rs_rating, metrics, raw`, verificado comparando ambas firmas literalmente.
La diferencia está **dentro** de `metrics`:
- `resultPayload` (interactivo): `metrics: scanDecisionMetrics(preparedRow)`
  — una función compartida.
- `scanResultPayload` (cron): `metrics: { ...scanDecisionMetrics(preparedRow),
  rsGlobalPct: ..., rsRating: ..., rsCountryPct: ..., ... }`
  (`lib/materializedScanner.js:1358-1526`) — la MISMA base más ~90 campos
  añadidos a mano (RS, volumen, patrón VCP, cobertura, cada uno con su
  `?? null`), que `scanDecisionMetrics` no incluye.

`raw` es idéntico en ambos: `scanDecisionRaw(preparedRow)`
(`lib/materializedScanner.js:1531`, `lib/serverScanRunner.js:125`, misma
función importada de `lib/scanDecisionProjection.js`). **Conclusión: no hay
divergencia de esquema, solo una proyección de `metrics` más rica en el cron**
— cualquier consumidor que lea `metrics.totalScore`/`metrics.rsGlobalPct`/etc.
funciona igual sobre filas de ambos orígenes; un consumidor que dependa de
alguno de los ~90 campos extra del cron fallaría silenciosamente (valor
`undefined`, no error) sobre una fila del escaneo interactivo, y viceversa
con los campos que `scanDecisionMetrics` calcula pero el spread manual del
cron no reproduce exactamente igual si algún día diverge — hoy no diverge,
pero es una duplicación de fuente de verdad a vigilar, no algo que esta tarea
deba resolver.

---

## PARTE B — Qué haría falta

### B.5 — Cambios necesarios para cubrir los ~5.600 símbolos de EE.UU.

Enumerado, sin implementar:

1. **Un punto de entrada ejecutable fuera de Next.js.** Hoy no existe
   (`grep -rl "runMaterializedScan" scripts/` → sin resultados, confirmado de
   nuevo en esta sesión). Haría falta un script `.mjs` nuevo, con el mismo
   patrón que `scripts/refresh-bars.mjs` (loader `@/` + import directo de
   `runMaterializedScan`/`writeMaterializedScan`/`writeScanSymbolHistory`/
   `writeScanBatchCursor` desde `lib/materializedScanner.js` y
   `lib/scanHistory.js`) — ver Parte B.7.
2. **`markets: ["US"]`, `perMarket: 0` (o sin definir), `limit` elevado a
   ~5.600-6.000.** Con `perMarket` en 0, `selectUniverseRows`
   (`lib/materializedScanner.js:938-951`) usa la rama de mercado único (no
   la de reparto por `perMarket`), así que `limit` controla directamente
   cuántas filas se seleccionan de la lista ya ordenada por prioridad — sin
   este cambio, el reparto `perMarket` seguiría capando el resultado muy
   por debajo del universo completo.
3. **`maxSavedRows` elevado.** `route.js:189` fija `maxSavedRows: 500`, y
   `runMaterializedScan` trunca a ese valor
   (`lib/materializedScanner.js:1619`, `.slice(0, Math.max(Number(options.maxSavedRows || 500), 1))`)
   **después** de rankear pero **antes** de escribir. Con el valor de hoy,
   una corrida de 5.600 símbolos analizados solo persistiría los 500
   mejores — probablemente no es lo que se quiere para un escaneo de
   "universo completo" (el escaneo interactivo de referencia guarda ~9.920
   de 10.000, no un top-500). Haría falta subirlo a un valor cercano al
   total esperado de filas que pasan el cribado base.
4. **Concurrencia.** `DEFAULT_CONCURRENCY = 2`
   (`lib/materializedScanner.js:60`); el cron hoy la limita a 1-3
   (`route.js:188`). Sin el techo de Vercel, se podría subir — pero ver
   B.6: no hay evidencia en el repo de qué concurrencia es segura frente al
   proveedor (Yahoo), solo que `refresh-bars.mjs` usa 4 en producción sin
   incidentes reportados desde su reactivación (`.github/workflows/refresh-bars.yml`).
5. **Retención del cursor por `offset`.** Si la corrida cubre el universo
   completo de una sola vez, el cursor de `app_settings`
   (`scan-refresh-cursor`) deja de tener trabajo real que hacer para EE.UU.
   dentro de esa corrida — pero conviene no borrarlo sin más: sigue
   sirviendo a los demás grupos (`europe-priority`, `asia-japan`, etc.) que
   seguirían corriendo con la lógica actual en Vercel salvo que también se
   migren (fuera de alcance de esta Fase 1).
6. **Secretos y disparo**, mismo patrón que `refresh-bars.yml`: un nuevo
   workflow de GitHub Actions con `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
   como repository secrets, cron propio, y `workflow_dispatch` para pruebas
   manuales.

### B.6 — ¿Corre bien fuera de Vercel? Dependencias de Next.js

**Repetición y confirmación del hallazgo ya documentado en
`docs/escaneo-github-actions-2026-08-04.md` (Parte A.2), re-verificado en
esta sesión sobre el código actual (`2d5307c`):**
```
grep -n "next/server\|next/headers\|next/cache" lib/materializedScanner.js lib/universeEngine.js \
  lib/universes.js lib/yahoo.js lib/supabaseServer.js lib/relativeStrength.js \
  lib/screenerFilters.js lib/scanHistory.js lib/scanPercentileFinalization.js
```
→ sin coincidencias (repetido con `lib/scanPercentileFinalization.js`
añadido a la lista, que no existía en agosto 4 y sí es relevante ahora para
la Parte C de este documento). `after()` de `next/server` sigue existiendo
solo en `app/api/scan/route.js` (camino interactivo), no en la cadena del
cron. El alias `@/lib/...` sigue sin resolverse en Node puro y sigue
teniendo solución ya usada en el repo: `scripts/loader.mjs`, invocado hoy
con `node --loader ./scripts/loader.mjs scripts/refresh-bars.mjs` en
`.github/workflows/refresh-bars.yml`.

**Novedad respecto al documento de agosto 4: `lib/scanPercentileFinalization.js`
(Parte C) tampoco depende de Next** — usa solo `supabaseRpc` (fetch nativo),
confirmado por el mismo grep. Es relevante porque si la Fase 1 decide
incluir finalización de percentiles (Parte C), esa pieza también es segura
de ejecutar en un runner de Actions.

**Nada nuevo depende de cabeceras/autenticación interna**: `isInternalRequest`
(`lib/internalAuth.js`) es la puerta HTTP de la ruta `/api/cron/scan-refresh`,
no algo que `runMaterializedScan` compruebe — un script que importe las
funciones directamente no la necesita, igual que concluyó el documento
previo.

### B.7 — El patrón de `refresh-bars.mjs`, y si es reutilizable

**Sí, y ya es el patrón validado en producción para este mismo problema.**
Piezas reutilizables, citadas:

1. **Loader + imports directos**, sin reescribir rutas relativas:
   `node --loader ./scripts/loader.mjs scripts/refresh-bars.mjs`
   (`.github/workflows/refresh-bars.yml`), con `import { ... } from "@/lib/supabaseServer.js"`
   tal cual (`scripts/refresh-bars.mjs:141-143`).
2. **`dry-run` por defecto, `--write` explícito** — mismo patrón de
   seguridad que ya usa `scripts/rs-universe.mjs`, citado en el propio
   archivo (`scripts/refresh-bars.mjs:177-200`).
3. **`mapLimit` con concurrencia acotada** (`scripts/refresh-bars.mjs:251-263`)
   — literalmente el mismo algoritmo que `mapLimit` de
   `lib/materializedScanner.js:552-564` (un pool de workers con
   `Math.min(limit, items.length)`), reescrito localmente porque el de
   `materializedScanner.js` no se exporta — reutilizarlo tal cual exigiría
   exportarlo, o seguir el mismo patrón de "reproducir, no importar" que ya
   adoptó `refresh-bars.mjs` para las funciones no exportadas de
   `rs-universe.mjs` (comentario explícito en `refresh-bars.mjs:82-91`).
4. **Try/catch por símbolo, nunca aborta la corrida entera** — mismo patrón
   que `analyzeOne` (`lib/materializedScanner.js:1243-1266`); el propio
   comentario de `refresh-bars.mjs:97-100` lo dice explícitamente.
5. **Tope de filas escritas, no de símbolos "caducados"**
   (`scripts/refresh-bars.mjs:154-173`, `DEFAULT_MAX_ROWS = 200000`) — la
   lección de producción del incidente del 9 de agosto (~700.000 filas
   tumbaron la instancia Micro 4 horas). Un script de escaneo nocturno
   tendría un perfil de riesgo distinto (escribe filas de `scan_results`,
   no de `daily_bars`, y cada fila es mucho más pesada — Parte D), así que
   el mecanismo de tope es reutilizable en espíritu pero el número
   (`DEFAULT_MAX_ROWS`) no lo sería sin recalcularlo para el tamaño de fila
   real de `scan_results`.
6. **El workflow YAML en sí**: `timeout-minutes`, `concurrency.group` (evita
   solapes con una corrida anterior que siga viva), `node-version: "20"`,
   `npm ci`, secretos vía `env:` del step — todo directamente reutilizable
   como plantilla para un segundo workflow.

### B.8 — Cuánto tardaría

Con los tiempos medidos citados en el enunciado de la tarea (décimas de
segundo por símbolo leyendo de la base; 10.000 símbolos en 456s en el
escaneo interactivo real) — **no re-derivé esa cifra de 456s de forma
independiente en esta sesión** (ver "LO QUE NO HE VERIFICADO"), pero es
consistente en orden de magnitud con dos datos que sí verifiqué ahora:

- `refresh-bars.mjs` (más simple: solo barras, sin scoring) procesó 5.565
  símbolos en 18 minutos a concurrencia 4 (`.github/workflows/refresh-bars.yml`,
  comentario de reactivación citando la corrida real
  `workflow 31391402414`) — 5.565 símbolos / 1.080s ≈ **194 ms/símbolo**
  con concurrencia 4, es decir ≈ 776 ms/símbolo de trabajo serie repartido
  entre 4 workers.
- El escaneo interactivo (`concurrency=5`, `lib/serverScanRunner.js:38`)
  hace bastante más por símbolo (scoring completo, no solo barras) y aun
  así, con la cifra del enunciado, 456s/10.000 ≈ **45,6 ms/símbolo**
  efectivos a concurrencia 5 (≈ 228 ms/símbolo de trabajo serie) — más
  rápido que `refresh-bars.mjs` en términos absolutos porque, a diferencia
  del refresco de barras (que SIEMPRE escribe si la barra está caducada,
  es decir prácticamente cada símbolo cada noche), el escaneo interactivo
  lee de caché caliente con más frecuencia y no reescribe `daily_bars` en
  cada símbolo.

**Aplicado a ~5.600 símbolos de EE.UU.**, usando la cifra del enunciado como
base (45,6 ms/símbolo efectivo a concurrencia 5): **≈ 255s (4,3 minutos)**
solo para la fase de análisis (`analyzeOne` sobre todos los símbolos). A
esto habría que sumar:
- La escritura de `scan_results` (`writeMaterializedScan`, tandas de 300 —
  `lib/materializedScanner.js:1560`), no medida por separado en esta sesión.
- Si se decide finalizar percentiles (Parte C): con `FINALIZE_READ_BATCH_SIZE=50`
  y `FINALIZE_PATCH_BATCH_SIZE=100`
  (`lib/scanPercentileFinalization.js:107,136`), ~5.600 filas serían ~112
  llamadas RPC de lectura + ~56 de escritura, secuenciales. La única
  medición directa disponible de una llamada de lectura pequeña (50-99
  filas) es **298 ms** (citado en el propio código,
  `lib/scanPercentileFinalization.js:125`, con origen en
  `docs/finalizacion-percentiles-2026-08-11.md` Parte A.4) — a ese ritmo,
  ~112 lecturas ≈ 33s, y un orden de magnitud similar para las escrituras
  (no medido, pero el propio código las estima "del orden de decenas a un
  par de cientos de milisegundos" para el cálculo puro, más lo que tarde
  cada `UPDATE`, ver `lib/scanPercentileFinalization.js:305-311`).

**Total estimado, orden de magnitud: unos pocos minutos** (probablemente
5-10 min con finalización incluida) — muy por debajo tanto del
`maxDuration=60` de Vercel (que ya no aplicaría) como de cualquier límite
razonable de un job de GitHub Actions (el propio `refresh-bars.yml` usa
`timeout-minutes: 30` para un trabajo de magnitud comparable). **Esta
estimación es aritmética sobre cifras medidas en circunstancias distintas
(otro paso, otra escala) — no una medición directa de un escaneo de 5.600
símbolos de EE.UU. en un runner de Actions**, que no existe todavía.

---

## PARTE C — Los percentiles

### C.9 — ¿Puede reutilizar `finalizeScanResultsInDb` tal cual, ahora troceado?

**Sí, literalmente sin cambios de código** — es una función pura de I/O
Supabase (Parte B.6), y su troceo de lectura+escritura (commits recientes,
`e1b56b6`/`fb1ce01`/`a41831e`/`2d5307c` en el historial de esta rama) ya
resuelve el problema que la mataba en Vercel: el `statement_timeout` de 8s
del rol `authenticator` — **eso es un límite de Postgres/Supabase, no de
Vercel**, así que **no desaparece** al mudarse a GitHub Actions. Cita del
propio comentario de cabecera,
[`lib/scanPercentileFinalization.js:16-23`](../lib/scanPercentileFinalization.js#L16):
```
// ESCRITURA EN TANDAS (...): hasta aquí, un scan de 9.920 filas moría con
// "canceling statement due to statement timeout" (límite de 8s del rol
// authenticator) porque finalize_scan_results aplicaba las 9.920 filas en
// un ÚNICO UPDATE
```
Lo que **sí desaparece** al mudarse a Actions es el otro límite, el que de
verdad mataba la finalización silenciosamente en el escaneo interactivo: el
`maxDuration=300` de la invocación de Vercel que orquesta el sweep completo
de tandas secuenciales (para un scan de 9.920 filas, ~199 lecturas + ~100
escrituras, cada una con latencia de red, fácilmente supera 300s sumadas).
En un script de GitHub Actions no hay ningún `maxDuration` — el proceso
sigue vivo hasta que termina, revienta con una excepción real (Node no
"muere en silencio": una promesa rechazada se propaga, `finalizeScanResultsInDb`
ya lanza errores tipados con `.finalizationPhase`, `.rowsPatched`, etc. —
Parte C del contrato JSDoc, `lib/scanPercentileFinalization.js:403-419`), o
lo mata el `timeout-minutes` del job si algo se cuelga de verdad — nunca el
estado "finalizing sin avanzar ni fallar" que describe el enunciado de esta
tarea para Vercel.

**Conclusión: el problema que motiva esta tarea (el proceso se queda
colgado en "finalizing" sin declararse muerto) desaparece al mudarse a
Actions, y `finalizeScanResultsInDb` es reutilizable tal cual** — el troceo
por 8s de Postgres seguiría aplicando igual (100 tandas de escritura para
9.920 filas seguirían siendo 100 llamadas RPC secuenciales), pero eso ya no
importa porque no hay reloj de Vercel corriendo en paralelo.

### C.10 — ¿Tendría sentido calcularlos en memoria y escribirlos de una vez?

**Ya es así, en parte, y el hallazgo de la Parte A.3 lo explica.** Dos
mecanismos distintos conviven en el repo hoy, y conviene no confundirlos:

1. **El cálculo en sí (`finalizeScanPercentiles`,
   `lib/scanPercentileFinalization.js:235-373`) ya es 100% en memoria, sin
   trocear** — el JSDoc lo dice explícitamente
   (`lib/scanPercentileFinalization.js:209`, "PURE: sin Supabase, sin IO") y
   el propio código de `finalizeScanResultsInDb` lo confirma: "el cálculo no
   se puede trocear: un percentil necesita conocer el `rsRawComposite` de
   TODAS las filas del scan antes de poder escribir la primera"
   (`lib/scanPercentileFinalization.js:394-397`). Lo que se trocea es SOLO
   la lectura previa y la escritura posterior — nunca el cálculo.
2. **La razón por la que el cron nunca ha necesitado esto**: su propia
   `sectorize()` (`lib/materializedScanner.js:299-355`) también calcula
   percentiles en memoria de una sola vez (`enrichRelativePercentiles`,
   sin trocear) — pero sobre `passedBase`, que hoy son 2-24 símbolos por
   invocación. **Si la corrida nocturna procesa los ~5.600 símbolos de
   EE.UU. en una única invocación de `runMaterializedScan`, `sectorize()`
   ya calcularía los percentiles sobre la población completa de esa
   corrida sin ningún cambio de código** — el "lote" y "la población total
   de la noche" pasarían a ser la misma cosa, exactamente el mismo efecto
   que perseguía originalmente `finalizeScanResultsInDb` para el escaneo
   interactivo (que sí trocea su scoring en lotes de 50 y por eso
   necesita corregir después).

Dicho de otro modo: **no haría falta invocar `finalizeScanResultsInDb` en
absoluto** si el diseño nocturno mantiene "una corrida = todo el universo en
un solo proceso, con `sectorize()` aplicado al final sobre el array
completo en memoria" — que es exactamente cómo ya funciona
`runMaterializedScan` hoy, solo que a una escala 200-2.000× mayor. La única
razón para SÍ querer `finalizeScanResultsInDb` sería si el diseño nocturno
decide trocear el propio análisis en varios procesos/jobs separados (p.ej.
para paralelizar entre varios runners de Actions) y necesita recomponer
percentiles después de unir resultados de corridas independientes — un
escenario que esta tarea no está obligada a resolver (Fase 1 es "que cubra
el universo", no "que lo haga en el menor tiempo posible con N runners en
paralelo").

**Matiz de riesgo, no cerrado aquí**: `sectorize()` del cron
(`lib/materializedScanner.js`) y `finalizeScanPercentiles` (usado por el
interactivo) son **implementaciones distintas que hoy dan resultados
distintos en construcción de campos** (Parte A.4 ya documentó que
`scanResultPayload`/`resultPayload` divergen en qué campos de `metrics`
incluyen) — no verifiqué en esta sesión si ambos caminos producen el MISMO
`rsGlobalPct`/`sectorScore` para el mismo símbolo con el mismo `raw` de
entrada (mismo algoritmo, `enrichRelativePercentiles`/`computeSectorScoresForRows`
son las mismas funciones importadas en los dos módulos — pero no ejecuté
ambos caminos sobre el mismo fixture para confirmar paridad numérica).

---

## PARTE D — Qué pasa con lo existente

### D.11 — `scan_results` sin retención: hallazgo más grave de lo que parecía

**Confirmado con datos reales, no solo con la cifra del enunciado (490 MB,
que no pude re-verificar de forma independiente — sin `COUNT`/agregados en
la clave de solo lectura, ver "LO QUE NO HE VERIFICADO").** Consulta
ejecutada:
```
supabase_query(table: "scans", select: "local_id,preset,row_count,created_at",
  order: "created_at.desc", limit: 200)
```
Resultado (200 filas más recientes, del 2026-06-20 al 2026-08-11, ~7,5
semanas): **todos los `scans` que existen hoy siguen existiendo** — no hay
ni un solo hueco donde debería haber una fila purgada. Solo en esa ventana
de 200 filas hay al menos 10 escaneos interactivos (`server-scan-*`) con
`row_count` entre 996 y 9.922 (suma aproximada de esos diez: **~52.000
filas**, solo del canal interactivo, solo en 7,5 semanas), más ~50-60
escaneos `materialized:*` del cron con `row_count` de 0 a 24 cada uno.
**Ninguno de los dos escritores automáticos aplica ninguna política de
retención.**

**Sí existe una política de retención en el schema — pero ninguno de los
dos escritores automáticos la usa.** Cita literal,
[`supabase/schema.sql:196-233`](../supabase/schema.sql#L196):
```sql
-- PURGA OPORTUNISTA (política de retención "últimos N scans por owner").
-- Política decidida por Fable (no rediseñar):
--   1. Retención: conservar los N=3 scans MÁS RECIENTES por owner_id
--      (ordenados por updated_at desc). Todo scan del mismo owner fuera de
--      ese top-3 se elimina.
--   ...
if v_accepted then
  declare
    v_owner text := coalesce(nullif(trim(p_owner_id), ''), 'personal');
    v_retention_count int := 3;
```
Esta lógica vive **dentro de la función `upsert_scan_newer_wins`** — y esa
RPC solo la llama `saveScan()` en
[`app/api/scans/route.js:397-406`](../app/api/scans/route.js#L397), que a
su vez solo se invoca desde el `POST` de ese mismo endpoint (sincronización
cloud del cliente, `lib/cloudSyncClient.js`). **Ni el escaneo interactivo
(`lib/serverScanRunner.js`, que escribe `scans`/`scan_results` directamente
con `supabaseRequest`, sin pasar por la RPC — confirmado por grep: cero
apariciones de `upsert_scan_newer_wins` en ese archivo) ni el cron
(`writeMaterializedScan`, mismo patrón de `supabaseRequest` directo sin
RPC) purgan nada.** Es decir: **los dos escritores automáticos que generan
la inmensa mayoría del volumen (miles de filas por escaneo interactivo,
docenas por corrida de cron) bypasean por completo la única política de
retención que existe en el repo.** La retención N=3 solo protege el canal
de guardado manual/sincronización desde el cliente, que en la muestra de
200 filas revisada aparece con mucha menos frecuencia que los otros dos.

Esto ya estaba documentado como hallazgo abierto en
`docs/poda-scan-results-2026-08-07.md` (Parte "STOP", ítem 1) pero
enmarcado como una limitación de una poda propuesta y no ejecutada — esta
sesión lo re-confirma con datos frescos de producción (agosto de 2026, no
julio) y añade el dato que faltaba: **cuánto volumen concreto se acumula
así, verificado, no inferido.**

**Efecto de un escaneo nocturno de universo completo sobre esto**: si
escribe ~5.000-9.000 filas cada noche (Parte B.8, del mismo orden que ya
escribe cada escaneo interactivo manual) usando el mismo patrón de
`writeMaterializedScan` (sin RPC, sin purga), el ritmo de crecimiento de
`scan_results` **se duplicaría o más** respecto al ritmo actual — que YA
crece sin freno, según lo verificado arriba. No es un problema nuevo que
esta tarea introduzca desde cero; es un problema existente y ya grave que
esta tarea, tal como está planteada (limpiarlo NO es su alcance), agravaría
significativamente si no se atiende en la misma fase o en la inmediatamente
siguiente.

### D.12 — ¿Sustituir el escaneo anterior o añadir uno nuevo? Opciones, sin decidir

1. **Añadir sin más, con `local_id` fechado** (patrón actual del cron:
   `materialized:US:2026-08-11:...`) — cada noche crea una fila `scans`
   nueva. Simple, coherente con el patrón existente, pero **no resuelve
   D.11**: cada noche suma otro conjunto completo de filas a
   `scan_results`, sin límite.
2. **`local_id` estable, sin fecha** (p.ej. `materialized:US:nightly-full`)
   — cada noche **reemplaza** la corrida anterior. `writeMaterializedScan`
   ya hace `on_conflict=owner_id,local_id` con `DELETE` + reinserción
   (`lib/materializedScanner.js:1541,1556-1559`) — este mecanismo YA es
   idempotente y YA purga la corrida anterior de la MISMA clave, sin
   ningún cambio de código, solo cambiando cómo se construye `localId` en
   `runMaterializedScan` (`lib/materializedScanner.js:1634-1640`, hoy
   incluye la fecha; bastaría con no incluirla para este `scan` concreto).
   Acota el crecimiento a "una noche de universo completo" en vez de
   "todas las noches acumuladas" — pero solo para ESTE escaneo nocturno
   nuevo, no arregla el crecimiento ya existente de los escaneos
   interactivos ni de los demás grupos del cron.
3. **Adoptar la RPC `upsert_scan_newer_wins`** para el escritor nocturno —
   heredaría la retención N=3 ya existente, pero **competiría por esas 3
   plazas con los escaneos interactivos del propio dueño** (la retención es
   por `owner_id`, no por tipo de escaneo) — un escaneo nocturno más un par
   de escaneos manuales el mismo día ya llenarían el cupo, desplazando
   escaneos manuales recientes. Requiere además reescribir el escritor
   nocturno para pasar por la RPC en vez de `writeMaterializedScan` directo
   — más cambio de código que la opción 2.
4. **Job de purga aparte**, no ligado a ningún escritor — un `DELETE`
   programado (cron de GitHub Actions o de Postgres) que borre
   `materialized-cache` con más de N días. Independiente de qué haga el
   escritor nocturno, pero es una pieza nueva, no una reutilización de lo
   que ya existe.

Ninguna de las cuatro está implementada; la opción 2 es la que menos
código nuevo requiere porque reutiliza un mecanismo de idempotencia que
YA existe y YA está probado (es como funciona el cron hoy para cada
combinación mercado+fecha+offset).

### D.13 — Los escaneos manuales del usuario: ¿conviven o se sustituyen?

**Conviven hoy, por construcción, y seguirían conviviendo con cualquiera de
las opciones de D.12.** Los escaneos manuales (`server-scan-*`,
`preset:"balanced"` u otro) y los del cron (`materialized:*`,
`preset:"materialized-cache"`) ya son filas `scans` completamente
independientes, con espacios de `local_id` que no se pisan — confirmado en
la consulta de D.11 (ambos tipos coexisten en la misma tabla, mismo
`owner_id`, sin conflicto). Un escaneo nocturno de universo completo sería,
en términos de esquema, una versión más grande del mismo patrón
`materialized:*` que ya corre — no sustituye nada del canal manual.

**Riesgo real que sí toca "lo que ve el usuario", pese a que la tarea pide
explícitamente no tocarlo**: `getLatestScanFromCloud()`
(`lib/cloudSyncClient.js:250-251`) pide `/api/scans?includeRows=1&limit=10&rowsLimit=2000`
— **los 10 `scans` más recientes de CUALQUIER preset**, sin filtrar por
`materialized-cache` (confirmado leyendo `app/api/scans/route.js:425-433`:
el `GET` no aplica ningún filtro de `preset` a la consulta de `scans`). Hoy,
con el cron escribiendo ~7 filas pequeñas al día (una por grupo en
rotación), esto ya convive sin problema aparente. Un escaneo nocturno
adicional (una fila más al día, pero con `row_count` grande) no cambia esa
cuenta de "filas en la tabla `scans`" — sigue siendo +1 fila/noche, igual
que cualquier otro grupo del cron — así que **no debería, por sí solo,
desplazar el escaneo manual del usuario fuera de la ventana de 10**. Lo que
SÍ cambia es el peso de esa fila en `scan_results` (Parte D.11) y,
si `findCompatiblePreviousScan` (`lib/methodologyEngine.js:187-190`)
alguna vez encontrara una `snapshotCompatibilityKey` que coincidiera entre
un escaneo manual y uno nocturno (no verificado si eso puede ocurrir con
los `settings` distintos de cada uno), podría usarse como "escaneo anterior
comparable" sin que el usuario lo haya pedido — riesgo de UX no descartado,
no confirmado tampoco.

---

## PARTE E — El plan

### E.14 — Plan por fases, de menor a mayor riesgo

**Fase 1a — Verificable sin tocar nada de lo que ve el usuario:**
- Escribir el script `.mjs` (patrón `refresh-bars.mjs`) con `--dry-run` por
  defecto, igual que su modelo — reporta qué símbolos escanearía y con qué
  prioridad (`materializationPriorityForRow`), sin llamar a
  `runMaterializedScan` en modo escritura ni tocar Supabase.
- Verificable ejecutando el script localmente en `--dry-run` y comparando
  su selección contra `selectUniverseRows` invocado hoy por el cron real
  (mismos símbolos, mismo orden de prioridad) — cero escritura, cero
  riesgo.

**Fase 1b — Verificable con escritura, pero acotada:**
- El mismo script con `--write --limit=N` pequeño (p.ej. 50-100 símbolos),
  contra un `local_id` de prueba claramente marcado (p.ej.
  `materialized:US:test-nightly:...`) para no interferir con el `local_id`
  de producción del cron actual (`materialized:US-HK-AU:...`).
  Verificable comparando las filas escritas contra lo que produciría hoy
  una llamada directa a `runMaterializedScan` con los mismos símbolos desde
  el cron de Vercel — deberían coincidir campo a campo salvo por el ruido
  esperado (precios/fecha).
- Riesgo: escribe en la instancia de producción (Micro, ya saturada dos
  veces esta semana) — por eso el límite bajo y un `local_id` desechable
  fácil de borrar a mano si algo sale mal.

**Fase 1c — El workflow de GitHub Actions, con el `local_id` de prueba
todavía, `workflow_dispatch` únicamente (sin `schedule`):**
- Mismo patrón que `refresh-bars.yml` (secretos, `timeout-minutes`,
  `concurrency.group`). Disparo manual desde la pestaña Actions, no
  automático — permite verificar que corre igual en el runner real antes
  de comprometerse a un horario.
- Verificable: comparar tiempos reales medidos contra la estimación de
  B.8, y confirmar que no hay ninguna sorpresa de entorno (Parte B.6) que
  solo aparezca en Actions y no en local.

**Fase 1d — `limit` elevado al universo completo (~5.600), todavía con
`local_id` de prueba, todavía manual:**
- Primera corrida real a escala completa. Aquí es donde D.11 (retención)
  debería estar ya resuelta — no tiene sentido escribir 5.000-9.000 filas
  de prueba sin plan de limpieza, con la instancia ya cerca de su límite.
- Decisión pendiente aquí, no en esta tarea: ¿aplicar D.12 opción 2
  (`local_id` estable) ANTES de esta fase, o después de confirmar que el
  volumen funciona? El orden más seguro es resolver D.11/D.12 antes de
  esta fase, no después.

**Fase 1e — `schedule` activado, `local_id` de producción, cron
`scan-refresh` en Vercel deja de incluir `US` en `SCAN_CRON_GROUPS`
(`core-us-hk-au` pasaría a ser solo `["HK", "AU"]`, o se retira ese grupo
si no queda nada útil que cubrir en Vercel):**
- Riesgo más alto: es el punto en el que el cron de Vercel deja de tocar
  EE.UU. y GitHub Actions se convierte en la única fuente de escaneo
  nocturno de ese mercado. Rollback: revertir `SCAN_CRON_GROUPS` es un
  cambio de una línea si algo falla.

### E.15 — Qué se podría retirar después

- **El cursor por `offset` para EE.UU.** (`scan-refresh-cursor`,
  `app_settings`) — si la corrida nocturna cubre el universo completo de
  una sola vez, no queda "resto" que continuar para ese mercado. Seguiría
  usándose para los grupos que sigan en Vercel (Europa, Asia, Canadá) hasta
  que también se migren, si es que se migran.
- **El grupo `core-us-hk-au` de `SCAN_CRON_GROUPS`**, o al menos `US` de su
  lista de mercados (Fase 1e arriba) — una vez GitHub Actions cubre el
  universo completo de EE.UU. cada noche, el cupo de 4 símbolos/semana que
  aportaba ese grupo en Vercel es irrelevante en comparación.
- **El troceo de la finalización de percentiles** (`FINALIZE_READ_BATCH_SIZE`,
  `FINALIZE_PATCH_BATCH_SIZE`) — **NO se puede retirar por este cambio**:
  el troceo existe por el `statement_timeout` de 8s de Postgres/Supabase
  (Parte C.9), un límite que no depende de dónde corre el proceso llamante.
  Seguiría haciendo falta igual en Actions que en Vercel, si es que la
  finalización llega a usarse ahí (C.10 sugiere que, para el diseño más
  simple de "todo el universo en una sola corrida", no haría falta
  invocarla en absoluto).
- **El encadenamiento por eslabones del escaneo interactivo**
  (`serverScanRunner.js`, `DEAD_LINK_MS`, `/api/scan/continue`) — esto es
  de un sistema distinto (el escaneo interactivo, que el usuario dispara a
  mano) y esta tarea no lo toca ni lo hace innecesario; seguiría existiendo
  igual después de esta migración, salvo que una fase futura (mencionada
  en el enunciado: "el escaneo interactivo pasará después a leer lo ya
  calculado") lo rediseñe por completo — eso es explícitamente una fase
  posterior, fuera de esta ADR.

---

## CONFIANZA

**Verificado leyendo código (alta confianza, cita directa):**
- `runMaterializedScan` completo, de principio a fin, y sus tres escritores
  aguas abajo (`writeMaterializedScan`, `writeScanSymbolHistory`,
  `writeScanBatchCursor`).
- `SCAN_CRON_GROUPS` completo, el techo real de EE.UU. (`perMarket:4`
  dentro de un `limit:12` compartido con HK/AU) y la cadencia semanal
  real de ese grupo (rotación de 7 grupos, una corrida/día).
- `percentilesFinalized` siempre `false` en el cron, con cita literal del
  comentario que lo confirma; por qué (invocaciones pequeñas = lote ya es
  población completa).
- Mismo esquema de columnas en `scanResultPayload`/`resultPayload`,
  diferencia solo en el contenido de `metrics`.
- Ausencia total de dependencias de Next.js en toda la cadena, incluida
  `lib/scanPercentileFinalization.js` (no auditada en el documento previo
  de agosto 4, sí en esta sesión).
- `finalizeScanResultsInDb` reutilizable tal cual; por qué el troceo
  (límite de Postgres, no de Vercel) no desaparece pero el problema real de
  esta tarea (proceso colgado sin declararse muerto) sí.
- El hallazgo de retención de `scan_results`: la RPC `upsert_scan_newer_wins`
  con purga N=3 existe en el schema pero ningún escritor automático la usa
  — confirmado leyendo los tres escritores (`serverScanRunner.js`,
  `materializedScanner.js`, `app/api/scans/route.js`) y contando las
  llamadas reales a esa RPC (una sola, en `saveScan`).
- `getLatestScanFromCloud`/`GET /api/scans` no filtran por `preset` —
  confirmado leyendo el `SELECT` real.

**Verificado consultando datos (Supabase, solo lectura, consultas citadas
literalmente):**
- `scans` con 200 filas más recientes (2026-06-20 a 2026-08-11): confirma
  que ningún escaneo se ha purgado en esa ventana, y da el orden de
  magnitud real de filas acumuladas (~52.000 solo de escaneos interactivos
  grandes, en 7,5 semanas) — evidencia directa y verificada de que D.11 es
  un problema real, no solo la cifra de 490 MB del enunciado (que no pude
  re-verificar por bytes).
- Confirmación de que `core-us-hk-au` corre aproximadamente cada 7 días
  (3 apariciones de `materialized:US-HK-AU:*` en 30 días de la muestra de
  200 filas), consistente con el mecanismo de rotación leído en el código.

**Inferido / no cerrado (confianza media o explícitamente abierto):**
- Las estimaciones de tiempo de B.8 (255s de análisis + finalización) son
  aritmética sobre cifras medidas en circunstancias distintas (otra
  escala, otro paso) — no hay una medición directa de un escaneo real de
  5.600 símbolos de EE.UU. en un runner de Actions, porque ese escaneo no
  existe todavía.
- Si `finalizeScanPercentiles` (interactivo) y `sectorize()` (cron)
  producen el mismo `rsGlobalPct`/`sectorScore` para el mismo símbolo con
  el mismo input — mismo algoritmo importado, pero no ejecutado
  comparativamente en esta sesión.
- Si `snapshotCompatibilityKey` puede coincidir entre un escaneo manual y
  uno nocturno de forma que `findCompatiblePreviousScan` mezcle ambos sin
  que el usuario lo pida (D.13) — riesgo señalado, no confirmado ni
  descartado.
- Cuál de las opciones de D.12 conviene — enumeradas explícitamente sin
  decidir, tal como pide la tarea.

## LO QUE NO HE VERIFICADO

- **El tamaño exacto de 490 MB de `scan_results`** citado en el enunciado
  de la tarea — la clave de solo lectura disponible no soporta
  `pg_total_relation_size` ni ningún agregado; lo tomo como dato ya
  conocido por el dueño, y lo contrasto (no lo confirmo en bytes) con el
  volumen de filas que sí pude contar directamente (Parte D.11).
- **La cifra "10.000 símbolos en 456 segundos"** del enunciado — no
  localicé el documento fuente exacto dentro del presupuesto de consultas
  acotado de esta sesión (grep sobre `docs/*.md` y `docs/*.txt` no dio con
  esa cifra literal); la uso como premisa dada por la tarea para la
  aritmética de B.8, contrastada solo en orden de magnitud contra datos que
  sí verifiqué (timestamps reales de un escaneo de 9.920 filas,
  `758dcea8-5e5b-4d52-ba17-e9210e806ac7`, y la medición de `refresh-bars.mjs`).
- **El coste real de una llamada `finalize_scan_results` (escritura) a
  escala de un lote de 100 filas** — el propio código de
  `lib/scanPercentileFinalization.js:100-106` admite que no está medido
  directamente; solo hay una cota razonada, no una medición.
- **Si `withDailyBarsCache`/`withProfileCache` se comportan igual a la
  escala de ~5.600 símbolos concurrentes** (concurrencia 4-5) que a la
  escala ya probada en producción (12-24 símbolos/noche en el cron, miles
  en el escaneo interactivo pero desde una función de Vercel, no desde un
  runner de Actions con IP/entorno de red distintos) — mismo patrón de
  código, pero nunca ejercitado desde Actions.
- **Si Yahoo Finance aplica algún rate limit no documentado en el repo**
  a la concurrencia/volumen de una corrida de universo completo — repetido
  del documento previo (`docs/escaneo-github-actions-2026-08-04.md` B.5-B.6),
  sigue sin evidencia ni a favor ni en contra en este repo.
- **Paridad numérica exacta entre `sectorize()` (cron) y
  `finalizeScanPercentiles` (interactivo)** sobre el mismo fixture — no
  ejecutado en esta sesión (serían pruebas de código, fuera del alcance de
  "no implementes nada todavía").
- **Si `findCompatiblePreviousScan` puede mezclar un escaneo manual con uno
  nocturno** vía `snapshotCompatibilityKey` — señalado como riesgo en D.13,
  no rastreado hasta el detalle de qué campos de `settings` determinan esa
  clave para ambos tipos de escaneo.
