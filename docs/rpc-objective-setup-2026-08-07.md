# Análisis — proyectar `objectiveSetupScore` en `scan_finalize_inputs`

- **Estado:** análisis, sin cambios de código.
- **Fecha:** 2026-08-07.
- **Rama:** `codex/statsedge-ui-polish` (HEAD en el momento de escribir esto).
- **Restricción de esta tarea:** ningún archivo modificado salvo este. No se
  ejecutó `npm run supabase:schema`. No se escribió en Supabase.

---

## PARTE A — Qué hace falta en la RPC

### A.1 — `scan_finalize_inputs` completa, con su versión vigente

`scan_finalize_inputs` está definida dos veces en `supabase/migrations/`:

- `supabase/migrations/20260710104230_scan_finalize_inputs.sql:40` — versión
  original.
- `supabase/migrations/20260710184308_scan_finalize_sector_composite_inputs.sql:26`
  — `create or replace function` que la **sustituye por completo** (mismo
  nombre y firma `(text, uuid, integer)`), añadiendo 5 campos
  (`riskScore`, `growthScore`, `demandScore`, `epsGrowthProxyScore`,
  `ipoScore`) al thin-raw. Esta es la versión vigente hoy; cito esta.

```sql
create or replace function public.scan_finalize_inputs(
  p_owner_id text,
  p_scan_id uuid,
  p_max_rows integer default 50000
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with limited as materialized (
  select
    sr.id,
    sr.symbol,
    sr.country,
    sr.sector,
    sr.theme,
    sr.metrics,
    sr.raw,
    sr.rank_index
  from public.scan_results as sr
  where sr.owner_id = p_owner_id
    and sr.scan_id = p_scan_id
  order by sr.rank_index asc
  limit greatest(1, least(coalesce(p_max_rows, 50000), 50000))
), projected as (
  select
    l.id,
    l.rank_index,
    jsonb_build_object(
      'symbol', l.symbol,
      'country', coalesce(nullif(l.raw ->> 'country', ''), nullif(l.country, '')),
      'sector', coalesce(nullif(l.raw ->> 'sector', ''), nullif(l.sector, '')),
      'theme', coalesce(nullif(l.raw ->> 'theme', ''), nullif(l.theme, '')),
      'perf3m', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'perf3m'),
        public.statsedge_coverage_finite_number(l.metrics -> 'perf3m')
      ),
      'perf6m', coalesce(...),
      'perf12m', coalesce(...),
      'rs3m', coalesce(...),
      'rs6m', coalesce(...),
      'rs12m', coalesce(...),
      'distance52w', coalesce(...),
      'maxDrawdown63d', coalesce(...),
      'momentumScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'momentumScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'momentumScore')
      ),
      'setupQualityScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'setupQualityScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'setupQualityScore')
      ),
      'adProxyScore', coalesce(...),
      'riskRewardScore', coalesce(...),
      'liquidityScore', coalesce(...),
      'weinsteinScore', coalesce(...),
      'minerviniScore', coalesce(...),
      'weaknessScore', coalesce(...),
      'riskScore', coalesce(...),
      'growthScore', coalesce(...),
      'demandScore', coalesce(...),
      'epsGrowthProxyScore', coalesce(...),
      'ipoScore', coalesce(...),
      'rsRating', coalesce(...),
      'signalCoverage', l.raw -> 'signalCoverage'
    ) as raw_thin
  from limited as l
)
select jsonb_build_object(
  'inputs',
  coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'raw', p.raw_thin) order by p.rank_index, p.id)
    from projected as p
  ), '[]'::jsonb),
  'rowsRead',
  (select count(*)::integer from limited)
);
$$;
```

(Cito con `coalesce(...)` abreviado en las líneas repetitivas — el patrón es
idéntico en las 21 claves: `statsedge_coverage_finite_number(l.raw -> 'x')`
con fallback a `l.metrics -> 'x'`. El texto literal completo está en
`supabase/migrations/20260710184308_scan_finalize_sector_composite_inputs.sql:59-176`.)

**Confirmado: no hay clave `objectiveSetupScore` en el `jsonb_build_object`.**
Hay `setupQualityScore` (línea 113-116 del archivo) pero no
`objectiveSetupScore`.

### A.2 — De dónde saldría `objectiveSetupScore`: ya vive en `raw`, con cobertura del 100%

No hay que calcularlo. El pipeline de scoring ya lo escribe en `raw` en el
momento del scan — lo confirma tanto el código como los datos reales.

Código: `lib/screenerPipeline.js:319` calcula la señal y `lib/screenerPipeline.js:354`
la mete en el objeto de la fila vía spread (`...r, ..., objectiveSetupScore, ...`)
que es lo que después se persiste como `raw` (mismo patrón que
`setupQualityScore`, que sí está en la proyección). `lib/materializedScanner.js:337`
hace lo mismo para el pipeline materializado.

Dato real, consulta ejecutada vía `supabase_query` (solo lectura, PostgREST)
acotada a `percentileScope: 'final'` y `created_at >= 2026-07-01`:

```
table=scan_results
select=id,created_at,raw->>objectiveSetupScore,metrics->>objectiveScore,metrics->>totalScore
filter=metrics->>percentileScope=eq.final&created_at=gte.2026-07-01
limit=200
```

Resultado: **86 filas** con `percentileScope: 'final'` en producción hoy (no
20 — la cifra de 20 que cita el commit `b51d1b48d9` y el enunciado de esta
tarea es del momento en que se escribió el fix; el scan siguió corriendo y
la población de filas finalizadas creció a 86 desde entonces). Confirmación
independiente por conteo:

```
table=scan_results
select=id
filter=metrics->>percentileScope=eq.final
limit=200
```
→ 86 elementos.

Cobertura de `raw.objectiveSetupScore` sobre esas 86 filas — consulta de
nulidad explícita:

```
table=scan_results
select=id
filter=metrics->>percentileScope=eq.final&raw->>objectiveSetupScore=is.null
limit=200
```
→ `[]` (cero filas). **Cobertura: 86/86 = 100%.**

Y en las 86 filas, `objectiveScore` y `totalScore` son literalmente iguales
en todas las que inspeccioné (verificado en la muestra de 30 y en la de 84
con fecha, dos lotes distintos de scan_id): el colapso reportado en la tarea
sigue presente hoy, después del fix `b51d1b4`, exactamente por la razón que
describe la tarea — `objectiveSetupScore` existe en `raw` con datos reales
pero la RPC no lo proyecta.

### A.3 — Qué cambiar exactamente: una línea, mismo patrón que las 20 ya existentes

Un único bloque nuevo dentro del mismo `jsonb_build_object`, con el mismo
patrón `coalesce(finite_number(raw), finite_number(metrics))` que ya usan
`setupQualityScore` y las otras 20 claves:

```sql
'objectiveSetupScore', coalesce(
  public.statsedge_coverage_finite_number(l.raw -> 'objectiveSetupScore'),
  public.statsedge_coverage_finite_number(l.metrics -> 'objectiveSetupScore')
),
```

Insertado, por ejemplo, junto a `'setupQualityScore'` (línea 113-116 de la
migración 20260710184308). Es una migración nueva de tipo `create or replace
function` (la firma `(text, uuid, integer)` no cambia, así que no hace falta
`drop function` ni tocar los `revoke`/`grant` — el patrón que ya siguió
`20260710184308` sobre `20260710104230`).

En `lib/scanPercentileFinalization.js:139-142`, una vez la RPC proyecte el
campo, la rama de degradación deja de activarse (el propio comentario en
`lib/scanPercentileFinalization.js:122-126` ya documenta esta condición
exacta como la causa pendiente):

```js
const setupQualityScore = Number.isFinite(row.setupQualityScore) ? row.setupQualityScore : null;
const objectiveSetupScore = Number.isFinite(row.objectiveSetupScore)
  ? row.objectiveSetupScore
  : setupQualityScore;
```

Con `objectiveSetupScore` presente en `row` (porque ahora viene en el
thin-raw), la primera rama del ternario se activa y `objectiveScore` deja de
degradar a `setupQualityScore` — **esto no requiere ningún cambio en
`lib/scanPercentileFinalization.js`**, el código JS ya está preparado para
consumir el campo en cuanto exista en la fila; el bloqueo es enteramente la
proyección SQL.

### A.4 — Otras RPC del mismo grupo: ninguna otra necesita cambio de coherencia

Revisé las tres RPC hermanas que también proyectan un thin-raw o consumen
estos campos:

- `finalize_scan_results` (`supabase/schema.sql:302-350`): recibe
  `p_patches jsonb` ya calculado por el caller JS y hace
  `set metrics = sr.metrics || src.metrics_patch`. No lee ni proyecta
  `setupQualityScore`/`objectiveSetupScore` — es agnóstica al contenido del
  patch. **No necesita cambios.**
- `coverage_scan_summary` (`supabase/migrations/20260710104226_coverage_scan_summary.sql`)
  y `scan_coverage_breakdown` (`supabase/migrations/20260710104227_scan_coverage_breakdown.sql`):
  grep confirma que ninguna referencia a `objectiveSetupScore` ni
  `setupQualityScore` aparece en ninguno de los dos archivos. **No
  necesitan cambios.**
- `leaderboard_publishable_rows` (comentario en
  `supabase/migrations/20260710180000_leaderboard_publishable_rows.sql:30`
  menciona `scan_finalize_inputs` solo como referencia de patrón de
  proyección, no comparte código). Sin referencias al campo. **No necesita
  cambios.**

Conclusión de A.4: el cambio es aislado a `scan_finalize_inputs`.

---

## PARTE B — El estado de la paridad

### B.5 — Qué comprueba `schema-parity.real.test.mjs` y por qué falla ahora

El archivo (`tests/integration/schema-parity.real.test.mjs`) tiene dos tests.
El primero (líneas 48-85) monta **tres** bases Postgres efímeras distintas y
compara sus catálogos:

```js
test("real PostgreSQL: bootstrap schema and base-plus-migrations 1A/1B-1/1B-2/Hito-0 catalogs are identical", () => {
  const migrationUrl = requireEphemeralPostgresUrl("schema-parity-migrations");
  const bootstrapUrl = requireEphemeralPostgresUrl("schema-parity-bootstrap");
  const baseUrl = requireEphemeralPostgresUrl("schema-parity-base-catalog");

  applyExecutionLifecycle(migrationUrl);
  applyBootstrapProjection(bootstrapUrl);
  applyBaseCatalogFixture(baseUrl);

  const migrationCatalog = foundationCatalog(migrationUrl);
  const bootstrapCatalog = foundationCatalog(bootstrapUrl);
  ...
  assertFunctionParity(migrationCatalog, bootstrapCatalog);
  assert.deepEqual(bootstrapCatalog, migrationCatalog);
  ...
});
```

`applyExecutionLifecycle` (`tests/integration/_ephemeralPostgresHarness.mjs:1020-1025`)
aplica una base fija (`FOUNDATION_BASE_COMMIT`) + la migración fundacional +
**todas** las migraciones posteriores a ella, descubiertas dinámicamente:

```js
function postFoundationMigrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql") && name > FOUNDATION_MIGRATION_FILENAME)
    .sort()
    .map((name) => path.join(MIGRATIONS_DIR, name));
}
```

`applyBootstrapProjection` (líneas 1027-1031) en cambio aplica
`supabase/schema.sql` completo (con una sustitución controlada de
`pg_cron` por stubs inertes). El test compara: ¿el catálogo de objetos
(tablas, funciones, triggers, políticas, ACL efectivo) que resulta de
reproducir el historial completo de migraciones es idéntico al catálogo que
resulta de aplicar `schema.sql` de una sola vez? Ese es el mecanismo de
paridad — y es exactamente el que, según su propio comentario
(`_ephemeralPostgresHarness.mjs:856-863`), detectó en su día que
`finalize_scan_results` llevaba 28 días divergido de `schema.sql` sin que
nadie lo notara.

**Por qué falla ahora — antes de llegar siquiera a comparar catálogos.**
`applyBootstrapProjection` llama a `bootstrapSchemaSql()`
(línea 830-834), que abre con:

```js
function bootstrapSchemaSql() {
  assertCurrentBootstrapSourceDigest();
  ...
}

export function assertCurrentBootstrapSourceDigest() {
  const schemaPath = path.resolve(process.cwd(), "supabase/schema.sql");
  assert.ok(fs.existsSync(schemaPath), `Missing bootstrap schema: ${schemaPath}`);
  const actual = sha256(fs.readFileSync(schemaPath, "utf8"));
  assert.equal(
    actual,
    REVIEWED_BOOTSTRAP_SOURCE_DIGEST,
    "Reviewed bootstrap digest must exactly match the current supabase/schema.sql bytes.",
  );
  return actual;
}
```

Calculé el hash real del `supabase/schema.sql` actual (1862 líneas):

```
$ shasum -a 256 supabase/schema.sql
db4469c82c52f83f6f0b62d77d13dfaf90d08bceadf3857e0ae303018d89fdd8  supabase/schema.sql
```

`REVIEWED_BOOTSTRAP_SOURCE_DIGEST` (`_ephemeralPostgresHarness.mjs:74`) es:

```
ca42831d6553d8fa296a0ae6a70dfccc33609f98d85a3e72151e24f52b992fb6
```

**No coinciden.** `assert.equal` lanza en el primer paso de
`applyBootstrapProjection`, antes de que se ejecute una sola comparación de
catálogo. La causa es el ADR `docs/adr-hito-1b-diferido.md`: el 2026-08-03 se
movieron 2158 líneas de `schema.sql` (el bloque de Hito 1B) a
`supabase/deferred/hito-1b.sql`, reduciendo el archivo de 4020 a 1862 líneas
— pero `REVIEWED_BOOTSTRAP_SOURCE_DIGEST` sigue fijado al hash de la versión
de 4020 líneas (el último comentario de revisión en el harness,
`_ephemeralPostgresHarness.mjs:60-73`, es del "29-jul-2026", anterior al
movimiento del 03-ago). El digest nunca se actualizó tras aparcar Hito 1B.

Efecto en cadena, aunque el test ya falla antes de llegar aquí: el segundo
test del archivo (líneas 97-103, "supabase/schema.sql se puede reaplicar...")
depende de que el primero haya poblado `schema-parity-bootstrap` — si el
primero lanza antes de terminar, el segundo probablemente falla también por
partir de un estado no preparado (no lo verifiqué ejecutando la suite
completa, ver "Lo que no he verificado").

### B.6 — Qué comprueba `REVIEWED_BOOTSTRAP_SOURCE_DIGEST` y qué haría falta para actualizarlo

Qué comprueba: es un candado de "nadie puede cambiar
`supabase/schema.sql` sin que un humano revise el diff completo y
re-calcule el hash a mano". El propósito literal está en el comentario que
lo precede (`_ephemeralPostgresHarness.mjs:49-51`):

> "Bootstrap safety has two independent controls: a byte-exact reviewed
> source plus a lexical inventory of executable references. The digest
> alone is not evidence that comments/strings were classified correctly."

`controlledBootstrapSqlFromReviewedSource` (línea 764-790) es la función
que lo consume: si el hash de `schema.sql` no coincide con el digest
esperado, lanza `"... is not a reviewed complete SQL source; refusing
controlled transformations."` (línea 766-768) — es decir, se niega incluso a
aplicar la sustitución inerte de `pg_cron`, porque no puede garantizar que
esa sustitución textual (`exactTopLevelStatementOffset`, líneas 727-762) siga
localizando el statement correcto en un archivo que no ha sido revisado byte
a byte.

Qué haría falta para actualizarlo: un humano debe (1) revisar el diff
completo y real de `schema.sql` desde la última revisión (no solo el
resultado, el diff — la app de este check es justo desconfiar del
autorreporte, ver el patrón ya documentado en `docs/adr-hito-1b-diferido.md`
§4 sobre el incidente del trigger), (2) confirmar que no se coló ninguna
superficie ejecutable nueva de red/cron (`pg_cron`, `net.*`, `http.*` — el
propio harness los lista, ver `assertBootstrapLexicalSafety`, no citada aquí
por brevedad pero presente en el mismo archivo), y (3) recalcular
`sha256(schema.sql)` y sustituir el valor de
`REVIEWED_BOOTSTRAP_SOURCE_DIGEST` en el harness. Es un paso manual,
deliberadamente sin automatizar — el comentario de la propia constante
documenta cada actualización anterior con su justificación línea a línea
(`_ephemeralPostgresHarness.mjs:53-73`), y ese historial es el que falta
escribir para el movimiento del 2026-08-03.

### B.7 — Si se añade una migración nueva ahora, ¿empeora, es indiferente, o arregla la divergencia?

**Es indiferente a la causa raíz, pero puede empeorar el síntoma agregado si
la migración también se refleja en `schema.sql`.**

Razonamiento con código: el test ya falla en el primer `assert.equal` del
digest (B.5) — antes de que se ejecute ninguna comparación función por
función. Añadir la migración de `objectiveSetupScore` no toca
`REVIEWED_BOOTSTRAP_SOURCE_DIGEST` ni el contenido byte a byte que ese
digest protege salvo que la migración también se aplique a `schema.sql`
(que es un archivo distinto, mantenido a mano — ver A.1/D.10). Si la
migración **solo** se añade a `supabase/migrations/` sin tocar
`schema.sql`, el digest sigue fallando exactamente igual que hoy, por la
misma razón de siempre: el fallo del digest no depende de qué migraciones
existan, depende de si los bytes actuales de `schema.sql` coinciden con el
hash fijado.

Dato adicional que sí importa para "empeora": ya verifiqué
(`grep -c` sobre `supabase/schema.sql`) que **`scan_finalize_inputs` no
existe en absoluto en `schema.sql` hoy** — ni la versión sin
`objectiveSetupScore` ni ninguna. Tampoco existen `coverage_scan_summary`,
`scan_coverage_breakdown` ni `leaderboard_publishable_rows`, pese a que sus
migraciones son anteriores (2026-07-10) a las migraciones de Hito 1B
(2026-07-17 en adelante) que sí se aparcaron el 2026-08-03. Es decir: la
ausencia de `scan_finalize_inputs` en `schema.sql` **no es un efecto del
aparcado de Hito 1B** — es una divergencia previa y distinta, del mismo tipo
que ya documentó el propio harness sobre `finalize_scan_results`
(comentario citado en B.5: "finalize_scan_results drifted from schema.sql
for 28 days undetected"). Si la migración nueva de `objectiveSetupScore`
se escribe solo contra `supabase/migrations/` (que es donde vive hoy
`scan_finalize_inputs`, no en `schema.sql`), la divergencia entre
"funciones que existen en producción/migraciones" y "funciones que
`schema.sql` describiría si se reaplicara" crece en una función más — de
"schema.sql no tiene `scan_finalize_inputs`" a "schema.sql no tiene
`scan_finalize_inputs` ni su versión con `objectiveSetupScore`". El test de
paridad ya no puede distinguir hoy ese matiz (falla antes, en el digest),
pero **si alguien arregla el digest sin también sincronizar `schema.sql`
con las 4 migraciones ausentes, el segundo assert
(`assertFunctionParity` / `assert.deepEqual(bootstrapCatalog,
migrationCatalog)`) empezará a fallar por función faltante** — que es
justo el fallo que el mecanismo está diseñado para producir.

---

## PARTE C — Las opciones sobre la paridad

Enumero salidas sin recomendar ninguna, con qué toca, qué gana, qué pierde,
y si dejaría el mecanismo de detección funcionando o lo silenciaría.

**1. Excluir del cálculo de paridad las migraciones diferidas (Hito 1B).**
- Qué toca: el harness (`_ephemeralPostgresHarness.mjs`), probablemente
  `postFoundationMigrationFiles()` para que ignore explícitamente los 4
  archivos de Hito 1B, y recalcular `REVIEWED_BOOTSTRAP_SOURCE_DIGEST` sobre
  el `schema.sql` reducido.
- Gana: el test vuelve a ejecutar la comparación función-por-función real
  (hoy no llega a ejecutarla en absoluto).
- Pierde: introduce una lista de exclusión mantenida a mano — el propio
  comentario del harness (`_ephemeralPostgresHarness.mjs:856-863`) advierte
  contra exactamente este patrón ("A fixed list silently excludes every
  future migration from schema-parity until someone remembers to add it by
  hand — that's a real failure mode that already happened once"). Cualquier
  migración de Hito 1B futura (si se retoma) requeriría acordarse de
  añadirla a la exclusión.
- Deja el mecanismo funcionando para todo lo demás (incluida la migración
  de `objectiveSetupScore`, que no es de Hito 1B), pero crea un punto ciego
  permanente sobre el bloque diferido mientras esté diferido.

**2. Mover también las migraciones de Hito 1B fuera de `supabase/migrations/`.**
- Qué toca: los 4 archivos
  (`20260717100000_scan_result_sets_foundation.sql`,
  `20260717110000_scan_execution_lease_ledger.sql`,
  `20260719100000_scan_result_set_finalize_publish.sql`,
  `20260720100000_published_scan_result_read.sql`) se moverían a
  `supabase/deferred/` (o similar), y el harness (que hoy descubre
  migraciones dinámicamente leyendo el directorio,
  `postFoundationMigrationFiles()`) dejaría de verlas sin necesitar
  ninguna lista de exclusión.
- Gana: coherencia total entre "lo que está en `schema.sql`" y "lo que está
  en `migrations/`" — ambos reflejarían el mismo corte. Recalcular el
  digest sobre el `schema.sql` reducido sería sencillo y el descubrimiento
  dinámico seguiría siendo automático (sin lista mantenida a mano).
- Pierde: las migraciones son el registro histórico de lo que se aplicó
  contra producción, con timestamp por nombre de archivo — moverlas cambia
  ese registro. Si Hito 1B se retoma, hay que decidir si se "re-estrenan"
  con timestamps nuevos o se restauran con los originales (afecta a
  cualquier tooling que asuma que `supabase/migrations/` es un log
  append-only de lo ya aplicado).
- Deja el mecanismo funcionando igual de bien que hoy lo hacía antes del
  2026-08-03 (mismo diseño, mismo corte reflejado en ambos lados).

**3. Redefinir qué significa paridad cuando algo está diferido.**
- Qué toca: el concepto mismo de "paridad" en el test — en vez de comparar
  "migraciones completas vs `schema.sql` completo", compararía "migraciones
  activas (no diferidas) vs `schema.sql`" como conjuntos declarados
  explícitamente en algún manifiesto (no inferido del sistema de archivos).
- Gana: hace explícito y auditable qué se considera "en producción" vs
  "diferido" en un solo lugar, en vez de que la respuesta dependa de dónde
  vive un archivo `.sql`.
- Pierde: es el cambio de mayor superficie de las tres — reescribe el
  contrato del test, no solo sus datos de entrada. Requiere más revisión
  para confiar en que el nuevo contrato sigue detectando lo que detectaba
  antes (la propia razón de ser del mecanismo, ver cita en B.5 sobre los 28
  días de `finalize_scan_results`).
- Puede dejar el mecanismo funcionando o silenciarlo, dependiendo enteramente
  de cómo se implemente — es la opción con más grados de libertad y por
  tanto la más fácil de implementar mal sin darse cuenta.

**4. (Añadida) Actualizar solo el digest, sin ninguna otra acción, aceptando
que el segundo assert (`assertFunctionParity`) fallará por las funciones que
faltan en `schema.sql`.**
- Qué toca: solo `REVIEWED_BOOTSTRAP_SOURCE_DIGEST` en el harness.
- Gana: nada por sí sola — pasa de fallar en el paso 1 (digest) a fallar en
  el paso 2 (conjunto de funciones), que es un fallo más informativo pero
  sigue siendo un fallo. Es útil solo como paso intermedio de diagnóstico,
  no como cierre.
- Pierde: nada adicional a lo que ya está roto hoy.
- Deja el mecanismo funcionando en el sentido de que sigue gritando — solo
  cambia el mensaje del grito.

**5. (Añadida) Sincronizar `schema.sql` con el estado real de
`supabase/migrations/` (añadiendo las funciones ausentes:
`scan_finalize_inputs`, `coverage_scan_summary`, `scan_coverage_breakdown`,
`leaderboard_publishable_rows`) y recalcular el digest en el mismo cambio.**
- Qué toca: `supabase/schema.sql` (añadir las 4 funciones/objetos ausentes
  en su posición cronológica correcta) + el digest.
- Gana: cierra la brecha real que B.7 identifica — hoy `schema.sql` no
  reproduce ni siquiera el estado pre-Hito-1B correctamente. El test de
  paridad pasaría a comparar dos conjuntos que de verdad deberían ser
  iguales.
- Pierde: es el trabajo de mayor alcance de las cinco — exige reconstruir a
  mano cuatro funciones dentro de `schema.sql` y revisar cada una byte a
  byte (mismo estándar que exige el propio digest, B.6), no solo tocar
  metadatos del test.
- Deja el mecanismo funcionando en su forma más fiel al propósito original.

---

## PARTE D — Cómo se despliega

### D.10 — `npm run supabase:schema`

Confirmado, cita literal (`scripts/supabase-admin.mjs:308-339`):

```js
async function schemaCommand(config) {
  printConfig(config);
  console.log("");

  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(`No encuentro ${path.relative(ROOT, SCHEMA_PATH)}.`);
  }

  const sql = fs.readFileSync(SCHEMA_PATH, "utf8").trim();
  if (!sql) throw new Error("supabase/schema.sql esta vacio.");
  if (!config.accessToken) {
    throw new Error("Falta SUPABASE_ACCESS_TOKEN. Crealo en Supabase Account > Access Tokens y anadelo a .env.local.");
  }

  console.log("Ejecutando supabase/schema.sql mediante Supabase Management API...");
  let result = await managementRequest(config, "/database/query", { query: sql });

  if (!result.ok && (result.status === 403 || result.status === 404 || result.status === 405)) {
    console.log(`database/query no disponible (${result.status}). Probando database/migrations...`);
    result = await managementRequest(config, "/database/migrations", {
      name: "statsedge_initial_schema",
      query: sql,
    });
  }

  if (!result.ok) {
    throw new Error(`Supabase schema HTTP ${result.status}: ${failureMessage(result)}`);
  }

  console.log("OK Schema aplicado.");
  await statusCommand(config);
}
```

Confirmado: lee `supabase/schema.sql` **completo**, lo manda entero en una
sola llamada a la Management API (`/database/query`), sin dividir por
statement ni por migración individual. `SCHEMA_PATH` (línea 6) apunta
exactamente a `supabase/schema.sql`.

### D.11 — Cómo se aplicaría esta migración concreta

Dado que `scan_finalize_inputs` **no está en `schema.sql`** (verificado en
B.7/A.1), `npm run supabase:schema` **no es hoy un camino que toque esta
función en absoluto** — ni para bien ni para mal, porque el script nunca la
menciona. La función vive en producción porque en algún momento se aplicó
por otra vía (no vía este script, dado que `schema.sql` nunca la tuvo desde
que existe la copia actual del archivo).

Pasos que tendría que dar el dueño, en el orden que exige lo ya verificado
en este documento:

1. Decidir primero una opción de la Parte C (o una variante) — no es
   bloqueante técnicamente para escribir la migración SQL (ver C.9 más
   abajo), pero si el dueño quiere que `test:integration:ephemeral` vuelva a
   correr en verde antes de tocar producción, tiene que resolverse antes.
2. Escribir la migración nueva en `supabase/migrations/` con el `create or
   replace function` de A.3 (mismo patrón, mismo `revoke`/`grant` que ya
   trae `20260710184308`).
3. Decidir si también se sincroniza `schema.sql` con esta función (y de
   paso con las otras 3 que faltan, opción C.5) o si se deja fuera de
   `schema.sql` como está hoy (manteniendo la asimetría ya existente).
4. Si se aplica solo como migración puntual contra producción: no hay un
   script para esto en `package.json` (los únicos scripts `supabase:*` son
   `supabase:status`, `supabase:schema` y `supabase:seed-settings` — ver
   `package.json:30-32`). Aplicarla "a mano" significaría ejecutar el SQL de
   la migración directamente contra producción — vía la Management API
   (`apply_migration` del MCP de Supabase, o el SQL editor del dashboard),
   no vía `npm run supabase:schema` (que reaplicaría todo `schema.sql`, y
   como ese archivo no tiene la función, no la aplicaría).
5. Verificar en `test:integration:ephemeral:reset` que el nuevo
   `create or replace function` no rompe nada más antes de tocar
   producción.
6. Aplicar y verificar con una consulta de solo lectura equivalente a la de
   A.2 que las filas nuevas (`percentileScope: 'final'`) ya no tienen
   `objectiveScore === totalScore`.

### D.12 — Riesgo: ¿puede repetir el incidente del 29-30 de julio?

El incidente (documentado en `docs/adr-hito-1b-diferido.md` §4, con la cita
literal del mensaje de commit del fix `01d9945`) fue: un trigger
(`scans_published_result_set_sealed_trg`, disparado en **todo**
insert/update de `owner_id`/`published_result_set_id` sobre `public.scans`)
llamaba a un helper (`statsedge_lock_result_sets_v1`) con `security invoker`,
y ese helper tenía `EXECUTE` revocado a `service_role` por diseño de Hito
1B-1. Como el trigger corre con los privilegios de quien hace el INSERT/UPDATE
(`service_role`, vía PostgREST), y `security invoker` hereda esa restricción,
**cualquier escritura legacy ordinaria a `scans`** (incluidos los crons)
empezó a fallar con "permission denied". El fix cambió el trigger a
`security definer`. Un segundo problema del mismo redespliegue: un único
`create trigger` (`derived_snapshots_source_immutable_trg`) sin su
`drop trigger if exists` correspondiente, que hacía fallar cualquier
reaplicación de `schema.sql` sobre una base ya migrada con "trigger already
exists".

Comparación con la migración propuesta aquí:

- **No añade ningún trigger.** `scan_finalize_inputs` es una función
  `language sql stable` sin efectos secundarios ni disparadores asociados —
  no puede reproducir el fallo de "trigger dispara en cualquier escritura a
  `scans`" porque no crea, modifica ni depende de ningún trigger sobre
  `scans` ni sobre ninguna otra tabla.
- **No cambia ACL de forma restrictiva.** El patrón que ya sigue
  `20260710184308` (y que seguiría esta migración) es
  `revoke all ... from public, anon, authenticated` seguido de
  `grant execute ... to service_role` — es decir, el rol que sí necesita
  ejecutarla (`service_role`, que es el que usa `lib/supabaseServer.js` vía
  `SUPABASE_SERVICE_ROLE_KEY`) mantiene el permiso. El incidente de julio
  fue causado por revocar acceso a un helper que SÍ se necesitaba desde una
  ruta de escritura legacy sin darse cuenta de esa dependencia cruzada; aquí
  no hay una ruta de escritura legacy que dependa de un nuevo helper interno
  — es una clave añadida al `jsonb_build_object` de una función ya existente
  y ya consumida exclusivamente por `finalizeScanResultsInDb`
  (`lib/scanPercentileFinalization.js:257-261`).
- **Sí comparte el riesgo de idempotencia de `create or replace function`
  sobre una firma existente**, que es benigno: `create or replace function`
  con la misma firma `(text, uuid, integer)` no requiere `drop function`
  previo y no puede fallar por "already exists" (a diferencia de
  `create trigger`, que si carece de `drop trigger if exists` sí puede
  fallar en un redespliegue). Este patrón ya se demostró seguro: es
  exactamente lo que hizo `20260710184308` sobre `20260710104230` en
  producción sin incidente.
- **Superficie de re-despliegue de `schema.sql`:** como la función no vive
  en `schema.sql` (D.11), aplicar `npm run supabase:schema` NO tocaría esta
  migración en absoluto — ni para aplicarla ni para repetir el incidente de
  julio sobre ella. El riesgo del incidente de julio es inherente a
  reaplicar el archivo completo `schema.sql`; una migración puntual aplicada
  fuera de ese flujo no hereda ese riesgo específico, aunque sí hereda el
  riesgo general de cualquier cambio de esquema en producción (backup,
  ventana de mantenimiento, revisión humana del SQL antes de ejecutar).

**Conclusión de D.12: el mecanismo concreto que causó el incidente de julio
(trigger `security invoker` sobre una tabla de escritura legacy compartida)
no está presente en esta migración — no crea triggers, no revoca acceso que
alguna ruta legacy necesite, y no pasa por `npm run supabase:schema`. El
riesgo residual es el genérico de cualquier DDL contra producción, no una
repetición del patrón específico de julio.**

---

## CONFIANZA

- **Alta** — A.1, A.3, A.4, B.5, B.6, D.10: verificado por lectura directa y
  literal del código/DDL citado arriba.
- **Alta** — A.2 (cobertura de `objectiveSetupScore` en `raw`): verificado
  con dos consultas de solo lectura contra producción (nulidad explícita y
  conteo), 86/86 filas con `percentileScope: 'final'` tienen el campo no
  nulo.
- **Alta** — B.7 (el digest falla hoy, antes de comparar catálogo): el
  cálculo del hash de `schema.sql` y su comparación contra la constante es
  determinístico y lo ejecuté yo mismo (`shasum -a 256`).
- **Media** — D.12 (ausencia de riesgo de repetir el incidente de julio):
  la comparación mecanismo-por-mecanismo es sólida, pero no ejecuté la
  migración contra ningún Postgres (ni efímero ni de producción) para
  confirmarlo empíricamente — es un razonamiento sobre el código, no una
  prueba.
- **Media** — Alcance exacto de "qué falta en `schema.sql`" (B.7): confirmé
  por `grep` que 4 nombres de función no aparecen, pero no hice un diff
  estructural completo función-por-función entre `schema.sql` y el conjunto
  total de migraciones — podría haber más ausencias no buscadas
  explícitamente (busqué por nombre las que ya sabía que eran relevantes
  para esta tarea).

## LO QUE NO HE VERIFICADO

- No ejecuté `npm run test:integration:ephemeral` ni
  `tests/integration/schema-parity.real.test.mjs` de forma aislada — el
  análisis del fallo (B.5-B.7) es por lectura de código y cálculo manual
  del hash, no por ejecución real de la suite (que requiere un Postgres 16
  efímero local, `STATSEDGE_EPHEMERAL_POSTGRES_URL`, no confirmado
  disponible en este entorno).
- No verifiqué si el segundo test del archivo
  (`"supabase/schema.sql se puede reaplicar..."`) también falla o si de
  algún modo sobrevive al fallo del primero — depende del comportamiento de
  `node --test` ante bases de datos compartidas entre tests cuando el
  primero lanza a mitad, que no reproduje.
- No hice un inventario exhaustivo de todas las funciones que `schema.sql`
  debería tener y no tiene más allá de las 4 que identifiqué
  (`scan_finalize_inputs`, `coverage_scan_summary`, `scan_coverage_breakdown`,
  `leaderboard_publishable_rows`) — es posible que existan más divergencias
  del mismo tipo que no busqué por no ser relevantes para el alcance directo
  de esta tarea.
- No verifiqué contra producción si existen filas con
  `percentileScope: 'final'` anteriores a 2026-07-01 con un patrón distinto
  de cobertura de `objectiveSetupScore` (acoté la consulta de A.2 tal como
  pedía la tarea).
- No confirmé por qué vía exacta llegó `scan_finalize_inputs` a producción
  si nunca estuvo en `schema.sql` (¿SQL editor manual, migración vía CLI de
  Supabase en algún momento, Management API ad-hoc?) — inferí que no fue
  vía `npm run supabase:schema` por la ausencia en el archivo, pero no
  reconstruí el mecanismo real de despliegue histórico.
