# Estado del Hito 1B (scan_executions / scan_result_sets) — 2026-08-03

Documento de inventario, no de decisión. No contiene recomendaciones. Todo lo
citado proviene del checkout real en `codex/statsedge-ui-polish`,
`HEAD=4f32781cfae4b75c85bd6c0ef97f0f8581e4df2d`, o de consultas de solo
lectura contra producción vía `supabase_query` (PostgREST, tope 200 filas).

---

## PARTE A — Qué es y qué resolvía

### A.1 — Documentación del Hito 1B en `docs/`

Búsqueda ejecutada:

```
grep -ril -E "1B|hito|result_set|execution|ADR" docs/
grep -n -iE "hito 1b|hito1b|1b-1|1b-2|1b-3" docs/*.md
```

**No existe ningún ADR ni documento de diseño dedicado al Hito 1B.** Los
únicos dos documentos en `docs/` que lo mencionan por nombre son:

1. **`docs/note-hito-1b1-rpc-service-role-inaccesible-2026-07-30.md`** (30
   jul 2026). No es un ADR ni una decisión de producto — el propio documento
   lo declara:

   > "Estado: nota de seguimiento, no bloqueante hoy. No es un ADR ni una
   > decisión de producto. Escrita al cerrar el incidente de
   > `statsedge_published_result_set_sealed_v1` [...] para dejar constancia
   > de un hallazgo relacionado que no se tocó en ese fix."

   Documenta que las 10 funciones/helpers de Hito 1B-1 son inaccesibles para
   `service_role` de forma deliberada, y que nada en el código vivo las
   invoca:

   > "Hoy es inofensivo porque **nada en el código vivo llama a estas RPC**:
   > `lib/materializedScanner.js` sigue escribiendo `scans`/`scan_results`
   > directamente por PostgREST (el camino legacy), no a través de
   > `begin_scan_execution` ni de ninguna otra función de este grupo."

2. **`docs/audit-tenancy-gate-verificacion-2026-07-25.md`** (25 jul 2026),
   una auditoría de una condición no-go de tenancy (Hito 2), no de Hito 1B en
   sí. Lo menciona solo como barrera de lectura pendiente de fusionar en esa
   fecha (dictamen ya obsoleto: el commit citado sí es ancestro del HEAD
   actual, ver A.2):

   > "El dato decisivo es que el commit verificado del lector Hito 1B-3
   > (`93929ce`) **no es ancestro del HEAD auditado**. Solo está contenido en
   > `codex/scan-integrity-result-sets`."

**La documentación real del "qué problema resuelve" vive en los comentarios
del propio `supabase/schema.sql` y de las cuatro migraciones**, no en
`docs/`. Cabeceras literales de cada bloque (ver A.3 para el resto):

- `supabase/schema.sql:45-47`: "Hito 1A: additive foundation only. Verified
  rows live outside the legacy scan_results surface so staging can never be
  observed by existing readers."
- `supabase/schema.sql:525-527`: "Hito 1B-1: execution lease fencing and
  idempotent staging ledger only. No function in this migration seals,
  publishes, mutates scan_results, or changes any published pointer."
- `supabase/schema.sql:1170-1171`: "Hito 1B-2: DB-owned reconciliation,
  sealing, and atomic publication. There is deliberately one terminal RPC.
  It never writes legacy scan_results."
- `supabase/schema.sql:1673-1674`: "Hito 1B-3: canonical DB-owned reader for
  an atomically published result set. This reader deliberately has no
  legacy scan_results fallback."

No encontré ningún documento en `docs/ROADMAP.md`, `docs/coverage-roadmap.md`
ni `docs/camino-a-closure-2026-07-16.md` que mencione el Hito 1B (grep sin
coincidencias en los tres). Tampoco ningún `docs/adr-*.md` lo menciona en su
contenido (solo coinciden por la palabra "ADR" del nombre de archivo).

### A.2 — Tablas y RPC del grupo

**Tablas** (todas `create table if not exists`, con `enable row level
security` pero sin `force row level security` — `supabase/schema.sql:391-394`):

- `public.scan_executions` (`schema.sql:77-103`)
- `public.scan_result_sets` (`schema.sql:105-137`)
- `public.scan_work_items` (`schema.sql:139-161`)
- `public.scan_result_set_rows` (`schema.sql:163-187`)

Adyacentes en el mismo bloque transaccional pero **fuera del alcance
preguntado** (no forman parte de las 10 RPC, y sus propias RPC nunca se
crearon — ver más abajo): `public.derived_snapshots`,
`public.derived_snapshot_items`, `public.derived_snapshot_heads`
(`schema.sql:189-261`, ~108 líneas incluyendo su trigger e índices).

**Las 10 RPC / helpers de ciclo de vida** (firma, qué hace, seguridad; DDL
citado literalmente):

| # | Función | Firma (parámetros) | Seguridad | Línea |
|---|---|---|---|---|
| 1 | `begin_scan_execution` | `p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_idempotency_key text, p_input jsonb, p_methodology jsonb, p_lease_seconds integer default 60` | `security invoker` | 644 |
| 2 | `resume_scan_execution` | `p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_lease_seconds integer default 60` | `security invoker` | 775 |
| 3 | `takeover_scan_execution` | `p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_lease_seconds integer default 60` | `security invoker` | 802 |
| 4 | `register_scan_work_item` | `p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_work_index integer, p_payload jsonb` | `security invoker` | 845 |
| 5 | `persist_scan_result` | `p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_work_index integer, p_row jsonb` | `security invoker` | 873 |
| 6 | `complete_scan_work_item` | `p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_work_index integer, p_outcome text, p_reason jsonb` | `security invoker` | 911 |
| 7 | `checkpoint_scan_execution` | `p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_checkpoint jsonb` | `security invoker` | 935 |
| 8 | `abandon_scan_execution` (versión final) | `p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_reason jsonb` | `security invoker` | 1309 (reemplaza la de 1000) |
| 9 | `finalize_scan_execution` | `p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint` | `security invoker` | 1417 |
| 10 | `read_published_scan_result_set_v1` | `p_owner_id text, p_scan_id uuid, p_expected_result_set_id uuid, p_expected_set_hash text, p_after_work_index integer, p_limit integer` | **`security definer`** (única del proyecto) | 1711 |

DDL literal de la firma + modificador de cada una (`schema.sql`):

```
644: create or replace function public.begin_scan_execution(
645:   p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint,
646:   p_idempotency_key text, p_input jsonb, p_methodology jsonb, p_lease_seconds integer default 60
647: )
648: returns jsonb language plpgsql security invoker
```
```
1711: create or replace function public.read_published_scan_result_set_v1(
...
1719: returns jsonb
1720: language sql
1721: stable
1722: security definer
```

Helpers internos usados por las 9 RPC de escritura (`security invoker`,
todos con `revoke all ... from public` y, además, de `anon`/`authenticated`/
`service_role` explícitamente — `schema.sql:1126-1130`, `1661-1668`):
`statsedge_execution_identity_key_v1`, `statsedge_result_set_lock_key_v1`,
`statsedge_lock_result_sets_v1`, `statsedge_lock_result_set_v1`,
`statsedge_assert_execution_lease_v1`, `statsedge_finalization_manifest_v1`,
`statsedge_finalization_set_hash_v1`, `statsedge_assert_terminal_replay_evidence_v1`,
`statsedge_result_set_mutability_v1`, `statsedge_staging_child_mutability_v1`,
`statsedge_terminal_execution_immutable_v1`.

**Permisos reales verificados en el código** (no en producción — ver B.6/D.10
para el hallazgo de incompatibilidad ya corregido para el trigger):

- Las 9 RPC de escritura (1-9): `revoke all ... from public`
  (`schema.sql:1131-1138` y `1667`), y además revocadas explícitamente de
  `anon`, `authenticated` y `service_role` vía bloque `do $$ ... $$`
  (`schema.sql:1668`). **Ninguna tiene `grant execute` a ningún rol.**
- `read_published_scan_result_set_v1` (10): revocada de `public`, `anon`,
  `authenticated` (`schema.sql:2158-2159`, `2181-2185`) pero **sí tiene
  `grant execute` a `service_role`** (`schema.sql:2186-2188`):
  ```
  2186:    if exists (select 1 from pg_roles where rolname = 'service_role') then
  2187:      execute format('grant execute on function public.%s to service_role', function_name);
  2188:    end if;
  ```
  Esto contradice parcialmente la nota del 30-jul citada en A.1, que agrupa
  las "diez funciones de Hito 1B-1" como inaccesibles para `service_role`: la
  nota se refiere estrictamente a las 9 de escritura + sus helpers, no al
  lector 1B-3, que es *security definer* y sí es invocable por
  `service_role` desde el 23-jul-2026 (ver comentario de diseño citado en
  A.3). El propio esquema lo documenta:
  > `schema.sql:2151-2153`: "Contrato de roles: service_role recibe EXECUTE
  > unicamente sobre las dos funciones propias de 1B-3 (el lector y su
  > helper de error)."

Las RPC futuras de `derived_snapshots` (`begin_derived_snapshot`,
`persist_derived_snapshot_items`, `publish_derived_snapshot`) **nunca se
crearon** — siguen listadas como comentario en `schema.sql:516-518` bajo el
encabezado "Future RPC interfaces -- deliberately NOT created or connected
in Hito 1A", y `grep` confirma que no existe ningún
`create or replace function public.begin_derived_snapshot` en el archivo.

### A.3 — Qué problema legacy pretende resolver

La justificación explícita está en los comentarios inline del esquema, no en
un documento de diseño aparte. Es, de forma consistente en cada cita,
**concurrencia + atomicidad + idempotencia**, no aislamiento multi-tenant ni
lecturas parciales del lado del cliente:

- Fencing de lease contra ejecuciones concurrentes del mismo scan
  (`schema.sql:603-605`, comentario justo antes de
  `statsedge_assert_execution_lease_v1`):
  > "The advisory key is held before these row locks. Re-read every linked
  > record after acquiring it; callers must never trust pre-lock state."
- Bloqueo advisory no bloqueante, diseñado para evitar deadlocks entre
  triggers y escritores (`schema.sql:563-565`):
  > "This deliberately never waits. A trigger can already own a row lock
  > before it runs, so taking a blocking advisory lock here could close a
  > lock cycle with a writer. Contention is an explicit, retryable failure
  > instead."
- Idempotencia de reintentos de un mismo `begin_scan_execution`
  (`schema.sql:552-555`):
  > "Every 1B-1 writer and both published-pointer barriers serialize on this
  > transaction-scoped key before trusting any result-set state. Collisions
  > are harmless (they only serialize unrelated sets); equal UUIDs always
  > map to the same lock."
- Reconciliación física exacta antes de publicar, para evitar publicar un
  resultado con filas parciales o inconsistentes
  (`schema.sql:1443-1445`, dentro de `finalize_scan_execution`):
  > "This is the one physical reconciliation used for both a live
  > finalization and a terminal replay. Terminal records are immutable, so a
  > divergence must fence the replay rather than repair a cache or receipt."
- Publicación atómica de puntero (`schema.sql:1080-1082`):
  > "A published pointer is a permanent reference to a sealed artifact. The
  > forward trigger above protects pointer assignment; this inverse trigger
  > protects later state changes on the referenced result set."

No encontré ninguna mención explícita a "aislamiento multi-tenant" como
motivación de este grupo — el `owner_id` se usa como clave de coherencia
interna entre `scans`/`scan_executions`/`scan_result_sets` (comparaciones
`is distinct from` en cada función), no como frontera de seguridad RLS: las
cuatro tablas tienen `enable row level security` sin `force row level
security` y sin ninguna `create policy` (confirmado por
`docs/audit-tenancy-gate-verificacion-2026-07-25.md`, sección C4: "El
repositorio sigue habilitando RLS en 19 tablas, pero no contiene policies,
ACL de tabla, default privileges ni `FORCE RLS`."). La justificación de
aislamiento de tenant es, por tanto, una lectura mía razonada a partir del
uso de `owner_id`, no una cita textual — lo marco así en CONFIANZA.

El problema legacy concreto que este grupo ataca (inferido de los comentarios
de "never mutates scan_results", "no legacy fallback", y de la mecánica de
lease/ledger/manifest/hash): el camino legacy actual
(`writeMaterializedScan`, ver D.10) hace un `POST`/`DELETE` directo por
PostgREST sobre `scans`/`scan_results` sin ninguna garantía transaccional de
extremo a extremo entre "borrar resultados viejos" e "insertar los nuevos en
lotes de 300" — una lectura concurrente durante ese intervalo vería un
estado parcial. El grupo Hito 1B sustituye eso por un ciclo
begin→register→persist→complete→finalize con lease epoch, hash canónico por
fila y manifiesto reconciliado antes de mover el puntero público. Esto es una
inferencia razonada a partir del código, no una cita explícita que diga "el
problema del camino legacy es X" — no encontré esa frase en ningún
documento.

---

## PARTE B — Coste actual

### B.4 — Líneas de SQL dedicadas al grupo

En `supabase/schema.sql` (4020 líneas totales), el grupo ocupa los bloques
marcados explícitamente:

```
45:   -- STATS_EDGE_HITO_1A_FOUNDATION_BEGIN
522:  -- STATS_EDGE_HITO_1A_FOUNDATION_END
524:  -- STATS_EDGE_HITO_1B_1_BEGIN
1167: -- STATS_EDGE_HITO_1B_1_END
1169: -- STATS_EDGE_HITO_1B_2_BEGIN
1672: -- STATS_EDGE_HITO_1B_2_END
1673: -- Hito 1B-3: canonical DB-owned reader... (sin marcador END explícito;
      termina en la línea 2202, justo antes de `create or replace function
      public.upsert_scan_newer_wins` en 2203)
```

Suma: (522-45+1) + (1167-524+1) + (1672-1169+1) + (2202-1673+1) = 478 + 644
+ 504 + 530 = **2156 líneas**, sobre 4020 totales = **53.6% del esquema**.

De esas 2156, aproximadamente 108 corresponden a `derived_snapshots` y su
trigger (tablas, índices, RLS, función de inmutabilidad) — fundamento
añadido en el mismo bloque 1A pero sin ninguna RPC propia construida (ver
A.2). El resto (~2048 líneas, ~51% del esquema) es estrictamente
tablas/RPC/triggers/helpers del grupo de scan_executions/result_sets.

En `supabase/migrations/` (3825 líneas totales en 13 archivos), las cuatro
migraciones del grupo:

```
514 supabase/migrations/20260717100000_scan_result_sets_foundation.sql
642 supabase/migrations/20260717110000_scan_execution_lease_ledger.sql
502 supabase/migrations/20260719100000_scan_result_set_finalize_publish.sql
530 supabase/migrations/20260720100000_published_scan_result_read.sql
```

Suma: **2188 líneas** sobre 3825 totales = **57.2% de las migraciones**.

### B.5 — Tests: cuántos, cuánto tardan, qué verifican

Dos capas de tests, con cobertura completamente distinta:

**Capa 1 — `tests/scanResultSetFoundationContracts.test.js`** (204 líneas).
Es la única que corre en `npm test` (`vitest run`) por defecto. **No abre
ninguna conexión a base de datos.** Es enteramente comparación de texto
sobre el código fuente SQL: lee `supabase/schema.sql` y las migraciones como
strings y hace `expect(body).toContain("...")` / `toMatch(/.../ )` sobre
fragmentos literales del cuerpo de las funciones. Ejemplos literales del
propio archivo:

```js
// tests/scanResultSetFoundationContracts.test.js:84-88
const body = functionBody(source, name);
expect(body).toMatch(/\)\s*returns\s+jsonb\s+language\s+plpgsql/iu);
for (const field of SCAN_RESULT_SET_RPC_RETURN_CONTRACTS[name]) {
  expect(body).toContain(`'${field}'`);
}
```

Esto responde directamente a la pregunta del enunciado: **no verifica que
las RPC funcionen — verifica que el texto SQL contiene ciertas
subcadenas exactas** (nombres de campo del receipt, mensajes de error como
`SE_LEDGER_ROW_MISMATCH`, fragmentos de condiciones `WHERE`). Es un
detector de regresión textual, no un test funcional.

**Capa 2 — Suite `test:integration:ephemeral`** (8 archivos,
`node --test`, **excluida de `npm test`** por configuración explícita de
`vitest.config.mjs`):

```
// vitest.config.mjs
// Ordinary Vitest is strictly unit/static: database integrations run only
// through their explicit scripts. Hito 1A uses node:test.
include: ["tests/**/*.test.js", "tests/**/*.test.mjs"],
exclude: ["tests/integration/**/*.test.mjs"],
```

Estos sí ejecutan las RPC reales contra un Postgres 16.x efímero local
(`tests/integration/_ephemeralPostgresHarness.mjs`), vía `psql` en
transacciones controladas. Verifiqué esto ejecutando la suite yo mismo en
este checkout, contra Postgres local (no producción):

```
bash scripts/reset-ephemeral-db.sh
STATSEDGE_EPHEMERAL_POSTGRES=1 \
STATSEDGE_EPHEMERAL_POSTGRES_URL='postgresql://127.0.0.1:5432/statsedge_ephemeral_{suite}' \
node --test tests/integration/bootstrap-control.contract.test.mjs \
  tests/integration/ephemeral-roles.real.test.mjs \
  tests/integration/scan-result-set-integrity.real.test.mjs \
  tests/integration/scan-result-set-concurrency.real.test.mjs \
  tests/integration/scan-execution-lifecycle.real.test.mjs \
  tests/integration/scan-result-set-finalization-publication.real.test.mjs \
  tests/integration/scan-result-set-published-read.real.test.mjs \
  tests/integration/schema-parity.real.test.mjs
```

Resultado real (íntegro, no resumido):

```
ℹ tests 28
ℹ suites 0
ℹ pass 28
ℹ fail 0
ℹ duration_ms 4512.307417
```

Los tests individuales más lentos de este grupo (nombre y tiempo real
reportado por Node):

```
✔ real PostgreSQL: finalize_scan_execution matrix reconciles, seals, publishes, and preserves old visibility (4309.149375ms)
✔ real PostgreSQL: Hito 1B-3 published reader matrix is DB-owned, fail-closed, and page-stable (1343.034291ms)
✔ real PostgreSQL: bootstrap schema and base-plus-migrations 1A/1B-1/1B-2/Hito-0 catalogs are identical (1354.8935ms)
✔ real PostgreSQL: two persistent writers race through takeover, register and persist with no partial state (1391.565791ms)
✔ real PostgreSQL: Hito 1B-1 races use two persistent sessions and leave one fenced winner with exact rollback (1121.045333ms)
```

De los 28 tests de esta corrida, no todos son del grupo Hito 1B
estrictamente (incluye `bootstrap-control.contract.test.mjs` y
`schema-parity.real.test.mjs`, que verifican el bootstrap completo, no solo
este grupo). Contando archivos específicos del grupo:
`scan-result-set-integrity`, `scan-result-set-concurrency`,
`scan-execution-lifecycle`, `scan-result-set-finalization-publication`,
`scan-result-set-published-read` = 5 archivos, 1391 líneas de test conjunto
(118+330+288+809+276, ver conteo abajo), más
`derived-snapshot-publication.real.test.mjs` (52 líneas, no ejecutada en
este comando porque no está en el script `test:integration:ephemeral` de
`package.json`).

Conteo de líneas de test del grupo:

```
     204 tests/scanResultSetFoundationContracts.test.js
     118 tests/integration/scan-result-set-integrity.real.test.mjs
     330 tests/integration/scan-result-set-concurrency.real.test.mjs
     288 tests/integration/scan-execution-lifecycle.real.test.mjs
     809 tests/integration/scan-result-set-finalization-publication.real.test.mjs
     276 tests/integration/scan-result-set-published-read.real.test.mjs
      52 tests/integration/derived-snapshot-publication.real.test.mjs
    1292 tests/integration/_ephemeralPostgresHarness.mjs (harness compartido, no específico del grupo)
```

**Conclusión verificada, no inferida:** el test que corre en CI/`npm test`
por defecto es puramente textual; el test que ejecuta las RPC de verdad
existe, pasa (28/28, verificado ahora mismo), pero requiere un Postgres
efímero local levantado a mano y no corre en el flujo estándar.

### B.6 — Incidentes de producción documentados

Hubo exactamente un incidente de producción confirmado, causado por este
grupo, que **rompió el camino legacy** (no una RPC nueva sin usar). Mensaje
de commit del fix, literal (`git log -1 01d9945 --format=%B`):

> "El trigger llamaba a statsedge_lock_result_sets_v1 como invoker, y esa
> función tiene EXECUTE revocado a service_role por el contrato de Hito
> 1B-1: cualquier escritura en scans vía PostgREST fallaba con permission
> denied, incluidos los crons. SECURITY DEFINER mantiene el contrato
> intacto. Además, derived_snapshots_source_immutable_trg era el único
> create trigger del archivo sin drop if exists, lo que hacía fallar todo
> redespliegue."

El comentario que quedó en el propio esquema tras el fix, en el cuerpo de
`statsedge_published_result_set_sealed_v1` (`schema.sql:1043-1053`):

> "SECURITY DEFINER (not invoker): this trigger fires on every insert/update
> of owner_id on public.scans, including the ordinary legacy upsert that
> writeMaterializedScan performs over PostgREST as service_role. [...] As
> `security invoker` this function inherited that restriction and broke
> every legacy write the instant this schema reached production."

Es decir: el 29-30 de julio de 2026, el trigger `scans_published_result_set_sealed_trg`
(que dispara en **todo** insert/update de `owner_id` o `published_result_set_id`
sobre `public.scans` — `schema.sql:1075-1078`, `before insert or update of
published_result_set_id, owner_id on public.scans`) empezó a bloquear la
escritura legacy ordinaria (`writeMaterializedScan`) y los crons, aunque
nadie estaba usando ninguna RPC de Hito 1B. El fix (`01d9945`) cambió ese
trigger a `security definer`.

Documentado además, como hallazgo relacionado no corregido en el mismo fix,
en `docs/note-hito-1b1-rpc-service-role-inaccesible-2026-07-30.md` (citado
íntegro en A.1): el mismo patrón de fondo deja las 9 RPC de escritura
inaccesibles para `service_role`, pero ahí la nota aclara que **eso es
intencional y no es un bug** — a diferencia del trigger, que sí lo fue.

No encontré ningún otro documento de incidente relacionado con este grupo
(`docs/note-scan-coverage-breakdown-parity-failure-2026-07-24.md` es sobre
`scan_coverage_breakdown`, una RPC distinta y no relacionada).

### B.7 — ¿Se reaplica el esquema en cada `npm run supabase:schema`?

Sí, íntegramente. El script (`scripts/supabase-admin.mjs:308-339`):

```js
async function schemaCommand(config) {
  ...
  const sql = fs.readFileSync(SCHEMA_PATH, "utf8").trim();
  ...
  console.log("Ejecutando supabase/schema.sql mediante Supabase Management API...");
  let result = await managementRequest(config, "/database/query", { query: sql });
  ...
}
```

Lee `supabase/schema.sql` completo (las 4020 líneas, incluido el 53.6% de
este grupo) y lo ejecuta contra producción vía la Management API en una sola
llamada. El riesgo que esto introduce es exactamente el que se materializó
en B.6: el archivo es idempotente en su mayoría (`create table if not
exists`, `create or replace function`, `drop trigger if exists` + `create
trigger`), pero el incidente de julio ocurrió precisamente porque **un**
`create trigger` no tenía su `drop trigger if exists` correspondiente antes
del fix, y porque una función invocada por un trigger que se ejecuta en
cualquier escritura legacy tenía un modificador de seguridad incompatible
con el contrato de revocación del propio grupo. El test
`tests/integration/schema-parity.real.test.mjs` (que sí pasa, verificado en
B.5) existe explícitamente para detectar esta clase de regresión antes del
próximo `npm run supabase:schema`, pero solo corre bajo
`test:integration:ephemeral`, no en el flujo estándar.

---

## PARTE C — Datos reales

Las cuatro tablas indicadas existen (no hubo error de "tabla no encontrada")
y están vacías. Consultas ejecutadas vía `supabase_query` (PostgREST,
solo lectura, tope 200 filas) y resultado íntegro de cada una:

```
table=scan_executions      select=id,owner_id,scan_id,state,created_at,updated_at   limit=200  → []
table=scan_result_sets     select=id,owner_id,scan_id,execution_id,state,integrity_class,created_at  limit=200  → []
table=scan_work_items      select=result_set_id,scan_id,owner_id,outcome,created_at  limit=200  → []
table=scan_result_set_rows select=result_set_id,scan_id,owner_id,created_at          limit=200  → []
```

**Las cuatro tablas tienen 0 filas en producción.** Esto es consistente con
el hecho ya verificado de que las 9 RPC de escritura no tienen `EXECUTE`
concedido a ningún rol (A.2) — no hay ningún camino, ni de aplicación ni de
prueba manual contra producción, por el que una fila pudiera haber entrado.

### C.9 — Origen de las filas (si las hubiera)

No aplica: no hay filas que explicar. No se puede afirmar ni descartar que
en algún momento pasado hubiera habido filas de prueba manual borradas
después — no hay forma de comprobar eso con una consulta de solo lectura
sobre el estado actual, y no lo infiero.

---

## PARTE D — Estado de la conexión

### D.10 — Qué falta para conectarlo

**Escritor (`lib/materializedScanner.js:1607-1641`, `writeMaterializedScan`).**
Hoy hace exactamente esto (cita literal):

```js
export async function writeMaterializedScan(scan = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, saved: false, ...disabledPayload() };
  const rows = Array.isArray(scan.rows) ? scan.rows : [];
  const [saved] = await supabaseRequest("scans", {
    method: "POST",
    query: "on_conflict=owner_id,local_id",
    prefer: "resolution=merge-duplicates,return=representation",
    body: [{ ... }],
  });
  await supabaseRequest("scan_results", { method: "DELETE", query: `scan_id=eq.${encodeURIComponent(saved.id)}` });
  for (let i = 0; i < rows.length; i += 300) {
    await supabaseRequest("scan_results", { method: "POST", prefer: "return=minimal", body: rows.slice(i, i + 300).map(...) });
  }
  ...
}
```

Es un `POST` (upsert) sobre `scans` + un `DELETE`/`POST` en lotes de 300
sobre `scan_results`, todo por PostgREST directo, sin ninguna noción de
`execution_id`, `lease_epoch` ni `work_index`. Conectarlo al grupo Hito 1B
exigiría sustituir este flujo por: `begin_scan_execution` (una llamada) →
`register_scan_work_item` + `persist_scan_result` + `complete_scan_work_item`
(una terna por fila, o repensar el contrato para lotes) →
`finalize_scan_execution` (una llamada). **Esto es un rediseño, no un
cambio acotado**: cambia la unidad de escritura de "un batch" a "una
ejecución con estado por fila", y cambia el modelo de llamadas de 2-3
requests HTTP a `2 + 3N` (siendo N el número de filas) salvo que se
diseñe alguna forma de agrupar `register`/`persist`/`complete` — ninguna de
las 9 RPC acepta arrays de filas en una sola llamada (todas sus firmas
tienen `p_work_index integer` singular, no `integer[]`).

**Permisos.** Las 9 RPC de escritura tienen `EXECUTE` revocado de
`service_role` de forma deliberada (A.2). Para conectarlas, la propia nota
de seguimiento (`docs/note-hito-1b1-rpc-service-role-inaccesible-2026-07-30.md`)
ya deja dicho que esto requiere una decisión explícita, no un flag:

> "Cualquiera de los dos caminos de arriba la rompe a propósito, y
> actualizarla debe ser una **decisión explícita y deliberada de quien
> conecte estas RPC** — revisada como tal, con su propio razonamiento
> documentado en ese momento — nunca un cambio incidental o un ajuste
> automático para que la suite vuelva a pasar."

Las dos opciones que la propia nota deja abiertas (`security definer` en las
RPC de entrada, o `grant execute` acotado a `service_role`) son, en sí
mismas, cambios acotados una vez decididos — el coste no está en el SQL del
grant, está en la decisión de seguridad y en actualizar la aserción de test
que hoy exige `EXECUTE = false` para `service_role`
(`tests/integration/scan-execution-lifecycle.real.test.mjs:213-234`, según
la propia nota).

**Lector (`lib/leaderboards.js:713-742`, `readScanRows`).** Hoy llama a
`leaderboard_publishable_rows`, una RPC no relacionada con este grupo que
filtra por `settings.progress.status` de `scans` (hecho ya verificado en el
enunciado). Conectar el lector al Hito 1B significaría sustituir esa llamada
por `read_published_scan_result_set_v1`, que **ya tiene `EXECUTE` concedido
a `service_role`** (A.2) — a diferencia del escritor, aquí no hay barrera de
permisos que salvar hoy. Sin embargo, el contrato de retorno es
estructuralmente distinto: `leaderboard_publishable_rows` devuelve
`{rows, rowsRead, rowsPublished, rowsExcluded}` en una sola llamada;
`read_published_scan_result_set_v1` devuelve un objeto paginado
(`rows`, `has_more`, `next_cursor` con `result_set_id`/`set_hash`/
`after_work_index` — `schema.sql:2108-2114`) atado a un único `scan_id` por
llamada, no a "todos los scans publicables del owner". Adaptar
`readScanRows` a esa forma es **un cambio acotado en el shape de datos pero
no trivial en el flujo**: hoy `readScanRows` agrega filas de N scans en una
sola pasada; el lector 1B-3 solo sabe leer un scan concreto por llamada, así
que haría falta iterar sobre los scans candidatos primero (con qué criterio,
no está resuelto en el código actual).

### D.11 — Trabajo a medio hacer

No encontré ninguno. Verificación explícita:

```
git log --oneline HEAD..codex/scan-integrity-result-sets            → 0 commits
git log --oneline HEAD..nightly/camino-a-audit-retry-20260725-...   → 0 commits
git log --oneline HEAD..nightly/camino-a-audit-retry2-20260727-...  → 0 commits
grep -rn "TODO" lib/materializedScanner.js lib/leaderboards.js app/api/scan/route.js
  | grep -i "scan_execution\|result_set\|hito"                       → sin coincidencias
```

La rama `codex/scan-integrity-result-sets`, que en la auditoría del 25-jul
todavía contenía trabajo no fusionado (ver A.1), hoy está **completamente
fusionada**: sus tres commits relevantes (`5dbb62c`, `3ab49df`, `93929ce`,
más el fix posterior `01d9945` y la nota `3851e44`) son todos ancestros del
HEAD actual. No hay commits exclusivos de esa rama pendientes de traer. No
encontré ningún TODO, comentario `FIXME`, ni rama activa que sugiera un
intento a medias de conectar el escritor o el lector — el propio código de
`writeMaterializedScan` y `readScanRows` no menciona `scan_execution` ni
`result_set` en absoluto.

---

## PARTE E — Respuesta

**Qué es.** El Hito 1B es una infraestructura de base de datos completa
(4 tablas, 10 funciones RPC/lector y 11 helpers internos, repartidos en tres
sub-hitos — 1B-1 lease/ledger, 1B-2 finalización/publicación atómica, 1B-3
lectura publicada) construida para reemplazar el escritor legacy actual
(`writeMaterializedScan`: un upsert + delete/insert por lotes sobre
`scans`/`scan_results` vía PostgREST, sin garantía transaccional de extremo
a extremo) por un ciclo de vida con fencing de lease, idempotencia por
ejecución, y un manifiesto con hash canónico verificado antes de mover el
puntero público de un scan. No hay un ADR que lo declare así explícitamente
— esa lectura del propósito se reconstruye a partir de los comentarios
inline del esquema y de las migraciones, todos citados arriba. El diseño
está terminado en el sentido de que compila, tiene 4 migraciones aplicadas
en `schema.sql`, y su propia suite de comportamiento (28 tests contra
Postgres real) pasa hoy sin fallos.

**Qué cuesta hoy tenerlo dormido.** Ocupa el 53.6% de `supabase/schema.sql`
(2156 de 4020 líneas) y el 57.2% de `supabase/migrations/` (2188 de 3825
líneas), y ese volumen completo se reaplica contra producción en cada `npm
run supabase:schema`. Ya causó un incidente de producción real (permission
denied en toda escritura legacy a `scans`, incluidos los crons, el 29-30 de
julio de 2026) porque un trigger que dispara en cualquier escritura a
`scans` —no solo en las suyas propias— quedó con un modificador de
seguridad incompatible con el contrato de revocación del propio grupo; ya
está corregido, pero el mecanismo que lo causó (un trigger global sobre una
tabla compartida con el camino legacy) sigue existiendo y sigue siendo una
superficie donde un futuro cambio al grupo puede volver a romper el camino
legacy sin que nadie esté tocando ese camino. El test que detecta esta clase
de regresión (`schema-parity.real.test.mjs`) existe y pasa, pero no corre en
`npm test` por defecto — solo bajo un harness manual con Postgres efímero.
El único test que sí corre por defecto (`scanResultSetFoundationContracts.test.js`)
no ejecuta SQL: compara texto contra el propio archivo fuente, así que no
detectaría una regresión de comportamiento, solo una regresión textual.

**Qué costaría conectarlo o retirarlo.** Conectar el escritor es un
rediseño, no un ajuste: pasar de 2-3 llamadas HTTP por scan a un ciclo
begin→register→persist→complete→finalize sin soporte de lote en ninguna de
las 9 RPC (cada una opera sobre un `work_index` singular), más la decisión
de seguridad explícita —ya señalada por escrito en la nota del 30-jul como
"no un ajuste incidental"— de conceder `EXECUTE` a `service_role` sobre las
RPC de entrada. Conectar el lector es más acotado en el sentido de que ya
tiene permisos concedidos, pero exige adaptar `readScanRows` de "todas las
filas publicables de N scans en una llamada" a "una página de un scan por
llamada" con paginación por cursor, lo cual no está resuelto en el código
actual. Retirarlo significaría borrar ~2150 líneas de esquema, 4 migraciones
y ~2300 líneas de test, sin que ningún dato de producción se pierda (las
cuatro tablas están vacías, verificado en C). En ningún caso hay trabajo a
medio hacer que decante la balanza: la rama donde se construyó está
íntegramente fusionada y no hay TODOs ni intentos de conexión parcial en el
código vivo.

---

## CONFIANZA

**Verificado leyendo código (alta confianza):**
- Las 4 tablas y las 10 RPC/lector existen en `supabase/schema.sql` con las
  firmas y modificadores de seguridad citados.
- Las 9 RPC de escritura no tienen `grant execute` a ningún rol; el lector
  1B-3 sí lo tiene a `service_role` desde el commit que reconstruye Hito
  1B-3 (comentario "DECISION DE DISENO (2026-07-23)").
- `writeMaterializedScan` y `readScanRows` no invocan ninguna función de
  este grupo hoy.
- El test que corre en `npm test` por defecto (`scanResultSetFoundationContracts.test.js`)
  es comparación textual sobre el SQL fuente, no ejecución de SQL.
- `vitest.config.mjs` excluye explícitamente `tests/integration/**/*.test.mjs`
  del comando `npm test`.
- El commit `01d9945` documenta el incidente de producción y su causa exacta.
- La rama `codex/scan-integrity-result-sets` está íntegramente fusionada en
  `HEAD` (0 commits exclusivos en ninguna dirección relevante).
- Conteo de líneas de esquema/migraciones dedicadas al grupo (53.6% y 57.2%
  respectivamente).

**Verificado consultando datos (alta confianza, vía `supabase_query` de solo
lectura contra producción):**
- `scan_executions`, `scan_result_sets`, `scan_work_items` y
  `scan_result_set_rows` tienen 0 filas en producción, a fecha de esta
  consulta.

**Verificado ejecutando código (alta confianza, local, no producción):**
- La suite `test:integration:ephemeral` (8 archivos, incluidos los 5 del
  grupo) pasa 28/28 contra un Postgres 16.x efímero local, en 4512.3ms de
  ejecución reportada por `node --test`. Esto no dice nada sobre si pasaría
  igual contra la configuración real de producción — solo confirma que el
  comportamiento declarado por las RPC es internamente consistente hoy.

**Inferido, no citado literalmente (confianza media, marcado también en el
cuerpo del documento):**
- Que el problema concreto que este grupo resuelve es la falta de garantía
  transaccional de `writeMaterializedScan` frente a lecturas concurrentes.
  Ningún documento lo dice en esos términos exactos; es una lectura
  razonada del código y de los comentarios de "never mutates scan_results
  legacy" / "no legacy fallback".
- Que `owner_id` en este grupo es un mecanismo de coherencia interna y no
  una frontera de aislamiento de tenant. Se apoya en la ausencia de
  políticas RLS confirmada por `docs/audit-tenancy-gate-verificacion-2026-07-25.md`,
  pero esa ausencia no es, por sí sola, una declaración de intención de
  diseño.

**No se pudo cerrar:**
- Si alguna vez hubo filas de prueba manual en estas cuatro tablas que
  luego se borraran. Una consulta de solo lectura sobre el estado actual no
  puede responder eso, y no hay ningún log de auditoría al que se me haya
  dado acceso para comprobarlo.
- El tiempo exacto que tardaría `npm run supabase:schema` contra producción
  real (el tiempo medido en B.5 es de la suite de tests contra Postgres
  local efímero, no de una aplicación de esquema completa vía Management
  API).
