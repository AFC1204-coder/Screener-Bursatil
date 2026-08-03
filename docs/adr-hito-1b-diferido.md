# ADR — Aparcar el Hito 1B (scan_executions / scan_result_sets) en esquema diferido

- **Estado:** aceptado
- **Fecha:** 2026-08-03
- **Rama de análisis:** `codex/statsedge-ui-polish` @ `4f32781`
- **Cambio material que documenta:** el bloque de `supabase/schema.sql:45-2202`
  (2158 líneas) ya se movió, sin comitear, a `supabase/deferred/hito-1b.sql`.
  Este ADR es la trazabilidad de esa decisión, no la decisión misma — la
  decisión de negocio ya está tomada; ver `docs/hito-1b-estado-2026-08-03.md`
  para el inventario completo en el que se apoya.
- **Este ADR NO autoriza:** ningún `DROP`, `ALTER` ni redespliegue de esquema
  contra producción. El movimiento documentado aquí solo tocó el working tree
  local; producción sigue teniendo el bloque completo aplicado.

## 1. Contexto

El Hito 1B es una infraestructura de base de datos (4 tablas propias —
`scan_executions`, `scan_result_sets`, `scan_work_items`,
`scan_result_set_rows` — más 10 RPC de ciclo de vida y 11 helpers internos,
repartida en tres sub-hitos 1B-1/1B-2/1B-3 sobre una base 1A) construida para
sustituir el escritor legacy actual (`writeMaterializedScan`: un `POST`
seguido de `DELETE`/`POST` por lotes sobre `scans`/`scan_results` vía
PostgREST, sin ninguna garantía transaccional de extremo a extremo) por un
ciclo `begin_scan_execution → register_scan_work_item → persist_scan_result →
complete_scan_work_item → finalize_scan_execution` con **lease fencing**,
**idempotencia** por ejecución y un **manifiesto con hash canónico**
verificado antes de mover el puntero público de un scan.

No existe un ADR previo que declare este propósito explícitamente — se
reconstruye a partir de los comentarios inline del propio esquema, citados
literalmente en `docs/hito-1b-estado-2026-08-03.md` §A.3:

> "Fencing de lease contra ejecuciones concurrentes del mismo scan
> (`schema.sql:603-605`) [...] 'The advisory key is held before these row
> locks. Re-read every linked record after acquiring it; callers must never
> trust pre-lock state.'"
> — `docs/hito-1b-estado-2026-08-03.md:173-177`

> "Bloqueo advisory no bloqueante, diseñado para evitar deadlocks entre
> triggers y escritores [...] 'This deliberately never waits. [...]
> Contention is an explicit, retryable failure instead.'"
> — `docs/hito-1b-estado-2026-08-03.md:178-183`

> "Idempotencia de reintentos de un mismo `begin_scan_execution` [...]
> 'Every 1B-1 writer and both published-pointer barriers serialize on this
> transaction-scoped key before trusting any result-set state.'"
> — `docs/hito-1b-estado-2026-08-03.md:184-189`

Se construyó entre el **17 y el 20 de julio de 2026**, en cuatro migraciones
fechadas por su propio nombre de archivo (`supabase/migrations/`):
`20260717100000_scan_result_sets_foundation.sql` (1A),
`20260717110000_scan_execution_lease_ledger.sql` (1B-1),
`20260719100000_scan_result_set_finalize_publish.sql` (1B-2) y
`20260720100000_published_scan_result_read.sql` (1B-3) — inventario en
`docs/hito-1b-estado-2026-08-03.md:257-267`. El lector 1B-3 se reconstruyó y
rediseñó a `security definer` el 22-23 de julio (comentario "RECONSTRUCCION
AUDITADA (2026-07-22)" / "DECISION DE DISENO (2026-07-23)" en
`supabase/schema.sql`, citado en `docs/hito-1b-estado-2026-08-03.md:1676-1696`
antes del movimiento).

## 2. Situación al decidir

Hechos verificados, con archivo:línea:

- El bloque ocupaba **2156 de 4020 líneas de `supabase/schema.sql` (53.6%)**
  antes de moverlo — `docs/hito-1b-estado-2026-08-03.md:249` ("Suma:
  ... = **2156 líneas**, sobre 4020 totales = **53.6% del esquema**.").
- **Las cuatro tablas propias del grupo estaban vacías en producción**:
  `scan_executions`, `scan_result_sets`, `scan_work_items` y
  `scan_result_set_rows` devolvieron `[]` en las cuatro consultas de solo
  lectura ejecutadas vía `supabase_query` — `docs/hito-1b-estado-2026-08-03.md:457-464`.
  Nunca se ejecutó una sola vez en producción.
- **Cero filas con `published_result_set_id` o `active_result_set_id` no
  nulos** en `public.scans`. Reverificado en el momento de escribir este ADR
  (`supabase_query` sobre `scans`, `select=id,published_state,
  published_result_set_id,active_result_set_id,active_execution_id`,
  `limit=200`): las 58 filas existentes tienen `published_state:
  "legacy_unknown"` y `published_result_set_id`, `active_result_set_id`,
  `active_execution_id` en `null`, sin ninguna excepción.
- **Nueve de las diez RPC tienen `revoke all` sin ningún `grant execute` a
  `service_role`** (las de escritura: `begin_scan_execution`,
  `resume_scan_execution`, `takeover_scan_execution`,
  `register_scan_work_item`, `persist_scan_result`,
  `complete_scan_work_item`, `checkpoint_scan_execution`,
  `abandon_scan_execution`, `finalize_scan_execution`) —
  `docs/hito-1b-estado-2026-08-03.md:137-140`: "Ninguna tiene `grant execute`
  a ningún rol." La décima, `read_published_scan_result_set_v1`, sí lo tiene
  desde el 23-jul (`docs/hito-1b-estado-2026-08-03.md:141-148`).
- **`npm run supabase:schema` reaplica el archivo entero contra producción en
  cada ejecución**: `scripts/supabase-admin.mjs:308-339` lee
  `supabase/schema.sql` completo y lo manda en una sola llamada a la
  Management API (`/database/query`) — `docs/hito-1b-estado-2026-08-03.md:421-431`.
- **Incidente de producción del 29-30 de julio de 2026**: un redespliegue del
  esquema tumbó todas las escrituras a `scans`, incluidos los crons, porque
  un trigger que dispara en *cualquier* insert/update de `scans.owner_id`
  (`scans_published_result_set_sealed_trg`, no solo en escrituras del propio
  grupo) llamaba a un helper con `EXECUTE` revocado a `service_role`. Mensaje
  de commit del fix, literal (`git log -1 01d9945 --format=%B`, citado en
  `docs/hito-1b-estado-2026-08-03.md:384-390`):
  > "El trigger llamaba a statsedge_lock_result_sets_v1 como invoker, y esa
  > función tiene EXECUTE revocado a service_role por el contrato de Hito
  > 1B-1: cualquier escritura en scans vía PostgREST fallaba con permission
  > denied, incluidos los crons."

## 3. Decisión

**Se aparta el bloque del esquema activo; no se elimina.** El contenido
completo (tablas, RPC, helpers, triggers, comentarios de diseño) se movió sin
editar una sola línea de SQL a `supabase/deferred/hito-1b.sql`
(`supabase/deferred/hito-1b.sql:1-2239`, cabecera propia en las líneas 1-81).

La diferencia entre "aparcar" y las otras dos opciones (ver §5) es operativa,
no cosmética:

- **Aparcar** saca el bloque de la ruta que se reaplica automáticamente
  contra producción en cada `npm run supabase:schema`
  (`scripts/supabase-admin.mjs:308-339`), pero conserva el diseño, el
  historial de decisiones documentado en sus propios comentarios (lease
  fencing, manifiesto de hash, ACL `security definer` del lector) y la
  posibilidad de reaplicarlo tal cual sobre la misma base de datos el día que
  haga falta. Verificado en este mismo ciclo de trabajo: el archivo diferido
  se aplicó sin errores sobre un Postgres 16 efímero local, tanto solo como
  encima del `schema.sql` reducido ya desplegado.
- **Conectarlo** (activar su uso en `writeMaterializedScan`/`readScanRows`)
  habría exigido resolver primero un problema que no existe hoy (§4) y tomar
  una decisión de seguridad explícita sobre permisos (§7) — coste real, sin
  beneficio real que lo justifique ahora.
- **Retirarlo del todo** habría destruido ~2150 líneas de diseño ya revisado
  y probado (28/28 tests de comportamiento reales pasan hoy,
  `docs/hito-1b-estado-2026-08-03.md:330-335`) para un problema que sí podría
  existir en el futuro (§6), obligando a rediseñarlo desde cero si ese día
  llega.

Se eligió aparcar porque el coste de mantenerlo vivo en el esquema activo es
real y medible hoy (§4), pero el coste de haberlo construido ya está pagado
y no se recupera borrándolo.

## 4. Razones

**El problema que resuelve no existe hoy.** El diseño entero gira en torno a
arbitrar ejecutores concurrentes del mismo scan — lease epoch, bloqueo
advisory no bloqueante, reconciliación física antes de publicar. StatsEdge
opera hoy con:

- Un único `owner_id` de escritura (`DEFAULT_OWNER = "personal"` en
  `lib/supabaseServer.js`, con fallback a `STATSEDGE_OWNER_ID` — el mismo
  hecho que documenta `docs/audit-tenancy-gate-verificacion-2026-07-25.md`
  §C2: "El owner de persistencia sigue procediendo exclusivamente de una
  variable de entorno global").
- Crons en serie, una ejecución de scan materializado por noche — no hay hoy
  ningún segundo ejecutor que pueda competir por el mismo `scan_id`.
- Cero usuarios concurrentes sobre el mismo scan.

Sin un segundo ejecutor, el fencing de lease no tiene nada que arbitrar: es
maquinaria de seguridad para una condición de carrera que no puede ocurrir en
la topología operativa actual.

**El coste, en cambio, sí existe hoy, y es de tres tipos:**

1. **Riesgo en cada redespliegue.** El incidente del 29-30 de julio (§2) no
   fue causado por nadie usando el Hito 1B — fue causado por su sola
   *presencia* en el esquema que se reaplica en cada `npm run
   supabase:schema`. Ese vector de riesgo (un trigger o un `grant`/`revoke`
   de este grupo interfiriendo con una escritura legacy que no lo invoca) es
   estructural mientras el bloque siga en `schema.sql`, no depende de que se
   conecte.
2. **Mitad del esquema en cada revisión.** El 53.6% de `schema.sql` (§2) es
   superficie que cualquiera que audite el esquema activo — permisos, RLS,
   triggers sobre `scans`/`scan_results` — tiene que leer y entender, para
   una funcionalidad con cero filas en producción.
3. **Carga cognitiva en cada investigación que tropieza con él.** El propio
   origen de este ADR es una investigación (`docs/hito-1b-estado-2026-08-03.md`)
   disparada por encontrar este bloque sin saber qué era; la nota
   `docs/note-hito-1b1-rpc-service-role-inaccesible-2026-07-30.md` documenta
   un segundo caso del mismo patrón: alguien investigando un incidente no
   relacionado tropieza con esta superficie y tiene que pararse a entenderla
   antes de poder seguir.

## 5. Qué se descartó y por qué

**Conectarlo ahora.** Implicaba, según el inventario ya hecho en
`docs/hito-1b-estado-2026-08-03.md` §D.10:

- Reescribir `writeMaterializedScan` como un rediseño, no un ajuste: ninguna
  de las 9 RPC de escritura acepta arrays de filas (todas tienen
  `p_work_index integer` singular), así que pasar de "un lote" a "un ciclo
  begin→register→persist→complete→finalize" cambia el modelo de llamadas de
  2-3 requests HTTP a `2 + 3N` por scan.
- Tomar una decisión de seguridad explícita y deliberada sobre permisos —no
  un flag— para que `service_role` pueda ejecutar las RPC de entrada, tal
  como exige textualmente la nota del 30-jul (`docs/note-hito-1b1-rpc-service-role-inaccesible-2026-07-30.md:77-85`):
  > "Cualquiera de los dos caminos de arriba la rompe a propósito, y
  > actualizarla debe ser una decisión explícita y deliberada de quien
  > conecte estas RPC [...] nunca un cambio incidental o un ajuste automático
  > para que la suite vuelva a pasar."
- Adaptar `readScanRows` de "todas las filas publicables de N scans en una
  llamada" a "una página de un scan por llamada" con cursor — un cambio de
  forma de datos no resuelto en el código actual.

Se descartó porque el problema que esa reescritura resolvería (§4) no existe
todavía: el coste de conectar hoy no compra ninguna garantía que la
topología actual necesite.

**Retirarlo del todo (borrar tablas, RPC, migraciones y tests).** Implicaba
perder ~2150 líneas de esquema ya revisado, 4 migraciones y ~2300 líneas de
test que hoy pasan (28/28 comportamiento real,
`docs/hito-1b-estado-2026-08-03.md:330-335`), sin que ninguna fila de
producción se perdiera (las cuatro tablas están vacías, §2) pero sí
perdiendo el trabajo de diseño en sí — el análisis de qué invariantes hacen
falta para arbitrar ejecutores concurrentes de forma segura no es trivial de
rehacer, y no hay ninguna urgencia de espacio o mantenimiento que lo exija
hoy: aparcado, su coste operativo (§4.1) desaparece igual que si se borrara,
sin pagar el coste de rehacerlo si el problema real llega.

## 6. Cuándo reactivarlo

No "cuando haya más usuarios" — señales concretas y observables, cualquiera
de las cuales bastaría para reabrir esta decisión:

1. **Más de un `owner_id` real escribiendo scans.** Hoy `STATSEDGE_OWNER_ID`
   es una única variable de entorno global (`lib/supabaseServer.js:13`,
   citada en `docs/audit-tenancy-gate-verificacion-2026-07-25.md:112-113`).
   La señal medible: que exista una segunda identidad autoritativa por
   request (no una variable de entorno compartida) escribiendo en `scans`
   con un `owner_id` distinto de forma simultánea con la primera.
2. **Ejecuciones solapadas del mismo `scan_id`** — dos invocaciones de
   `writeMaterializedScan` (o su sucesor) corriendo a la vez sobre el mismo
   scan, detectable como dos procesos con el mismo `scan_id` activo en la
   misma ventana de tiempo (hoy estructuralmente imposible: "una ejecución
   por noche", §4).
3. **Escrituras parciales observadas en producción**: un `scan_results` con
   `scan_id` cuyo conteo de filas no coincide con `row_count` en `scans`, o
   una lectura que sorprenda a `writeMaterializedScan` a mitad de su
   `DELETE`/`POST` en lotes de 300 (`lib/materializedScanner.js:1628-1638`,
   citado en `docs/hito-1b-estado-2026-08-03.md:485-500`) — hoy no hay
   ningún lector concurrente que pueda observar ese estado intermedio.
4. **Concurrencia real entre el cron y una ruta interactiva** escribiendo el
   mismo `scan_id` — por ejemplo, si `/api/scan` (uso interactivo) empezara a
   permitir re-ejecutar un scan que el cron materializado también pudiera
   tocar al mismo tiempo.

Cualquiera de estas cuatro condiciones es, por definición, el escenario que
Hito 1B fue diseñado para arbitrar (§1) y que hoy no puede ocurrir (§4). La
condición de tenancy (señal 1) coincide además con el criterio ya fijado en
`docs/audit-tenancy-gate-verificacion-2026-07-25.md` para el Hito 2 de
aislamiento multi-tenant — este ADR no reabre esa decisión, solo observa que
comparten la misma señal de entrada.

## 7. Cómo reactivarlo

Pasos ya inventariados en `docs/hito-1b-estado-2026-08-03.md` §D.10 y
repetidos en la cabecera de `supabase/deferred/hito-1b.sql:50-77`:

1. Aplicar `supabase/deferred/hito-1b.sql` completo **después** de
   `supabase/schema.sql` sobre la misma base de datos — depende de
   `public.scans`, `public.scan_results` (tablas base activas) y de la
   extensión `pgcrypto` (`supabase/schema.sql:4`), todas ya presentes en el
   esquema activo. Verificado: se aplica sin errores tanto sobre una base
   vacía como sobre una ya migrada con el `schema.sql` reducido.
2. Decidir el cambio de permisos pendiente: `security definer` en las RPC de
   entrada, o un `grant execute` acotado a `service_role` — decisión de
   seguridad explícita, no un flag (§5, cita de
   `docs/note-hito-1b1-rpc-service-role-inaccesible-2026-07-30.md:66-76`).
3. Rediseñar `lib/materializedScanner.js` (`writeMaterializedScan`): pasar de
   `POST`/`DELETE` por lotes a un ciclo `begin_scan_execution →
   register_scan_work_item/persist_scan_result/complete_scan_work_item` (por
   fila, sin soporte de array en ninguna firma) → `finalize_scan_execution`.
4. Adaptar `lib/leaderboards.js` (`readScanRows`) de "todas las filas
   publicables de N scans en una llamada" (`leaderboard_publishable_rows`) a
   "una página de un scan por llamada" con cursor
   (`read_published_scan_result_set_v1`) — esta RPC ya tiene `EXECUTE`
   concedido a `service_role`, no requiere el cambio de permisos del punto 2.
5. Reincorporar el bloque a `supabase/schema.sql` (o a una migración
   explícita) una vez tomada la decisión del punto 2, para que vuelva a
   reaplicarse en `npm run supabase:schema`.
6. Reapuntar la suite `tests/integration/*result-set*.real.test.mjs` y
   `scan-execution-lifecycle.real.test.mjs` al esquema reincorporado (hoy
   siguen pasando sin cambios porque bootstrapean desde un commit de git
   congelado más `supabase/migrations/`, no desde el `schema.sql` vivo — ver
   §8).

## 8. Pendiente sin resolver

Al mover el bloque, `tests/integration/_ephemeralPostgresHarness.mjs:74`
declara una constante `REVIEWED_BOOTSTRAP_SOURCE_DIGEST` — un SHA-256 fijado
a mano que exige revisión humana explícita cada vez que `supabase/schema.sql`
cambia de verdad. Tras este movimiento, esa constante quedó desactualizada a
propósito (no se tocó en este ciclo de trabajo), y eso hace fallar dos
mecanismos relacionados pero distintos, ambos en la suite
`test:integration:ephemeral` (no en `npm test`, que sigue en verde):

- `bootstrap-control.contract.test.mjs`: el gate del digest en sí
  (`assertCurrentBootstrapSourceDigest`, `_ephemeralPostgresHarness.mjs:792-802`)
  y dos pruebas que dependen de él.
- `schema-parity.real.test.mjs`: la comparación "bootstrap `schema.sql` ==
  base + migraciones reproducidas" ya no puede ser cierta a propósito —
  `supabase/migrations/` conserva las cuatro migraciones del grupo (decisión
  explícita de este mismo ciclo de trabajo: son DDL ya aplicado en
  producción, no se reescribe la historia moviéndolas), mientras el
  bootstrap activo (`schema.sql`) ya no las refleja. El mecanismo de
  paridad está haciendo exactamente su trabajo — detectar una divergencia
  real entre `schema.sql` y `supabase/migrations/` — pero esa divergencia es
  ahora intencional, no un defecto.

Ninguno de los dos problemas se resuelve en este ADR. Actualizar el digest
sin más dejaría pasar la comparación de bytes pero no resuelve la pregunta de
fondo: **¿qué debe significar "paridad" cuando una migración queda
deliberadamente diferida y ya no forma parte del bootstrap que se despliega?**
Esa es una decisión de diseño del propio harness de pruebas, separada de la
decisión de negocio que documenta este ADR, y queda explícitamente abierta.
