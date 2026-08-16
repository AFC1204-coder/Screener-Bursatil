# Diseño: «¿Qué ha cambiado?» — la pantalla del sábado (2026-08-16)

Base: `codex/statsedge-ui-polish` @ `c50aa8d`. Tarea de diseño y propuesta; ningún cambio
de código, ninguna escritura en Supabase, ningún escaneo ejecutado.

Contexto: docs/analisis-friccion-2026-08-15.md (A1, D11.1, F8) identificó que «la pregunta
del sábado no tiene pantalla» y que `scan_symbol_history` guarda deltas que nadie lee.
Este documento responde: qué hay guardado de verdad, qué merece llamarse «cambio», qué
dice exactamente el resumen, y qué se ve al abrir el detalle.

Decisiones ya tomadas que este diseño implementa sin reabrir: resumen breve en el
screener enlazado a un detalle completo; discreto (una línea); con el «desde cuándo»
explícito; comparando con el escaneo anterior como punto de partida.

Etiquetas: **[MEDIDO]** consulta ejecutada sobre producción con cifra literal;
**[REPRODUCIDO]** comportamiento ejecutado en local con el código real; **[CÓDIGO]**
afirmación con cita; **[ESTIMADO]** extrapolación declarada con su método;
**[INFERIDO]** mecanismo derivado sin traza completa.

Método de acceso a datos: la herramienta MCP `supabase_query` (PostgREST, solo lectura)
para lo directo; para los volúmenes que la herramienta no soporta (agregados
deshabilitados — `PGRST123: "Use of aggregate functions is not allowed"` [MEDIDO]), un
script local de **solo GET** contra `rest/v1` con las credenciales del proyecto,
paginado, con los agregados computados en local. La vía documentada en memoria para SQL
ad-hoc (Management API) devuelve hoy `401 Unauthorized` con el token de `.env.local`
[MEDIDO] — mismo estado que el `DATABASE_URL` placeholder ya conocido.

---

# PARTE A — Qué hay guardado

## A.5 El esquema y quién lo escribe

### El esquema (cita literal)

[supabase/migrations/20260729130755_scan_symbol_history.sql](../supabase/migrations/20260729130755_scan_symbol_history.sql) — cabecera y columnas:

```sql
-- Histórico change-only de escaneos por símbolo.
create table public.scan_symbol_history (
  id bigint generated always as identity primary key,
  owner_id text not null,
  symbol text not null,
  mic_code text not null,
  observed_at timestamptz not null,
  observed_week date not null,
  data_as_of date,
  source_scan_id uuid not null,
  source_pipeline text not null,
  stage text,
  stage_week integer,
  rs_global numeric,
  rs_benchmark numeric,
  rs_country numeric,
  rs_sector numeric,
  composite_score numeric,
  composite_coverage numeric not null,
  composite_partial boolean not null,
  scoring_engine_version text not null,
  data_provider text not null,
  passed_screen boolean not null,
  absence_reason text,
  absence_detail text,
  change_reasons text[] not null,
  created_at timestamptz not null default now(),
  ...
```

Tres piezas del esquema definen la semántica:

- **Change-only**: `check (cardinality(change_reasons) > 0)` — no existe fila sin motivo.
- **Idempotencia**: `unique (owner_id, source_scan_id, mic_code, symbol)` con
  `resolution=ignore-duplicates` en el escritor.
- **Una salida del universo no arrastra métricas**: el check
  `scan_symbol_history_out_of_universe_shape` exige que una fila con
  `absence_reason = 'not_in_universe'` tenga `data_as_of`, `stage`, `stage_week` y todos
  los RS/composite a null, `composite_coverage = 0` y `composite_partial = true`
  (líneas 105-122 de la migración). Este check es protagonista de una avería (A.6.2).

### Qué se escribe en cada corrida (cita literal)

El decisor de cambios es [lib/scanHistory.js:45-74](../lib/scanHistory.js:45):

```js
export function scanHistoryChangeReasons(previous, current) {
  if (!previous) return ["first_appearance"];
  const reasons = [];
  if (Boolean(previous.passed_screen) !== Boolean(current.passed_screen)) reasons.push("screening_changed");
  if ((previous.absence_reason || null) !== (current.absence_reason || null)) reasons.push("absence_reason_changed");
  if (hasComparableData(previous) && hasComparableData(current)) {
    if ((previous.stage || null) !== (current.stage || null)) reasons.push("stage_changed");
    if ((previous.stage_week ?? null) !== (current.stage_week ?? null)) reasons.push("stage_week_changed");
    for (const [field, reason] of RS_FIELDS) {
      const before = finiteOrNull(previous[field]);
      const after = finiteOrNull(current[field]);
      if (Number.isFinite(before) && Number.isFinite(after) && Math.abs(after - before) > 5) {
        reasons.push(reason);
      }
    }
  }
  // Excepción aprobada: una salida del universo se registra una vez al cambiar
  // de estado, pero no produce anclas semanales indefinidas.
  if (
    current.absence_reason !== "not_in_universe"
    && previous.observed_week !== current.observed_week
  ) {
    reasons.push("weekly_anchor");
  }
  return reasons;
}
```

Es decir: por cada símbolo observado se inserta fila solo si (a) es la primera vez, (b)
cambió el cribado o el motivo de ausencia, (c) cambió la etapa o su semana, (d) algún RS
se movió **más de 5 puntos** respecto a la última fila registrada, o (e) es la primera
observación de una semana nueva (`weekly_anchor` — el ancla que garantiza al menos una
fila por símbolo y semana mientras esté en el universo). La comparación es siempre contra
la última fila registrada de ese símbolo (RPC `scan_symbol_history_latest_v1`,
migración líneas 182-207), no contra «ayer».

Las observaciones salen del escáner materializado —
[lib/materializedScanner.js:1303-1346](../lib/materializedScanner.js:1303)
(`materializedScanHistoryObservations`) construye una observación por **cada símbolo
analizado** (pase o no el cribado), con `stage` = `weeklyStageState`, los cuatro RS, el
compuesto y el motivo de ausencia — y
[lib/materializedScanner.js:1833-1842](../lib/materializedScanner.js:1835) las devuelve
en `result.history` a quien invoca el scan.

### Las tres rutas que escriben

`grep -rn "writeScanSymbolHistory" app lib` da exactamente tres llamadas [CÓDIGO]:

| Ruta | Cadencia | Llamada |
|---|---|---|
| [app/api/cron/scan-refresh/route.js:230](../app/api/cron/scan-refresh/route.js:230) | Diaria 22:20 UTC (vercel.json), rotación de 7 grupos | `writeScanSymbolHistory({ownerId, sourceScanId, ...result.history})` |
| [app/api/cron/shadow-europe-refresh/route.js:381](../app/api/cron/shadow-europe-refresh/route.js:381) | Diaria 22:50 UTC, grupos shadow europeos | ídem |
| [app/api/jobs/scan-refresh/route.js:392](../app/api/jobs/scan-refresh/route.js:392) | Bajo demanda (batch HTTP) | ídem |

Y el escritor [lib/scanHistory.js:176-222](../lib/scanHistory.js:176)
(`writeScanSymbolHistory`) lee el último estado por símbolo, decide los cambios, añade
las salidas de universo si el snapshot es autoritativo, y hace **un solo POST** con todas
las filas nuevas (`prefer: resolution=ignore-duplicates`).

## A.6 Lo que contiene hoy (medición sobre producción)

Descarga completa de la tabla en 3 páginas [MEDIDO]:

```
supabase_query table=scan_symbol_history order=id.asc limit=200
  select=id,symbol,mic_code,observed_at,observed_week,data_as_of,source_pipeline,stage,
         stage_week,rs_global,rs_benchmark,rs_country,rs_sector,composite_score,
         composite_coverage,composite_partial,scoring_engine_version,data_provider,
         passed_screen,absence_reason,change_reasons
  (y filter=id=gt.200 / id=gt.400 para las páginas 2 y 3)
```

**Totales**: 552 filas, ids 1→577 (25 huecos por duplicados ignorados), 398 símbolos
distintos (mic+symbol), del 2026-07-29T19:44Z al 2026-08-14T23:08Z (17 días), 29 corridas
distintas. Un solo `source_pipeline` (`materialized_scan`), un solo
`scoring_engine_version` (`eaee4f1`), un solo `data_provider` (`yahoo`).

**Por semana** (`observed_week`): 2026-07-27 → 115 filas · 2026-08-03 → 237 · 2026-08-10
→ 200. **Por noche**: entre 3 y 73 filas (mediana ~27), en 1-2 corridas por noche, todas
entre las 22:20 y las 23:35 UTC — es decir, **solo los dos crons de Vercel**; ninguna
corrida a las ~04:00 UTC (la hora del escaneo nocturno grande, ver A.6.1).

**Por mercado**: XTSE 82 · XTAI 63 · XPAR 36 · XAMS 36 · XJSE 35 · XSES 33 · XLON 27 ·
XJPX 25 · … · **EEUU: XNYS 4 + XNGS 3 + XNCM 3 + XNMS 3 = 13 filas** (2,4% del
histórico, siendo el mercado del usuario objetivo).

**Campos con valor de verdad** (sobre 552):

| Campo | Con valor | Nota |
|---|---|---|
| stage | 518 (93,8%) | vocabulario real: `stage4` 166 · `base` 155 · `stage2` 125 · `mixed` 72 |
| stage_week | 552 (100%) | ojo: incluye el bug A.6.2 en potencia |
| rs_global | 324 (58,7%) | |
| rs_benchmark | **13 (2,4%)** | coherente con el hallazgo del ADR de consolidación: benchmarks locales sin hidratar en scans batch |
| rs_country | 477 (86,4%) | |
| rs_sector | 196 (35,5%) | |
| composite_score | 518 (93,8%) | composite_coverage ≥ 0,7 en 518 |
| data_as_of | 546 (98,9%) | |
| passed_screen=true | 331 (60%) | ausencias: filtered_out 187 · insufficient_data 34 · **not_in_universe 0** |

**Por qué se escribió cada fila** (`change_reasons`, una fila puede llevar varias):
`first_appearance` **492 (89,1%)** · `weekly_anchor` 41 · `stage_week_changed` 32 ·
`rs_country_moved` 23 · `stage_changed` 11 · `rs_global_moved` 9 · `rs_sector_moved` 6 ·
`screening_changed` 0.

**Profundidad por símbolo**: 265 símbolos con una sola fila; 133 con ≥2; **solo 31
símbolos tienen filas en 2 semanas distintas; ninguno en 3**. Cambios de etapa
registrados en 17 días: 9 (5 de ellos `base→stage2`; 0 salidas de etapa 2).

La lectura honesta: la tabla está en fase de «primera vez que veo este símbolo», no de
detección de cambios. No es una limitación del mecanismo — es que casi nadie la alimenta.

## A.6.1 La avería principal: el escaneo grande no escribe historia

El escaneo que analiza el universo estadounidense completo **cada madrugada** no es
ninguna de las tres rutas. Es [scripts/scan-universe.mjs](../scripts/scan-universe.mjs)
vía GitHub Actions ([.github/workflows/scan-universe.yml](../.github/workflows/scan-universe.yml),
03:00 UTC), y guarda el scan pero **descarta `result.history`**:

```js
// scripts/scan-universe.mjs:350,378
const { runMaterializedScan, writeMaterializedScan } = await import("@/lib/materializedScanner.js");
...
const savedScan = await writeMaterializedScan(result.scan);
// (no existe ninguna referencia a writeScanSymbolHistory en el archivo) [CÓDIGO]
```

Sus corridas existen y son enormes comparadas con el histórico [MEDIDO, tabla `scans`]:

```
materialized:US:2026-08-16:o0:l5609  row_count 3313  (population.analyzed: 5609)
materialized:US:2026-08-15:o0:l5609  row_count 3314  (population.analyzed: 5609)
materialized:US:2026-08-14:o0:l5608  row_count 62    (pre light-rows)
materialized:US:2026-08-13:o0:l5608  row_count 75
materialized:US:2026-08-12:o0:l5608  row_count 75
```

Desde el 15-08 (light rows del ADR de universo precalculado) cada nocturno guarda en
`scan_results` las ~3.313 filas que llegan al filtro, con `weeklyStageState`,
`distance52w` y `rsGlobalPct` incluidos en las ligeras
([lib/scanLightProjection.js:59-121](../lib/scanLightProjection.js:59)) — y la retención
del workflow conserva los últimos 7 nocturnos. **Los deltas del universo US existen: en
`scans`/`scan_results`, no en `scan_symbol_history`.**

El escaneo manual del usuario (filas `server-scan-*` en `scans`, vía
[lib/serverScanRunner.js](../lib/serverScanRunner.js)) tampoco escribe historia [CÓDIGO:
el grep de las tres rutas].

## A.6.2 La segunda avería: todas las corridas europeas del cron fallan la escritura

`provider_runs` registra el resultado de cada corrida. Filtrando
`stats->history->>saved = false` [MEDIDO]:

```
(sin grupo)        n=1  2026-07-29           error: Could not find the function public.scan_symbol_history_latest_v1  (despliegue a medias, resuelto)
europe-priority    n=3  2026-07-31→2026-08-14 error: new row ... violates check constraint "scan_symbol_history_out_of_universe_shape"
europe-secondary   n=3  2026-08-01→2026-08-15 error: new row ... violates check constraint "scan_symbol_history_out_of_universe_shape"
```

Seis de seis corridas de los grupos EU1/EU2 del cron nocturno han fallado la escritura
del histórico **desde el estreno de la tabla**. Como todo va en un solo POST, la fila
inválida tumba la corrida entera (por eso `not_in_universe` = 0 filas en la tabla).

**Causa, reproducida en local con el código real** [REPRODUCIDO]: construyendo con
`notInUniverseHistoryObservations` + `selectScanHistoryInserts` una salida de universo,
la fila normalizada sale con `stage_week: 1` y el resto del shape correcto. El culpable
es [lib/scanHistory.js:94](../lib/scanHistory.js:94):

```js
stage_week: Number.isFinite(Number(row.stage_week)) ? Math.max(1, Math.round(Number(row.stage_week))) : null,
```

`Number(null)` es `0`, `Number.isFinite(0)` es `true`, `Math.max(1, 0)` es `1`: toda
observación con `stage_week: null` se normaliza a `1`. Las filas de ausencia llevan
`stage_week: null` por contrato ([lib/scanHistory.js:134-157](../lib/scanHistory.js:134))
y el check las rechaza. El mismo defecto convierte en `1` el `stage_week` null de
cualquier observación normal (el 100% de `stage_week` con valor en A.6 hay que leerlo con
esa sospecha).

## A.6.3 La tercera limitación: EEUU entra 1 noche de cada 7, con cuentagotas

El cron de las 22:20 rota 7 grupos ([lib/cronPlan.js:21-67](../lib/cronPlan.js:21):
`core-us-hk-au`, `europe-priority`, `europe-secondary`, `asia-japan`, `asia-taiwan`,
`north-america-canada`, `asia-singapore-africa`) con `limit ≤ 80` y `perMarket ≤ 25`
([app/api/cron/scan-refresh/route.js:180-181](../app/api/cron/scan-refresh/route.js:180)).
El grupo con US corre una noche de cada siete y aporta ~12-24 símbolos [MEDIDO:
provider_runs, p. ej. `core-us-hk-au 2026-08-13: saved 12`]. De ahí las 13 filas US.

## A.7 ¿Permite responder «qué cambió esta semana»?

**El mecanismo, sí**: `weekly_anchor` garantiza una fila por símbolo y semana, así que
«estado en la semana N» vs «estado en la semana N-1» es reconstruible por diseño, y
`change_reasons` ya nombra el porqué de cada fila. La ventana (anoche, esta semana, este
mes) es una elección del lector, no del esquema.

**Los datos, no** — hoy responde «qué cambió» solo para ~400 símbolos no-US dispersos,
con 31 símbolos con dos semanas comparables. Para que la tabla sirva a la pregunta del
sábado hacen falta, en orden:

1. **El fix de una línea** en `normalizedHistoryRow` (`row.stage_week == null` antes de
   `Number(...)`) más su test — desbloquea las corridas europeas del cron. [Verificado
   como causa; el arreglo es trivial.]
2. **Conectar `scripts/scan-universe.mjs` a `writeScanSymbolHistory`** — el objeto
   `result.history` ya se construye y se tira; es pasarlo, con dos cuidados: la primera
   corrida insertará ~5.600 `first_appearance` (trocear el POST como ya hace
   `writeMaterializedScan` con `WRITE_BATCH_ROWS = 300`,
   [lib/materializedScanner.js:1594](../lib/materializedScanner.js:1594)), y las
   siguientes escribirán del orden de cientos de filas/noche (anclas semanales
   repartidas + cambios reales — ver B).
3. Con 1+2, la tabla acumula: en 2-3 semanas hay ventanas semanales reales del universo
   completo.

**Mientras tanto no hay que esperar**: `scans`/`scan_results` ya retiene 7 nocturnos US
completos, y un join por símbolo entre dos de ellos responde «qué cambió» exacto (así
están medidos los números de la Parte B). La decisión tomada —comparar con el escaneo
anterior— es implementable hoy con esa fuente; `scan_symbol_history` es la memoria larga
(ventanas de más de 7 días, y el porqué de cada cambio) cuando 1+2 estén.

---

# PARTE B — Qué se considera un cambio

## B.0 Cómo se ha medido

Cuatro fuentes, cada una con lo que puede y no puede decir:

- **Par de nocturnos completos 15→16 ago** [MEDIDO]: join por símbolo de 3.312 pares
  sobre `scan_results` (`select=symbol,metrics->>weeklyStageState,metrics->>distance52w,
  metrics->>rsGlobalPct` por `scan_id`). Entre ambos NO hay sesión de mercado (madrugadas
  de sábado y domingo): mide el **ruido del pipeline**, no el mercado.
- **Reconstrucción con barras reales** [MEDIDO sobre muestra + ESTIMADO al extrapolar]:
  muestra determinista de 300 símbolos del scan del 16-08 (hash md5, sin sesgo
  direccional), 298 con ≥260 barras en `daily_bars` (profundidad típica: enero 2025 →
  14-08-2026). Para cada uno, la etapa semanal con el clasificador real del producto
  (`weeklyStageForBars`, [lib/weeklyStage.js:139](../lib/weeklyStage.js:139)) en 9 cortes
  de viernes (19-jun → 14-ago), y los nuevos máximos de 52 semanas con la definición del
  escáner (`highDist`/`hiLo`,
  [lib/materializedScanner.js:152-170](../lib/materializedScanner.js:152): high de hoy
  contra el máximo de los `high` de las 252 barras previas; close efectivo
  `adj_close ?? close` como [lib/dailyBarsCache.js:88](../lib/dailyBarsCache.js:88)).
  Factor de extrapolación al universo analizable: 3.313/298 = ×11,1.
- **RS semanal canónico** [MEDIDO]: `rs_weekly_items`, motor
  `statsedge-us-equity-rs-v1`, un snapshot por semana (el último de cada `week_key`),
  ~4.860 filas/semana, 3.920-3.938 pares emparejables entre semanas consecutivas
  (W30@24-jul → W31@31-jul → W32@09-ago). Es el RS de la columna del screener
  (el semanal, no el `rsGlobalPct` del scan, cuyo `percentileScope` batch/final no he
  auditado aquí).
- **El histórico actual** (552 filas, A.6): anécdota confirmatoria, no medida — su
  cobertura no da para tasas.

## B.8 Los tres candidatos, con números

### 1. Entradas y salidas de etapa 2

Semana a semana (muestra de 298, extrapolación ×11,1 → universo de 3.313) [MEDIDO+ESTIMADO]:

| Semana (cierre viernes) | IN muestra | OUT muestra | IN ≈universo | OUT ≈universo |
|---|---|---|---|---|
| 26-jun | 24 | 14 | 267 | 156 |
| 03-jul | 10 | 15 | 111 | 167 |
| 10-jul | 14 | 13 | 156 | 145 |
| 17-jul | 13 | 16 | 145 | 178 |
| 24-jul | 9 | 17 | 100 | 189 |
| 31-jul | 13 | 20 | 145 | 222 |
| 07-ago | 22 | 15 | 245 | 167 |
| **14-ago** | **21** | **13** | **≈233** | **≈145** |

Ocho semanas: IN entre 100 y 267, OUT entre 145 y 222; nunca cero, nunca un orden de
magnitud arriba o abajo. Error muestral (binomial, IC95): la cifra semanal extrapolada
lleva un ±40-50% relativo (p. ej. IN del 14-ago: ≈150-350) — suficiente para diseñar,
insuficiente para publicar como exacta (en producto será un conteo exacto del join, sin
extrapolación).

Noche a noche: entre el 15 y el 16 (sin sesión), **2 cambios de etapa en 3.312 pares, y
cero que toquen etapa 2** [MEDIDO] — el pipeline no fabrica transiciones cuando el
mercado no abre. Con sesión, la media aritmética sería ~150/5 ≈ 30 por noche [ESTIMADO
por división; no medido: el primer par de nocturnos completos con sesión entre medias
será el del martes 18], pero concentradas: la etapa es una clasificación sobre **velas
semanales** ([lib/weeklyStage.js:39-52](../lib/weeklyStage.js:39) construye semanas desde
las barras diarias), así que la vela de la semana en curso muta hasta el viernes y la
transición «se confirma» sobre todo al cerrar la semana. Consecuencia de diseño: para
etapa, la comparación honesta es **semana cerrada contra semana cerrada**; el delta
nocturno intra-semana es provisional por construcción.

**Veredicto: PASA.** Volumen con sentido semanal (decenas-cientos), estable, y es LA
transición de la metodología (razón de compra/venta de contexto en Weinstein).

### 2. Nuevos máximos de 52 semanas

Reconstrucción diaria (muestra → ≈universo) [MEDIDO+ESTIMADO], últimas 15 sesiones:
2-19 símbolos/día en muestra → ≈22-211/día; días típicos 9-14 → ≈100-156. Por semana
(símbolos distintos que marcaron ≥1 máximo):

| Semana | Muestra | ≈Universo |
|---|---|---|
| 26-jun | 51 | 567 |
| 03-jul | 47 | 523 |
| 10-jul | 37 | 411 |
| 17-jul | 45 | 500 |
| 24-jul | 13 | 145 |
| 31-jul | 29 | 322 |
| 07-ago | 36 | 400 |
| **14-ago** | **31** | **≈345** |

Contexto de stock [MEDIDO, scan 16-08]: 721 valores a ≤5% de su máximo de 52s, 166 a
≤1%. El flujo semanal (≈145-570) es coherente con un mercado cerca de máximos.

Nunca cero, varía ×3,9 entre la mejor y la peor semana — más volátil que la etapa, pero
dentro del mismo orden de magnitud. En el par sin sesión 15→16: 2 cruces a ≤1% [MEDIDO]
(ruido de recálculo, despreciable).

**Veredicto: PASA**, con una salvedad de fuente: `scan_symbol_history` **no guarda**
ninguna forma de distancia al máximo — hoy este delta solo puede salir de
`scan_results.metrics->distance52w` (join de dos scans) o de `daily_bars`. Si se quiere
en la memoria larga, hay que añadir `distance_52w` (o `high_52w`) a la tabla y una razón
`new_high_52w` al decisor — cambio aditivo, mismo patrón que los campos existentes.

### 3. Saltos «grandes» de RS

Distribución real del Δ semanal del RS canónico (pares de símbolos entre snapshots
consecutivos) [MEDIDO]:

| Par | pares | p50 | p90 | p95 | p99 | max | >5 | >10 | >15 | >20 | >30 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| W30→W31 | 3.938 | 3 | 11 | 15 | 27 | 59 | 1.131 (28,7%) | 434 (11,0%) | 191 (4,9%) | 94 (2,4%) | 20 (0,5%) |
| W31→W32 | 3.920 | 4 | 14 | 21 | 36 | 66 | 1.399 (35,7%) | 638 (16,3%) | 332 (8,5%) | 208 (5,3%) | 73 (1,9%) |

Con datos, «grande» no puede ser el `> 5` que usa el decisor del histórico
([lib/scanHistory.js:58](../lib/scanHistory.js:58)): a escala semanal lo supera un
tercio del universo. Es un umbral razonable para «merece fila en el histórico» entre
observaciones próximas (entre corridas sin sesión el p99 del |Δ| de `rsGlobalPct` es 1
[MEDIDO, par 15→16]), pero no separa nada una semana después. Para que un salto sea
resumen habría que irse a |Δ| ≥ 20 (94-208/semana) o ≥ 30 (20-73/semana) — y entre esas
dos semanas el conteo varió ×2,2 y ×3,6 respectivamente.

**Veredicto: NO PASA como cifra del resumen** — cualquier umbral o es ruidoso o es
inestable entre semanas. El salto individual sí vale **en el detalle** (lista ordenada
por |Δ|, sin umbral). Y hay una reformulación del mismo dato que sí tiene forma de
resumen — B.10.

## B.9 La prueba de estabilidad, en una tabla

| Métrica | Noche típica (con sesión) | Semana típica | Rango 8 semanas | ¿Casi nunca cambia? | ¿Demasiado volátil? | Resumen |
|---|---|---|---|---|---|---|
| IN etapa 2 | ~30 [ESTIMADO] | ≈100-270 [MEDIDO×] | ×2,7 | no | no | **sí** |
| OUT etapa 2 | ~30 [ESTIMADO] | ≈145-220 [MEDIDO×] | ×1,5 | no | no | **sí** |
| Nuevos máx. 52s | ≈20-210 [MEDIDO×] | ≈145-570 [MEDIDO×] | ×3,9 | no | al límite, tolerable | **sí** |
| RS \|Δ\|>5 | (p99 sin sesión = 1) | 1.131-1.399 | — | no | es ruido | no |
| RS \|Δ\|≥20/≥30 | — | 94-208 / 20-73 | ×2,2 / ×3,6 | no | sí | no |
| Cruces RS≥80 (B.10) | — | 23 / 38 | ×1,65 | no | no | **sí** |

[MEDIDO×] = medido sobre muestra y extrapolado (el producto contará exacto).

## B.10 ¿Hay un cambio más útil que estos tres?

Pensando en qué hace un operador de tendencia un sábado por la mañana — repasa el
contexto general, busca incorporaciones nuevas al grupo de líderes, y revisa si algo de
lo suyo se ha deteriorado:

1. **Cruces del umbral RS 80** (la reformulación del candidato 3): «entró en RS≥80» /
   «salió de RS≥80». Medido [MEDIDO]: 23 y 38 entradas por semana (W30→W31, W31→W32),
   20 y 32 salidas; cruces de 90: 15 y 17. Tamaño perfecto para una cifra de resumen,
   estable (×1,65), y con significado directo en la metodología (el corte clásico de
   líderes que el usuario ya usa como filtro). Es además un **estado**, no una
   distancia: inmune al problema del umbral de «salto». Propuesto para la línea.
2. **El cambio de régimen de mercado** (lo primero que mira Weinstein). Hoy no es
   materializable: `scans.market_score` es null y `market_regime` vale `"batch-cache"`
   en todos los nocturnos [MEDIDO] — el régimen vive en /market-health y no se persiste
   por scan. Deseable para v2 si el régimen se materializa con el nocturno; no lo
   propongo para v1 porque no hay dato que lo respalde (principio 3).
3. **«Tus vigilados cambiaron»** (la capa personal): favoritos en nube = 4 [MEDIDO];
   las resoluciones (Candidata/Vigilar/Descartar) viven en localStorage. La mecánica es
   trivial una vez existe el delta general (intersección de listas), pero no puede ser
   la promesa central con 4 favoritos. En la línea solo si ese día hay intersección
   («· 2 vigilados entre ellos»), nunca como hueco fijo vacío.
4. **Incorporaciones y salidas del universo**: churn de composición 15→16 = 1+2 símbolos
   [MEDIDO]. Volumen de resumen correcto, pero su causa dominante hoy es cobertura de
   datos, no mercado (el churn semanal del snapshot RS es ~19% [MEDIDO: 3.920 pares de
   ~4.860]); mostrarlo como «cambio» enseñaría averías de proveedor. Descartado hasta
   que la cobertura sea estable.

---

# PARTE C — El resumen

## C.11 La línea, exactamente

Con los números reales de la última semana completa (cierre viernes 14-ago; cifras hoy
extrapoladas — en producto, conteos exactos del join):

> **Desde el vie 7 ago** · Etapa 2: **233 entradas**, 145 salidas · **38** valores
> cruzaron RS 80 · **345** máximos nuevos de 52 semanas · _ver detalle_

Cómo se leería un martes cualquiera (ventana = escaneo anterior, decisión tomada;
transiciones diarias de etapa marcadas como provisionales — B.8.1):

> **Desde anoche (lun 17)** · 4 entradas provisionales en etapa 2 · 112 máximos nuevos
> de 52 semanas · _ver detalle_

Y el fin de semana sin sesión entre escaneos (el caso de hoy, 15→16 [MEDIDO: 2 cambios
de etapa, 2 cruces de máximo, ruido]):

> **Sin sesión desde el vie 14** · sin cambios que contar · _ver la semana_

Reglas de la línea:

1. **El «desde cuándo» abre la frase, con día nombrado** («vie 7 ago», «anoche (lun
   17)») — decisión 3. Nada de «desde el último escaneo», que no dice cuándo fue.
2. **Cifras con nombre, jamás agregadas**: nunca «127 cambios» (punto 12). Cada cifra es
   una de las tres métricas de la Parte B, con su palabra («entradas», «cruzaron RS
   80», «máximos nuevos»). Máximo tres grupos de cifras — si algún día hay más
   candidatos, compiten por el sitio, no se apilan.
3. **Vocabulario descriptivo** (principio 1): «entradas en etapa 2», no «oportunidades»;
   «salidas», no «avisos de venta». Los números describen el mercado, no aconsejan.
4. **La población se declara en el detalle** (no en la línea, por espacio): «sobre 3.313
   valores de EEUU con datos suficientes». Mientras Europa no escriba historia ni tenga
   nocturno completo, esto es un resumen del mercado americano y el detalle lo dice
   (principio 3 — nada que el sistema no pueda demostrar).
5. **Cada cifra es clicable** y abre el detalle ya posicionado en su sección (D).

### La ventana: el matiz que la decisión 4 ya contenía

«Comparar con el escaneo anterior» (decisión tomada) tiene un caso degenerado: el sábado
por la mañana el escaneo anterior es el de anoche, y entre viernes-madrugada y
sábado-madrugada no hay sesión — la comparación literal daría «0 cambios» exactamente el
día para el que se construye la pantalla [MEDIDO: par 15→16]. Y la decisión 3 ya dice
que un sábado lo relevante es la semana.

Propuesta que respeta ambas: la ventana por defecto es **desde el último cierre de
semana de mercado completado** — que es «un escaneo anterior» concreto (el nocturno del
sábado, con las barras del viernes) y existe en la retención de 7. En días laborables,
la ventana corta («desde anoche») convive como alternativa; la etiqueta siempre dice
cuál está activa. Implementación: elegir como ancla el scan `materialized:US:*` más
reciente cuya fecha de barras (`data_as_of`/viernes) sea de la semana anterior.

## C.12 Un número agregado sin desglose es ruido

Cumplido por construcción: la línea no contiene ningún total. Tres métricas con nombre,
cada una con su cifra y su click. La versión «127 cambios desde el viernes» queda
explícitamente prohibida en este diseño — es la contradicción de Research desk («24
eventos · sin comparativo previo · 273 MEJORAS») que el análisis del 15-08 documentó
como pérdida de confianza, no como información.

## C.13 Dónde va, y cómo no compite con la tabla

En la cabecera del screener que ya existe —
[ScreenerShell.jsx:264-274](../app/components/screener/ScreenerShell.jsx:264): el
`screenerHeroBar` tiene un `screenerEyebrow`, el `title` y un `<p>` de subtítulo
(`{preset} · {N} mercados · {N} resultados visibles`). La línea de cambios va como
segunda línea de ese mismo bloque, debajo del subtítulo:

- **Misma jerarquía tipográfica que el subtítulo** (secundaria), con las tres cifras en
  peso medio. Un elemento de texto, sin caja, sin fondo, sin icono de alerta: no es un
  aviso, es información. Los avisos de sistema (las franjas de estado) son otra cosa y
  otro color — la línea nunca se mezcla con ellas.
- **No añade columna, ni chip por fila, ni bloque nuevo** entre la cabecera y la tabla:
  el coste vertical es una línea de texto (~20 px). La pantalla se ha pasado semanas
  despejándose (de 15 columnas a 7); esto no la vuelve a cargar.
- **Móvil**: la misma línea, bajo el título en la topbar, antes del buscador — es
  contenido de primera pantalla legítimo (la respuesta a «qué hay de nuevo»), al
  contrario que las franjas de arquitectura que hoy ocupan ese sitio.
- Cuando el detalle está abierto (D), la línea actúa de título del panel.

## C — la evaluación pedida: ¿comparar con «tu última visita»?

Evaluación (decisión 4 pide evaluarlo y no implementarlo sin consultar):

- **A favor**: es la pregunta literal del usuario semanal («desde que YO miré»), no una
  aproximación. El coste técnico es pequeño: un timestamp de última visita (localStorage,
  patrón ya usado por la sesión) y elegir como ancla el nocturno más cercano anterior a
  esa fecha.
- **En contra, hoy**: (a) con la retención de 7 nocturnos, solo funciona si el usuario
  visita al menos una vez por semana — si vuelve a los 10 días, el ancla ya no existe y
  hay que degradar a «última semana» explicándolo; (b) con `scan_symbol_history` aún sin
  poblar, no hay red de seguridad para ventanas largas; (c) es un segundo concepto de
  ventana que convive con «desde el viernes» — más superficie de explicación en una v1
  que aún no ha enseñado la básica.
- **Recomendación**: v2, tras los prerrequisitos de A.7 (con la tabla poblada, el ancla
  «tu última visita» se resuelve contra el histórico change-only para cualquier
  antigüedad, sin depender de la retención de 7). La v1 con «desde el vie 7 ago»
  nombrado ya responde el 90% del caso — el usuario semanal visita, precisamente,
  una vez por semana.

---

# PARTE D — El detalle

## D.14 Qué se ve al abrir

Un panel con las mismas tres secciones que la línea, en el mismo orden, cada una con su
cifra y su lista:

```
Cambios desde el vie 7 ago                       sobre 3.313 valores · EEUU
─ Etapa 2 — 233 entradas · 145 salidas ────────────────────────────────
   [≡] NVDA   Nvidia · Semiconductores      base → etapa 2 · RS 94 · a 2% del máx.
   [≡] BNS    Scotiabank · Banca            base → etapa 2 · RS 81 · a 1% del máx.
   … (orden elegible; por defecto RS desc., criterio visible — principio 1)
─ Cruzaron RS 80 — 38 arriba · 32 abajo ───────────────────────────────
   [≡] ABNB   Airbnb · Consumo             RS 63 → 80 · etapa 2 · a 4% del máx.
─ Máximos de 52 semanas — 345 valores ─────────────────────────────────
   [≡] DDOG   Datadog · Software           máx. el jue 13 · RS 88 · etapa 2
```

Reglas:

- **Cada fila describe la transición, no la acción** (principio 1): «base → etapa 2 ·
  semana del 11 ago», «RS 63 → 80», «máximo el jueves 13». Ni «oportunidad», ni
  «comprar», ni ordenación fija no elegible que señale al primero: el criterio de orden
  está escrito al lado del selector, como en la tabla.
- **La fila es mínima**: ticker con miniatura ([≡] el `chartPreview` que ya viaja en las
  filas ligeras), nombre, tema, la transición con su fecha, y dos datos de contexto (RS
  actual, distancia al máximo). Todo existe ya en `scan_results`; nada nuevo que
  calcular por fila.
- **Click → ficha del valor** (Link SPA con la lista visible como contexto de origen —
  encaja con el raíl universal F9 del análisis de fricción; los deltas son otra «lista»
  más que la ficha puede recorrer con Anterior/Siguiente).
- **La sección vacía se muestra con su cero** («Cruzaron RS 80 — ninguno esta semana»),
  no se oculta: la ausencia es dato (principio 3).
- Vocabulario: cero jerga de taller. Ni «snapshot», ni «delta», ni «change_reasons» —
  «cambios desde el …», «entradas», «salidas».

## D.15 ¿Pantalla propia o desplegable?

**Desplegable (panel anclado a la línea), con URL — no una ruta del menú.**

- **Un paso menos**: lo que exige navegación se usa menos (la razón de la decisión 1 de
  este encargo). El detalle a un click de la línea, en el mismo contexto, sin perder la
  tabla ni el estado de filtros.
- **Sin destino nuevo**: el BottomNav móvil ya carga con Research como cuarto destino
  discutido (análisis interfaz C2); una ruta «Cambios» agravaría el problema que la
  decisión 1 descarta — y un día sin novedades sería una pantalla vacía en el menú,
  el caso que la decisión 1 cita literalmente.
- **Pero enlazable**: el panel se refleja en la URL (p. ej. `/?cambios=semana`) para que
  «mira lo que salió esta semana» sea un link compartible y para que el gesto atrás lo
  cierre. Enlazable sin ser destino: la diferencia entre poder llegar y tener que ir.
- En móvil, el mismo panel a pantalla completa (patrón del modal de filtros existente),
  con las secciones como acordeón.

## D.16 Un día sin novedades

Tres estados, los tres con texto propio (empty states contractuales — política del
Hito 1):

1. **Sin sesión** (fin de semana, festivo): «Sin sesión desde el vie 14 · sin cambios
   que contar — _ver la semana_». La línea no desaparece: sigue siendo el punto de
   entrada a la ventana semanal, que es lo que el usuario de sábado quiere.
2. **Con sesión y sin cambios** (posible en ventanas de un día: 0 entradas, 0 cruces,
   pocos máximos): «Desde anoche: sin entradas ni salidas de etapa 2 · 3 máximos
   nuevos». Cifras a cero escritas, no huecos — que el silencio se lea como medición,
   no como avería.
3. **Sin con qué comparar** (primer escaneo tras un hueco de datos, o ancla fuera de la
   retención): «Aún no hay dos escaneos comparables de esta semana — el resumen vuelve
   el próximo escaneo». Nunca una cifra inventada sobre una base incompleta
   (principio 3); nunca el «24 eventos · sin comparativo previo · 273 MEJORAS» que este
   diseño viene a jubilar.

---

# PARTE E — Lo que no se había planteado

## E.17 Tres observaciones

1. **El detalle no debería ser una segunda tabla: es la misma tabla, filtrada.** El
   producto ya tiene un sistema de filtros que se aplica en cliente al instante
   (`filterAnalyzedRows`) y una tabla de 7 columnas bien pensada. Si «entradas en etapa
   2 esta semana» se materializa como un conjunto de símbolos, el click de la sección
   puede, además de listar en el panel, **aplicar ese conjunto como filtro de la tabla
   principal** («viendo: entradas en etapa 2 desde el vie 7 · quitar»). Se hereda
   gratis: orden global, selector de periodo, tarjetas móviles, exportación, y el flujo
   de revisión. El panel enseña; el filtro deja trabajar. (Y conecta con la mesa de
   vistas de la maqueta A: «cambios de la semana» es una vista más, no un producto
   aparte.)
2. **La miniatura ya es medio delta**: la fila con `chartPreview` enseña la forma de la
   subida — en el panel del detalle, la miniatura hace que «base → etapa 2» se vea sin
   abrir la ficha. Cero coste: el campo ya viaja.
3. **Cuando `scan_symbol_history` esté poblado, el porqué es gratis**: `change_reasons`
   ya nombra el motivo de cada fila. El detalle podrá decir «entró en etapa 2 (confirmado
   en el cierre del vie 14)» sin recomputar nada. Hasta entonces, el join de dos scans
   da el qué sin el porqué — suficiente para v1.

## Nota final de secuencia (para cuando se implemente)

1. Fix del check (`stage_week` null) + test — una línea, desbloquea Europa.
2. `scan-universe.mjs` → `writeScanSymbolHistory` (troceado en tandas) — puebla EEUU.
3. v1 de la superficie sobre el join de nocturnos en `scans`/`scan_results` (no espera
   a 1-2): línea + panel + filtro aplicado, ventana «desde el último cierre semanal».
4. v2 sobre `scan_symbol_history` poblado: ventanas largas, «tu última visita» (si se
   aprueba), el porqué por fila, y los vigilados.

---

# CONFIANZA

| Afirmación | Confianza | Base |
|---|---|---|
| Esquema y semántica change-only de `scan_symbol_history` | Alta | Migración + lib/scanHistory.js citados |
| Solo 3 rutas escriben; el nocturno US y el scan de usuario no escriben | Alta | grep + scripts/scan-universe.mjs:350-378 [CÓDIGO] |
| Contenido real: 552 filas, 398 símbolos, 13 US, 89% first_appearance, 31 símbolos con 2 semanas | Alta | Descarga completa de la tabla [MEDIDO] |
| 6/6 corridas EU del cron fallan la escritura desde el 31-07 | Alta | provider_runs filtrado [MEDIDO] |
| Causa: `stage_week` null → 1 en normalizedHistoryRow viola el check | Alta | Reproducido en local con el código real [REPRODUCIDO] |
| El nocturno US completo existe a diario (5.609 analizados) y guarda 3.31x filas desde el 15-08 | Alta | Tabla scans + population [MEDIDO] |
| Par 15→16 sin sesión: 2 cambios de etapa, p99 ruido RS = 1 | Alta | Join de 3.312 pares [MEDIDO] |
| Tasas semanales: IN etapa 2 ≈100-270, OUT ≈145-220, máximos ≈145-570 | Media-alta el orden de magnitud; ±40-50% la cifra | Muestra 298 con el clasificador real, extrapolada [MEDIDO+ESTIMADO] |
| ~30 transiciones/noche con sesión | Baja-media | División semanal/5, no medido [ESTIMADO] |
| ΔRS semanal: p95 15-21, p99 27-36; >5 = 29-36% de pares; cruces de 80: 23/38 | Alta | rs_weekly_items, un snapshot por semana [MEDIDO] |
| El RS de la columna del screener es el semanal canónico | Alta | lib/scanLightProjection.js:110-121 + attachWeeklyRs [CÓDIGO] |
| market_score/market_regime no materializados en el nocturno | Alta | scans [MEDIDO] |
| Favoritos = 4; resoluciones de usuario en localStorage | Alta / Media | favorites [MEDIDO] / análisis 15-08 no re-verificado |
| Anclaje visual propuesto (screenerHeroBar) | Alta | ScreenerShell.jsx:264-274 [CÓDIGO] |

# LO QUE NO HE VERIFICADO

- **La tasa diaria real de transiciones de etapa con sesión**: el primer par de
  nocturnos completos separados por una sesión será lunes→martes 18-19 ago. La cifra
  «~30/noche» es una división, no una medición.
- **El intervalo de confianza fino de las extrapolaciones ×11,1**: doy binomial
  aproximado; la varianza real entre estratos (sector, capitalización) no está
  estimada. En producto no habrá extrapolación (conteo exacto), así que no bloquea.
- **`percentileScope` (batch vs final) de los `rsGlobalPct` de `scan_results`**: por eso
  el ΔRS se midió sobre `rs_weekly_items` y no sobre el scan. Si el detalle quisiera
  pintar ΔRS del scan, habría que auditarlo antes.
- **El coste del POST inicial de ~5.600 first_appearance** al conectar
  `scan-universe.mjs` (timeout de 8s del rol PostgREST — el troceo a 300 está descrito
  pero no probado para esta tabla).
- **Si `/api/jobs/scan-refresh` (la ruta HTTP que sí escribe historia) la invoca hoy
  algún automatismo**: no encontré ningún workflow ni cron que la llame; no he auditado
  llamadas manuales.
- **El comportamiento del panel/URL propuesto** (`/?cambios=semana`) contra el sistema
  de sesión persistida — es propuesta de diseño, sin prototipo.
- **La semana W33 del RS** (si el snapshot de este fin de semana corre y cuándo): los
  cruces de 80 de «esta semana» en el ejemplo usan el último par disponible (W31→W32).
- **Latencia del join de dos scans en producción** (2×3.313 filas por PostgREST): mis
  lecturas fueron paginadas a 1.000 sin presión de UI; el conteo para la línea puede
  precalcularse en el propio cron nocturno si el join en caliente resultara caro.
- **Gestos y render del panel en móvil real**: fuera de alcance (mismo límite que los
  análisis previos).
