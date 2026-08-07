# Poda de `scan_results` a una fila por símbolo — diseño, migración y verificación

Fecha: 2026-08-07. BASE_SHA: `a61e71d`. Rama: `codex/statsedge-ui-polish`.

Tarea de diseño y preparación. Nada de esto se ejecutó contra producción.
La migración solo se aplicó contra un Postgres 16 efímero **local** creado
para esta verificación (no el harness `test:integration:ephemeral` de
`tests/integration/_ephemeralPostgresHarness.mjs`, que está acoplado al
inventario del Hito 1B; ver nota metodológica en Parte D).

Decisión de producto (dada, no se cuestiona aquí): `scan_results` pasa a
representar el estado actual — una fila por símbolo, la más reciente — en
vez de un registro de cada escaneo ejecutado. Motivos verificados en
[docs/recent-scanned-lectura-2026-08-05.md](recent-scanned-lectura-2026-08-05.md)
(coste de `readRecentlyScannedSymbols`, sin política de retención, filas
duplicadas) y en [docs/adr-replay-historico.md](adr-replay-historico.md)
§9 (el replay histórico se recalcula desde `daily_bars`, no depende de
`scan_results`).

---

## STOP — hallazgo que bloquea producción (leer antes que el resto)

La restricción dura de la tarea dice: *"Si algún consumidor depende de
tener varias filas por símbolo, PÁRATE y repórtalo en vez de romperlo."*
Encontré **tres consumidores reales, alcanzables desde producto, que
dependen de eso**. Los tres viven en `scan_results` porque la tabla hoy
cumple dos funciones que la decisión de producto funde en una:

1. **Estado más reciente por símbolo** (lo que `readRecentlyScannedSymbols`,
   `leaderboard_publishable_rows` y `discovery` quieren — estos SÍ son
   compatibles con la poda, ver A.2).
2. **El resultado propio, íntegro, de un `scan_id` concreto** — lo que
   consumen los tres hallazgos de abajo, todos anclados a `scan_id`, no a
   símbolo.

### 1. Comparación de snapshots locales (`findCompatiblePreviousScan`)

`app/page.jsx:1509`:
```js
const previousScan = findCompatiblePreviousScan(scans, compatibilityContext);
const enrichedRows = enrichRowsWithMethodology(currentRows, previousScan?.rows || []);
```
`lib/methodologyEngine.js:187-190`:
```js
export function findCompatiblePreviousScan(scans = [], context = {}) {
  const key = snapshotCompatibilityKey(context);
  return (scans || []).find((scan) => scanCompatibilityKey(scan) === key && Array.isArray(scan.rows) && scan.rows.length) || null;
}
```
Esto es **literalmente** "comparar dos escaneos entre sí" (pregunta 3 del
enunciado): busca un scan local anterior compatible y usa sus `rows`
completas para detectar `screening_changed`/`stage_changed`/`rs_*_moved`
respecto al scan actual. Cuando no hay snapshot local (navegador nuevo,
localStorage vacío), el `previousScan` sale de la nube:
`lib/cloudSyncClient.js:250-251`:
```js
export async function getLatestScanFromCloud() {
  return requestJson("/api/scans?includeRows=1&limit=10&rowsLimit=2000");
}
```
que en `app/api/scans/route.js:396-402` hace:
```js
results = await supabaseRequest("scan_results", {
  query: `owner_id=eq.${...}&scan_id=in.(${ids})&select=${resultSelect}&order=rank_index.asc&limit=${rowsLimit}`,
  ...
});
```
— une hasta 10 `scans` distintos por su propio `scan_id`, cada uno con su
propio conjunto de filas. La escritura de este camino
(`app/api/scans/route.js:353-363`, RPC `upsert_scan_newer_wins`) además
purga solo a los 3 scans más recientes por owner (`supabase/schema.sql:197-201`,
comentario citado en B.5), así que en la práctica son como máximo 3
snapshots history-completos los que sobreviven — pero siguen siendo 3
conjuntos de filas por símbolo, no 1.

### 2. Polling de un scan interactivo en curso (`GET /api/scan?id=`)

`app/api/scan/route.js:97-102`:
```js
const results = await supabaseRequest("scan_results", {
  query: `scan_id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(config.ownerId)}&rank_index=gt.${offset}&select=rank_index,raw&order=rank_index.asc&limit=${limit}`,
});
```
Pagina por `rank_index` **dentro de un `scan_id`** mientras el escaneo
interactivo (`lib/serverScanRunner.js`) sigue insertando lotes de 50. Si
otra escritura (el cron u otro scan interactivo) tocara el mismo símbolo
mientras este scan está en curso, la fila cambiaría de `scan_id` bajo los
pies del polling.

### 3. Las RPC de finalización de percentiles, ancladas a `scan_id`

`supabase/migrations/20260710184308_scan_finalize_sector_composite_inputs.sql`
(`scan_finalize_inputs`, filtro literal):
```sql
from public.scan_results as sr
where sr.owner_id = p_owner_id
  and sr.scan_id = p_scan_id
```
`supabase/schema.sql:337-344` (`finalize_scan_results`, UPDATE literal):
```sql
update public.scan_results as sr
set metrics = sr.metrics || src.metrics_patch
from source as src
where sr.id = src.id
  and sr.scan_id = p_scan_id
  and sr.owner_id = p_owner_id
```
`lib/scanPercentileFinalization.js` orquesta ambas
(`finalizeScanResultsInDb`, líneas 225-277): carga las filas del scan por
`scan_id`, recalcula percentiles sobre esa población, y aplica el patch
también filtrado por `scan_id`. Si una fila de ese scan cambia de `scan_id`
entre la lectura (`scan_finalize_inputs`) y la escritura
(`finalize_scan_results`) — porque otro escritor la upsertea primero —, el
patch de esa fila **no se aplica y no da error**: `updated_count` sale más
bajo, en silencio. Con un índice único `(owner_id, symbol)` tabla-completa,
además, cualquier escritor que siga haciendo `INSERT` liso (los dos de
abajo) empieza a fallar directamente.

### Consecuencia técnica verificada: un índice único tabla-completa rompe los otros dos escritores con error duro

Los dos escritores que **no** se tocan en este cambio (`serverScanRunner.js`
y la RPC `upsert_scan_newer_wins`) hacen `INSERT` sin `ON CONFLICT`. Lo
comprobé contra el Postgres efímero local, con la migración de la Parte C
ya aplicada:
```
=== simulando el INSERT liso que hace hoy lib/serverScanRunner.js (sin ON CONFLICT) contra un simbolo ya existente ===
ERROR:  duplicate key value violates unique constraint "scan_results_owner_symbol_unique_idx"
DETALLE:  Key (owner_id, symbol)=(personal, AAPL) already exists.
```
En cuanto el índice único esté en producción, `POST /api/scan` (escaneo
interactivo) y `POST /api/scans` (sync de snapshots locales) empezarían a
fallar con `23505` la primera vez que intentaran guardar un símbolo que ya
tenga fila de cualquier origen — algo que pasa casi de inmediato dado el
solape de universos entre cron e interactivo.

### Qué hago con esto en el resto del documento

No decido por mi cuenta. Entrego exactamente lo que pide la tarea —
migración (Parte C) y verificación local (Parte D) — porque es información
real que el dueño necesita para decidir, y la restricción dura solo prohíbe
ejecutarlo contra producción, no diseñarlo. El **código de escritura que
cambio es solo el del cron** (`writeMaterializedScan`,
`lib/materializedScanner.js`), que no usa ninguna RPC ni depende de
`scan_id` como identidad — es el único de los tres escritores para el que
la poda es segura sin tocar nada más. `serverScanRunner.js` y
`upsert_scan_newer_wins` quedan sin tocar, tal como pide la restricción, y
la migración documenta en su cabecera por qué aplicarla tal cual rompería
esos dos caminos.

---

## PARTE A — Qué se pierde exactamente

### A.1 — Cuántas filas hay hoy y cuántas quedarían

**Limitación de herramienta, ya documentada el mismo día en el documento
hermano** (`docs/recent-scanned-lectura-2026-08-05.md` Parte B.1): la clave
de solo lectura rechaza funciones agregadas (`select=count()` →
`PGRST123`) y la herramienta MCP disponible aquí no expone `offset`, así
que no hay un conteo exacto posible sin acceso admin. Repito aquí una
verificación propia, con consultas nuevas, acotadas por fecha como exige el
aviso de la tarea.

**Muestra 1** — consulta exacta:
```
table=scan_results, select=symbol,created_at,
filter=owner_id=eq.personal, order=created_at.desc, limit=200
```
200 filas, del 2026-08-06T23:06 al 2026-07-29T23:13 (8 días).

**Muestra 2** — mismo filtro, cursor `created_at=lt.2026-07-29T23:13:40.515686Z`,
`limit=200`. 200 filas más, hasta 2026-07-19T23:04 (18 días acumulados en
total entre ambas).

Deduplicando las 400 filas combinadas por símbolo (script Node sobre el
JSON de ambas respuestas):
```
total rows: 400
distinct symbols: 313
dup ratio: 1.278
symbols with >1 occurrence: 57 — extra rows from dups: 87
top: AAPL×6, GOOGL×5, MSFT×5, NVDA×5, AMZN×5, META×5,
     ALLEI.ST×4, APOTEA.ST×4, AQ.ST×4, AALB.AS×3, ACOMO.AS×3,
     BEWI.OL×3, AENA.MC×3, ASKER.ST×3, ADYEN.AS×2
```
Es decir: en esta ventana reciente de 18 días, **~22% de las filas
(87 de 400) desaparecerían** con la poda. El patrón es doble: seis
megacaps (AAPL/GOOGL/MSFT/NVDA/AMZN/META) de pruebas manuales repetidas en
horas, y un grupo nórdico (ALLEI.ST, APOTEA.ST, AQ.ST, ASKER.ST, BEWI.OL...)
que el cron reescanea cada 4-8 días por rotación de grupo — exactamente el
mismo patrón que documentó
`docs/recent-scanned-lectura-2026-08-05.md` B.4 para la ventana de 90 días.

Esta muestra de 18 días **no** incluye el batch masivo de pruebas del
2026-07-15 (cientos de tickers alfabéticamente densos, ver el documento
hermano B.1) que sí cae dentro de la ventana de 90 días que usa
`readRecentlyScannedSymbols`. Ese batch, al ser mayormente tickers
distintos entre sí (no repetidos), apenas se reduciría con la poda — así
que la proporción de filas borradas sobre el total de 90 días es **menor**
que el 22% medido aquí, no mayor. Con el hallazgo ya establecido de que la
ventana de 90 días tiene entre ~4001 y el tope de 5000 filas (mismo
documento, B.1, evidencia por paginación de 5 páginas), una estimación
razonada — no un conteo exacto — es que la poda completa de la tabla
borraría del orden de **800 a 1500 filas** sobre esa base de ~4000-5000,
sin contar histórico anterior a 90 días (no medido, ver "LO QUE NO HE
VERIFICADO").

### A.2 — ¿Alguien lee más de una fila por símbolo?

Tracé todos los consumidores de `scan_results` (`grep -rn "scan_results"`
sobre `lib/` y `app/`, filtrando tests):

| Consumidor | Lee por | ¿Depende de histórico multi-fila? |
|---|---|---|
| `readRecentlyScannedSymbols` (`lib/materializedScanner.js:1132`) | ventana `created_at`, dedup en JS quedándose con la primera (más reciente) | **No** — ya asume "última por símbolo"; es la función que motivó toda esta tarea (docs/recent-scanned-lectura-2026-08-05.md) |
| `readScanRows` (`lib/leaderboards.js:713`) → RPC `leaderboard_publishable_rows` | ventana `created_at` + `parent_status` del scan padre, **sin dedup en SQL** | Parcialmente — pero `buildLeaderboard`/`buildGroupedLeaderboards` deduplican en JS inmediatamente después (`dedupeRows`, `lib/leaderboards.js:542-557`, quedándose con `sourceScanCreatedAt` más reciente) — compatible con la poda |
| `/api/discovery` (`lib/discovery.js`) | consume `readScanRows` y vuelve a deduplicar (`dedupeDiscoveryRows`, `lib/discovery.js:77-99`, por score más alto) | **No** — doble dedup ya presente |
| Finalización de percentiles (`lib/scanPercentileFinalization.js` + RPC `scan_finalize_inputs`/`finalize_scan_results`) | estrictamente por `scan_id` | **Sí** — ver STOP #3 |
| `GET /api/scans` (`app/api/scans/route.js:396-402`) — sync de snapshots locales | `scan_id in (...)` de hasta `limit` scans (10 o 50 según caller) | **Sí** — ver STOP #1 |
| `GET /api/scan?id=` (`app/api/scan/route.js:97-102`) — polling interactivo | `scan_id` único + `rank_index` | **Sí** — ver STOP #2 |
| `app/api/comparables/route.js:66-77` | `scan_id in (...)` de hasta 12 scans recientes (`row_count>=20`) | Parcial/no verificado a fondo — no encontré dedup explícito por símbolo en `lib/comparables.js`; el propósito real ("comparables del mismo sector/tema") probablemente tolera ver el mismo símbolo repetido desde distintos `scan_id`, pero no lo confirmé con una lectura completa de `normalizeComparableResult` — ver "LO QUE NO HE VERIFICADO" |
| `app/api/company-brief/route.js:817-829` (`readUniverseRsSnapshot`) | `symbol=eq.X&order=created_at.desc&limit=1` | **No** — ya lee "última por símbolo" explícitamente |
| `scan_coverage_breakdown` RPC (`app/api/scan-coverage/route.js`) | `supabase/migrations/20260710104227_scan_coverage_breakdown.sql:98`, `select distinct on (s.symbol)` | **No** — ya dedupea en SQL |

### A.3 — ¿Hay algún sitio que compare dos escaneos entre sí?

**Sí — ver STOP #1.** `app/page.jsx:1498-1538` guarda cada snapshot local
con un bloque `comparison: { compatiblePrevious, previousScanId,
previousScanDate }` explícitamente pensado para esto, y
`findCompatiblePreviousScan` + `enrichRowsWithMethodology` son el motor de
esa comparación. Se rompería con la poda tal como está escrita.

### A.4 — ¿`scan_symbol_history` cubre lo que se perdería?

**No, es un reemplazo parcial, no un superset.** DDL completo en
`supabase/migrations/20260729130755_scan_symbol_history.sql:7-40`. Tiene:
`owner_id, symbol, mic_code, observed_at, observed_week, data_as_of,
source_scan_id, source_pipeline, stage, stage_week, rs_global,
rs_benchmark, rs_country, rs_sector, composite_score, composite_coverage,
composite_partial, scoring_engine_version, data_provider, passed_screen,
absence_reason, absence_detail, change_reasons`.

**No tiene**: ningún campo de verdicto/patrón VCP (`setupVerdictKey`,
`setupDisplayPlanValid`, `setupDisplayWatch`, `setupQualityScore`,
`patternFamily`, etc. — la lista completa que consume
`latestScanStateFromRow`, citada en `docs/recent-scanned-lectura-2026-08-05.md`
A.1), ni `metrics`/`raw` completos, ni `total_score`/`weinstein_score`/
`minervini_score`/`risk_score` (usa en su lugar `composite_score`, que no
es el mismo cálculo). `findCompatiblePreviousScan`/`enrichRowsWithMethodology`
necesitan las filas de research completas (`scan.rows`), no este resumen —
no son intercambiables sin reescribir el motor de comparación.

Además es **aditiva por diseño**
(comentario propio: "no altera ni referencia con FK a scans, scan_results o
daily_bars [...] porque scans aplica una retención destructiva de los
últimos N scans") y **change-only**: solo inserta cuando algo cambió
(`lib/scanHistory.js`, no auditado en profundidad aquí), así que para un
símbolo repetidamente escaneado sin cambios, no tiene una fila por cada
escaneo — esto la hace estructuralmente más barata que `scan_results`, pero
no la hace un sustituto de la comparación de snapshots completos.

---

## PARTE B — Cómo se escribe hoy

### B.5 — Código de escritura, los dos caminos

**Camino cron** (`writeMaterializedScan`, `lib/materializedScanner.js`,
estado ANTES de mi cambio — ver Parte C para el después):
```js
// lib/materializedScanner.js:1663-1673 (antes del cambio de esta tarea)
await supabaseRequest("scan_results", {
  method: "DELETE",
  query: `scan_id=eq.${encodeURIComponent(saved.id)}`,
});
for (let i = 0; i < rows.length; i += 300) {
  await supabaseRequest("scan_results", {
    method: "POST",
    prefer: "return=minimal",
    body: rows.slice(i, i + 300).map((row, offset) => scanResultPayload(row, saved.id, config.ownerId, i + offset, scan.settings || {})),
  });
}
```
Borra por `scan_id` (el de ESTA invocación, recién creado) e inserta liso.
Nunca toca filas de invocaciones anteriores — por eso la tabla crece sin
límite (ya documentado en el hermano, B.2).

**Camino interactivo** (`lib/serverScanRunner.js:198-243`):
```js
await supabaseRequest("scan_results", {
  method: "DELETE",
  query: `scan_id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(ownerId)}&rank_index=gt.${state.insertedCount}`,
});
...
await supabaseRequest("scan_results", {
  method: "POST",
  prefer: "return=minimal",
  body: batch.map((row, index) => resultPayload(row, scanId, ownerId, state.insertedCount + index + 1, settings)),
});
```
Borra solo las filas de resume "huérfanas" (más allá del último
`row_count` persistido, dentro del MISMO `scan_id`) e inserta liso en lotes
de 50. Insert puro, sin `ON CONFLICT`.

**Camino de sync de snapshots locales** (RPC `upsert_scan_newer_wins`,
`supabase/schema.sql:140-193`, invocada desde `app/api/scans/route.js:353-363`):
```sql
delete from public.scan_results where scan_id = v_scan_id;
insert into public.scan_results (...) select ... from jsonb_to_recordset(...) ...
```
Borra por `scan_id` y reinserta — el mismo patrón que el cron pero dentro
de una función PL/pgSQL, con purga adicional de retención (conserva solo
los 3 scans más recientes por `owner_id`, `supabase/schema.sql:197-201`).

**Ninguno de los tres usa upsert por símbolo hoy.** Los tres hacen
`DELETE` (acotado a un `scan_id`) + `INSERT` liso.

### B.6 — Restricción de unicidad actual

**Ninguna, salvo la PK.** DDL completo, `supabase/schema.sql:24-43`:
```sql
create table if not exists scan_results (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  scan_id uuid not null references scans(id) on delete cascade,
  symbol text not null,
  ...
  created_at timestamptz not null default now()
);
```
No hay ningún `unique(...)` en la tabla. Los índices existentes
(`supabase/schema.sql:1521-1528`) son todos no únicos:
`scan_results_scan_id_idx`, `scan_results_owner_scan_rank_idx`,
`scan_results_symbol_idx (owner_id, symbol)`, `scan_results_owner_created_idx`,
y tres más por sector/industry/theme+created_at. El más parecido a lo que
hace falta, `scan_results_symbol_idx`, es de dos columnas sin
`created_at`, no único — sirve para filtrar por símbolo, no para impedir
duplicados.

### B.7 — Clave única exacta necesaria

**`unique (owner_id, symbol)`.** `scan_id` deja de ser parte de la
identidad de la fila, tal como anticipa el enunciado — y en efecto tiene
que dejar de serlo para que "una fila por símbolo" tenga sentido: hoy cada
`(scan_id, symbol)` es único de facto (cada invocación crea su propio
`scan_id`), así que la única forma de forzar "una fila por símbolo, punto"
es que la clave ya no incluya `scan_id`. `owner_id` sí se mantiene en la
clave porque hay más de un valor posible — hoy en producción, además del
owner de persistencia por defecto (`DEFAULT_OWNER = "personal"`,
`lib/supabaseServer.js`, citado en `docs/adr-hito-1b-diferido.md` §4), la
muestra de A.1 confirma un segundo owner real en la tabla
(`otro_owner` es mi dato de prueba local, pero el propio esquema declara
`owner_id text not null default 'personal'` sin restricción a un único
valor, y el Hito 2 de tenancy (decisión de secuenciación de tenancy,
2026-07-17, ver memoria de proyecto) contempla explícitamente más de un
owner en el futuro). Sin
`owner_id` en la clave, un segundo owner con el mismo símbolo pisaría al
primero.

---

## PARTE C — La migración

### C.8/C.10 — Migración SQL

Archivo: `supabase/migrations/20260807140000_scan_results_latest_per_symbol.sql`.
Cabecera de advertencia (qué borra, cuánto, y el hallazgo STOP) al
principio del archivo, tal como pide la tarea. Cuerpo:
```sql
-- 1. Deduplicar: conservar solo la fila mas reciente (created_at desc,
--    desempate por id desc) por (owner_id, symbol). Idempotente.
delete from public.scan_results as sr
using (
  select id, row_number() over (
    partition by owner_id, symbol order by created_at desc, id desc
  ) as rn
  from public.scan_results
) as ranked
where sr.id = ranked.id and ranked.rn > 1;

-- 2. Restriccion de unicidad, como indice (no ALTER TABLE ADD CONSTRAINT,
--    que no admite IF NOT EXISTS).
create unique index if not exists scan_results_owner_symbol_unique_idx
  on public.scan_results (owner_id, symbol);
```
Sigue la convención de nombres de `supabase/migrations/` (timestamp
`YYYYMMDDHHMMSS_descripción.sql`, el siguiente después de
`20260729130755_scan_symbol_history.sql`). No toca `supabase/schema.sql`
(ver Parte E.15 sobre la consecuencia de esto).

### C.9 — Cambio en el código de escritura

Modifiqué **solo** `writeMaterializedScan`
(`lib/materializedScanner.js:1663-1682` tras el cambio): quité el `DELETE`
por `scan_id` y convertí el `INSERT` en upsert por `(owner_id, symbol)`:
```js
for (let i = 0; i < rows.length; i += 300) {
  const now = new Date().toISOString();
  await supabaseRequest("scan_results", {
    method: "POST",
    query: "on_conflict=owner_id,symbol",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: rows.slice(i, i + 300).map((row, offset) => ({
      ...scanResultPayload(row, saved.id, config.ownerId, i + offset, scan.settings || {}),
      created_at: now,
    })),
  });
}
```
Dos detalles que verifiqué que importan:

- **`created_at` explícito.** `scanResultPayload` no lo incluye (confía en
  el `default now()` de la tabla). PostgREST con
  `resolution=merge-duplicates` solo actualiza, en conflicto, las columnas
  presentes en el payload — sin este fix, una fila reescrita quedaría con
  `total_score`/`metrics` frescos pero `created_at` congelado en su
  primerísimo insert, rompiendo cualquier lectura de frescura
  (`readRecentlyScannedSymbols`, `leaderboard_publishable_rows`,
  `maxPriceFreshnessDays`). Lo puse en la llamada, no dentro de
  `scanResultPayload`, porque esa función es pura y
  `tests/materializedScanProgress.test.js:239-241` la llama dos veces
  seguidas esperando igualdad exacta (`toEqual`) — si el timestamp
  estuviera dentro de la función, la comparación dependería del reloj.
- **`scanResultPayload` no cambió.** Confirmé que su único call site es
  este (`grep -rn "scanResultPayload" lib app` → una sola coincidencia
  fuera de su propia definición), así que no hay efectos colaterales en
  otros consumidores.

**No toqué ninguna RPC.** `serverScanRunner.js` y `upsert_scan_newer_wins`
siguen haciendo `INSERT` liso — tal como pide la tarea ("no la modifiques
todavía: repórtalo"), y el reporte es la sección STOP de arriba.

---

## PARTE D — Verificación en local

Nota metodológica: no usé `npm run test:integration:ephemeral` (el harness
de `tests/integration/_ephemeralPostgresHarness.mjs`) porque esa suite está
acoplada al inventario específico del Hito 1B (`scan_executions`,
`scan_result_sets`, etc., `docs/adr-hito-1b-diferido.md`) y ya tiene 2 de
sus tests en rojo a propósito por ese motivo (§8 del ADR). Para no mezclar
mi verificación con ese ruido, creé una base Postgres 16 local aparte
(`statsedge_scratch_scan_results_migration`, fuera del prefijo
`statsedge_ephemeral_` que reserva el script oficial
`scripts/reset-ephemeral-db.sh`) y la bootstrapeé con
`supabase/schema.sql`, sustituyendo `create extension if not exists
pg_cron;` por el mismo stub local que usa el harness oficial
(`LOCAL_CRON_STUB_SQL`, `tests/integration/_ephemeralPostgresHarness.mjs:78-85`)
porque `pg_cron` no está instalado en este Postgres de Homebrew. La base se
borró al terminar (`dropdb`).

### D.11 — Aplicación contra Postgres efímero local

Bootstrap del schema base (`schema.sql` con el stub de `pg_cron`): `EXIT=0`.
Inserté datos de prueba sintéticos representativos (dos escaneos del mismo
owner con símbolos solapados AAPL/MSFT, uno sin solape GOOGL/NVDA, y un
segundo owner con su propio AAPL) para poder verificar el dedup con datos
conocidos en vez de solo confiar en que "no dio error". Estado antes:
```
  owner_id  | symbol | total_score |               scan_id                
------------+--------+-------------+--------------------------------------
 otro_owner | AAPL   |           5 | 33333333-3333-3333-3333-333333333333
 personal   | AAPL   |          10 | 11111111-1111-1111-1111-111111111111
 personal   | AAPL   |          99 | 22222222-2222-2222-2222-222222222222
 personal   | GOOGL  |          30 | 11111111-1111-1111-1111-111111111111
 personal   | MSFT   |          20 | 11111111-1111-1111-1111-111111111111
 personal   | MSFT   |          88 | 22222222-2222-2222-2222-222222222222
 personal   | NVDA   |          77 | 22222222-2222-2222-2222-222222222222
(7 filas)
```
Aplicación #1, salida literal:
```
=== APLICACION #1 ===
DELETE 2
CREATE INDEX
```
Estado después (conserva el `total_score` más reciente por símbolo: AAPL
queda en 99, no 10; `otro_owner` no se toca):
```
  owner_id  | symbol | total_score |               scan_id                
------------+--------+-------------+--------------------------------------
 otro_owner | AAPL   |           5 | 33333333-3333-3333-3333-333333333333
 personal   | AAPL   |          99 | 22222222-2222-2222-2222-222222222222
 personal   | GOOGL  |          30 | 11111111-1111-1111-1111-111111111111
 personal   | MSFT   |          88 | 22222222-2222-2222-2222-222222222222
 personal   | NVDA   |          77 | 22222222-2222-2222-2222-222222222222
(5 filas)
```

### D.12 — Idempotencia

Segunda aplicación consecutiva, salida literal:
```
=== APLICACION #2 (idempotencia) ===
DELETE 0
psql:supabase/migrations/20260807140000_scan_results_latest_per_symbol.sql:83: NOTICE:  relation "scan_results_owner_symbol_unique_idx" already exists, skipping
CREATE INDEX
EXIT_CODE=0
```
`DELETE 0` (ya no hay grupos con más de una fila), el índice se salta con
un `NOTICE`, sin error, `EXIT_CODE=0`. Confirmado también que el upsert
real funciona como se espera —simulé el `INSERT ... ON CONFLICT (owner_id,
symbol) DO UPDATE` equivalente al `on_conflict=owner_id,symbol` de
PostgREST: actualizó AAPL (99→150) refrescando `created_at`, e insertó
TSLA sin tocar el resto. Y confirmé el hallazgo STOP con evidencia real
(citado arriba): un `INSERT` sin `ON CONFLICT` contra un símbolo existente
falla con `23505 duplicate key value violates unique constraint`.

### D.13 — `npm test` completo

Salida literal:
```
> test
> vitest run

 RUN  v4.1.8 /Users/.../Statsedge-v0.1

(node:10125) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.

 Test Files  96 passed (96)
      Tests  1296 passed | 8 skipped (1304)
   Start at  19:52:09
   Duration  14.49s (transform 6.00s, setup 0ms, import 14.99s, tests 23.75s, environment 13ms)
```
`EXIT=0`. Sin fallos. Verifiqué específicamente que nada en `tests/`
afirma la llamada `DELETE` que quité de `writeMaterializedScan`
(`grep` sobre los archivos que importan `writeMaterializedScan`/
`scanResultPayload` no encontró ninguna aserción sobre `method: "DELETE"`),
y que `tests/materializedScanProgress.test.js:230-247` (la única prueba
que compara dos llamadas a `scanResultPayload` por igualdad exacta) sigue
en verde porque `created_at` no se tocó dentro de esa función.

---

## PARTE E — Qué falta para aplicarla

### E.14 — Pasos para el dueño, en orden

1. **Resolver el hallazgo STOP primero.** Decidir entre (a) aceptar que el
   escaneo interactivo y el sync de snapshots locales dejen de poder
   escribir en `scan_results` en cuanto colisionen con un símbolo ya
   existente (romper esas dos funciones a propósito), (b) rediseñar esos
   dos caminos para que también usen upsert por símbolo — lo que a su vez
   exige rediseñar `finalize_scan_results`/`scan_finalize_inputs` (ya no
   pueden asumir `scan_id` estable) y aceptar perder la comparación de
   snapshots y el polling por `scan_id`, o (c) mover el estado
   "current-per-symbol" que necesita el cron a una tabla nueva, separada
   de `scan_results`, dejando esta última intacta para los tres
   consumidores del STOP. Ninguna de las tres es una decisión de
   ingeniería menor; no la tomo por el dueño.
2. **Backup de `scan_results` antes de nada.** Vía Supabase Dashboard
   (Database → Backups, confirmar que el backup automático cubre el
   momento de aplicar) o `pg_dump --table=public.scan_results` contra la
   `DATABASE_URL` real de producción (que, según memoria de proyecto sobre
   acceso a datos operativo, no es la de `.env.local` — placeholder — sino
   la que expone la Management API de Supabase).
3. **Actualizar `supabase/schema.sql`** para incluir
   `scan_results_owner_symbol_unique_idx`, si se decide seguir adelante —
   ver E.15, hoy la migración diverge de `schema.sql`.
4. Aplicar la migración vía el flujo normal de Supabase (no
   `npm run supabase:schema`, que reaplica el archivo completo — usar el
   mecanismo de migraciones puntual que ya use el proyecto para las demás
   entradas de `supabase/migrations/`).
5. Desplegar el cambio de código (`lib/materializedScanner.js`) en el mismo
   despliegue que la migración, no antes ni después — un desfase entre
   índice único en DB y código sin upsert (o viceversa) causaría errores
   `23505` inmediatos en el cron.
6. Monitorizar el primer ciclo del cron tras el despliegue
   (`app/api/cron/scan-refresh/route.js`) para confirmar que
   `writeMaterializedScan` no está fallando con `23505` — señal de que el
   índice quedó activo pero algún escritor no migrado (interactivo/sync)
   sigue tocando símbolos que el cron también toca.

### E.15 — `REVIEWED_BOOTSTRAP_SOURCE_DIGEST` y el test de paridad de esquema

**Empeora la situación, no es indiferente.** Verifiqué el mecanismo exacto:
`tests/integration/schema-parity.real.test.mjs:48-85` construye dos
catálogos y hace `assert.deepEqual(bootstrapCatalog, migrationCatalog)`
(línea 63) — un catálogo sale de aplicar `supabase/schema.sql` tal cual
(`applyBootstrapProjection`), el otro de aplicar la base + **todos** los
archivos de `supabase/migrations/` posteriores a la fundación, leídos
dinámicamente del directorio (`postFoundationMigrationFiles`,
`tests/integration/_ephemeralPostgresHarness.mjs:874-879`:
`fs.readdirSync(MIGRATIONS_DIR).filter(...).sort()` — sin lista
hardcodeada, recoge cualquier `.sql` nuevo). Confirmé también que
`foundationCatalog()` incluye `indexes` con `pg_get_indexdef`
(`_ephemeralPostgresHarness.mjs:1151-1155`), así que el índice nuevo
**sí** entra en la comparación.

Como mi migración añade `scan_results_owner_symbol_unique_idx` solo en
`supabase/migrations/` y no toqué `supabase/schema.sql`, el catálogo
"migración" tendría ese índice y el catálogo "bootstrap" no —una
divergencia real y nueva, sobre `assert.deepEqual` de todo el catálogo, que
haría fallar la comparación por un motivo **distinto y adicional** al ya
documentado del Hito 1B (`docs/adr-hito-1b-diferido.md` §8). Hoy el test ya
está en rojo por una única causa conocida y aceptada; con esta migración
aplicada seguiría en rojo, pero por dos causas mezcladas, lo que complica a
quien intente resolver la del Hito 1B sin saber que hay una segunda.

**El digest (`REVIEWED_BOOTSTRAP_SOURCE_DIGEST`,
`bootstrap-control.contract.test.mjs`) no se ve afectado por esta
migración**, porque el digest se calcula sobre los bytes de
`supabase/schema.sql`, que no toqué. Si en el paso E.14.3 el dueño decide
sincronizar `schema.sql` con el índice nuevo, entonces sí haría falta
recalcular y revisar el digest a mano (tal como exige su propio contrato),
pero eso es una consecuencia de esa decisión futura, no de esta migración
tal como queda entregada hoy.

La DELETE de deduplicación (paso 1 de la migración) no afecta a ninguno de
los dos tests: opera sobre datos, no sobre el catálogo de esquema que
compara `foundationCatalog()`.

---

## CONFIANZA

- **Alta**: los tres hallazgos STOP (comparación de snapshots locales,
  polling por `scan_id`, RPC de finalización ancladas a `scan_id`) — cada
  uno con cita literal de código y, en el caso de la colisión de escritura,
  reproducido con un error real contra Postgres.
- **Alta**: que `readRecentlyScannedSymbols`, `leaderboard_publishable_rows`
  (vía dedup en JS), `discovery`, `scan_coverage_breakdown` y
  `company-brief` ya son compatibles con "una fila por símbolo" — lectura
  directa de su código de dedup/consulta.
- **Alta**: ausencia total de restricción de unicidad hoy en `scan_results`
  — DDL citado completo, sin ambigüedad.
- **Alta**: la migración es idempotente y el dedup conserva la fila más
  reciente — verificado con datos sintéticos conocidos, dos aplicaciones
  consecutivas, salida literal pegada.
- **Alta**: `npm test` en verde tras el cambio de código — salida literal,
  96/96 archivos, 1296/1296 tests (más 8 skipped preexistentes).
- **Alta**: el impacto en `schema-parity.real.test.mjs` — mecanismo exacto
  leído y verificado (lectura dinámica de `supabase/migrations/`,
  `indexes` sí entra en el catálogo comparado).
- **Media**: el número exacto de filas que se borrarían en producción hoy
  (A.1) — es una estimación razonada a partir de dos muestras reales
  (400 filas, 313 símbolos distintos) y del hallazgo previo de ~4000-5000
  filas totales en la ventana de 90 días, no un conteo exacto (mismo límite
  de herramienta que el documento hermano: sin agregados, sin offset).
- **Media**: que `app/api/comparables/route.js` es un consumidor de bajo
  riesgo — no encontré dedup explícito por símbolo en una lectura rápida de
  `lib/comparables.js`, pero tampoco profundicé en `normalizeComparableResult`
  para confirmar si tolera duplicados por diseño.
- **Baja**: cobertura real de `scan_symbol_history` hoy (cuántos símbolos
  tiene una fila viva) — no la consulté directamente, es una evaluación de
  esquema/código de escritura, no de datos.

## LO QUE NO HE VERIFICADO

- **El conteo exacto de filas hoy y post-poda** (A.1) — limitación de
  herramienta (agregados bloqueados, sin `offset`), no de tiempo. Sería
  resoluble con `execute_sql`/`psql` directo o una clave con permiso de
  agregados.
- **Si `app/api/comparables/route.js` tolera o no filas duplicadas por
  símbolo tras la poda** — no leí `lib/comparables.js` completo ni
  `normalizeComparableResult`/`comparableScore`.
- **La tasa de fallo real de `writeScanSymbolHistory` en producción** y si
  `scan_symbol_history` tiene hoy una fila viva por cada símbolo que
  `scan_results` conoce — no consulté la tabla con datos reales, solo su
  esquema.
- **Si existen más consumidores de `scan_results` fuera de `lib/` y `app/`**
  — no busqué en `scripts/` más allá de lo que ya cita el documento hermano
  (bench-scan-overhead.mjs, no relevante para consumo de producto).
- **El comportamiento exacto de `lib/scanHistory.js`** (qué dispara cada
  `change_reasons`, si cubre razonablemente lo que
  `enrichRowsWithMethodology` detecta) — solo leí su comentario de cabecera
  citado en el documento hermano, no el archivo completo.
- **El efecto de esta migración sobre `scans.row_count`** — tras la poda,
  el `row_count` que guarda cada fila de `scans` (contado en el momento de
  esa invocación) puede dejar de coincidir con las filas de `scan_results`
  que realmente sobreviven bajo ese `scan_id` (porque otro `scan_id`
  posterior pudo robarle símbolos). No medí cuántas filas de `scans`
  quedarían con un `row_count` inconsistente ni si algún consumidor confía
  en esa cifra para algo distinto de telemetría.
- **Producción real**: nada de esto se ejecutó contra Supabase. Toda la
  Parte D es contra un Postgres 16 local, efímero, creado y destruido solo
  para esta verificación.
