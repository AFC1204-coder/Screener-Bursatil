# Auditoría del gate no-go de tenancy (Hito 2) — 2026-07-24

## Dictamen

**NO-GO. No se puede permitir un segundo usuario.**

Checkout auditado:

- Worktree: `/tmp/tenancy-audit`
- Rama: `codex/statsedge-ui-polish`
- HEAD: `a8abc2f4755987540695b098b895dafa5504a056`
- Estado inicial: limpio

La auditoría es estática y de solo lectura. No se ejecutaron tests, SQL,
Supabase, Data API, servidor Next.js, jobs, navegador ni llamadas externas.

Para evitar invertir semánticamente el gate, las condiciones 3 y 6 se expresan
abajo como predicados de riesgo:

- C3: «falta una prueba aprobatoria con dos usuarios reales».
- C6: «falta una prueba de borrado íntegro sin afectar al otro usuario».

Esos son los predicados que deben ser falsos, igual que los riesgos de las
demás condiciones.

| # | Predicado de no-go evaluado | Conclusión | Gate |
|---|---|---|---|
| 1 | Alguna ruta usa la credencial `service_role` | **CONFIRMADO VERDADERO** | Bloquea |
| 2 | Algún owner/tenant procede de body, query o header del cliente | **CONFIRMADO FALSO** | No bloquea por IDOR de entrada; existe un bloqueo independiente de identidad global |
| 3 | Falta una prueba aprobatoria con dos usuarios reales, Data API cliente y API de aplicación | **CONFIRMADO VERDADERO** | Bloquea |
| 4 | Alguna tabla interna es alcanzable con credenciales cliente | **NO VERIFICABLE ESTÁTICAMENTE** | Bloquea hasta prueba live |
| 5 | `legacy_unknown` puede alcanzar rutas de producto | **CONFIRMADO VERDADERO** | Bloquea |
| 6 | Falta probar borrado íntegro de un usuario sin afectar al otro | **CONFIRMADO VERDADERO** | Bloquea |

Resultado: cuatro riesgos confirmados, uno no verificable estáticamente y solo
uno confirmado falso en su sentido estricto. Además, el repositorio no tiene
una identidad de tenant por usuario: usa un único `STATSEDGE_OWNER_ID`.

## 1. Uso de `SUPABASE_SERVICE_ROLE_KEY` desde `app/api`

### Conclusión: CONFIRMADO VERDADERO

El helper de persistencia lee la clave en
`lib/supabaseServer.js:10-17`. Todas las operaciones REST/RPC pasan esa clave
como `apikey` y como `Authorization: Bearer` en
`lib/supabaseServer.js:41-65`; el camino de conteo repite el mismo patrón en
`lib/supabaseServer.js:114-138`.

Por tanto, una ruta no necesita mencionar literalmente la variable para usarla:
basta con que llame a `supabaseConfig`, `supabaseRequest`,
`supabaseRequestAll`, `supabaseCount` o `supabaseRpc`.

### Rutas con import directo del helper privilegiado

| Ruta | Línea exacta del import |
|---|---:|
| `app/api/alerts/route.js` | 1 |
| `app/api/company-brief/route.js` | 14 |
| `app/api/comparables/route.js` | 1 |
| `app/api/cron/favorite-snapshots/route.js` | 12 |
| `app/api/cron/leaderboards-refresh/route.js` | 21 |
| `app/api/cron/scan-refresh/route.js` | 9 |
| `app/api/cron/shadow-europe-refresh/route.js` | 15 |
| `app/api/cron/shadow-firds-refresh/route.js` | 41 |
| `app/api/cron/universe-refresh/route.js` | 3 |
| `app/api/favorites/route.js` | 1 |
| `app/api/favorites/snapshots/route.js` | 3 |
| `app/api/jobs/discovery-refresh/route.js` | 3 |
| `app/api/jobs/esef-refresh/route.js` | 3 |
| `app/api/jobs/jquants-refresh/route.js` | 3 |
| `app/api/jobs/leaderboards-refresh/route.js` | 3 |
| `app/api/jobs/scan-refresh/route.js` | 15 |
| `app/api/jobs/shadow-firds-refresh/route.js` | 5 |
| `app/api/jobs/shadow-price-freshness/route.js` | 8 |
| `app/api/jobs/shadow-symbol-resolve/route.js` | 12 |
| `app/api/jobs/universe-refresh/route.js` | 3 |
| `app/api/leaderboards/route.js` | 3 |
| `app/api/market-health/route.js` | 2 |
| `app/api/mvp-health/route.js` | 2 |
| `app/api/scan-coverage/route.js` | 2 |
| `app/api/scan/cancel/route.js` | 6 |
| `app/api/scan/continue/route.js` | 12 |
| `app/api/scan/route.js` | 12 |
| `app/api/scans/route.js` | 1 |
| `app/api/settings/route.js` | 1 |

La evidencia no se limita al import. Ejemplos de uso efectivo:

- `app/api/scans/route.js:357-361` invoca una RPC; `:389-401` lee
  directamente `scans` y `scan_results`.
- `app/api/scan/route.js:21-22` obtiene la configuración y `:34-62` inserta
  en `scans`.
- `app/api/comparables/route.js:54-60` lee `scans` y `:69-80` lee
  `scan_results`.
- `app/api/company-brief/route.js:754-769` lee `app_settings`,
  `:788-806` escribe por RPC y `:817-829` lee `scan_results`.
- `app/api/scan-coverage/route.js:260-272` llama
  `scan_coverage_breakdown`.

### Rutas adicionales con uso privilegiado transitivo confirmado

| Ruta | Cadena de evidencia |
|---|---|
| `app/api/chart/route.js` | `:2` importa `dailyBarsCache`; `lib/dailyBarsCache.js:3` importa el helper y `:257-270` lee `daily_bars` |
| `app/api/coverage/route.js` | `:1` importa `coveragePlan`; `lib/coveragePlan.js:4` importa el helper y `:195-211` ejecuta la RPC |
| `app/api/discovery/route.js` | `:3` importa `readScanRows`; `lib/leaderboards.js:1` importa el helper y `:713-731` ejecuta la RPC |
| `app/api/profile/route.js` | `:3` importa `fundamentalsCache`; `lib/fundamentalsCache.js:1` importa el helper y `:131-152` lee la tabla |
| `app/api/rs-weekly/route.js` | `:1` importa `globalRs`; `lib/globalRs.js:1` importa el helper y `:15-24` lee `rs_weekly_items` |
| `app/api/shadow-universe/route.js` | `:1` importa `shadowUniverse`; `lib/shadowUniverse.js:78-86` lee stores; `lib/shadowUniverseStore.js:2` importa el helper |
| `app/api/supabase/status/route.js` | `:1-5` llama el diagnóstico; `lib/supabaseDiagnostics.js:1` importa el helper y `:89-103` ejecuta los checks |
| `app/api/universe-engine/route.js` | `:1` importa `universeEngine`; `lib/universeEngine.js:1` importa el helper y `:326-340` lee snapshots |
| `app/api/universe/route.js` | `:1` importa `universeEngine`; mismo camino `lib/universeEngine.js:326-340` |

`app/api/data-providers/route.js:1-8` también llega a
`providerStatus`; este consulta si la variable está configurada porque
`lib/dataProviders.js:145-165` la declara como `envKey`. No lo contabilizo como
operación privilegiada de Data API porque esa ruta solo publica estado de
configuración y no llama a `supabaseRequest`.

La clave no aparece directamente en un archivo de ruta, pero sí alimenta todas
las llamadas anteriores. El comentario del propio esquema confirma que esta API
usa una clave que omite RLS en `supabase/schema.sql:1353-1354`.

## 2. Derivación del tenant/owner desde datos aportados por el cliente

### Conclusión: CONFIRMADO FALSO, en el sentido estricto de la pregunta

No se encontró ninguna lectura de `ownerId`, `owner_id`, `tenantId` o
`tenant_id` desde body, query param o header. El único origen de owner de la
persistencia es:

- fallback global `personal`: `lib/supabaseServer.js:4`;
- variable de entorno `STATSEDGE_OWNER_ID`: `lib/supabaseServer.js:10-17`.

Los handlers pueden leer otros identificadores del cliente, pero siempre
añaden el owner del servidor:

- `/api/scan` lee el body en `app/api/scan/route.js:23-32`, pero escribe
  `owner_id: config.ownerId` en `:34-40` y filtra GET por ese owner en
  `:83-100`.
- `/api/scans` lee scans del body en `app/api/scans/route.js:418-429`, pero
  `scanPayload` fija `owner_id` desde su argumento en `:10-28`; el caller pasa
  `config.ownerId` en `:429`.
- `/api/favorites` fija el owner en `app/api/favorites/route.js:3-13` y pasa
  `config.ownerId` en `:187-199`.
- `/api/settings` lee tipo, clave y valor del body, pero fija tanto
  `owner_id` como `p_owner_id` desde configuración en
  `app/api/settings/route.js:66-89`.
- `/api/scan/continue` acepta `scanId` y `linkToken` en
  `app/api/scan/continue/route.js:22-30`, pero todas sus lecturas, CAS y el
  runner se acotan por `config.ownerId` en `:32-73`.

### Hallazgo P0 independiente: no hay identidad multiusuario

`lib/supabaseServer.js::resolveOwner` no existe en este checkout; tampoco existe
otro resolver de tenant. `supabaseConfig()` devuelve un owner global de entorno
en `lib/supabaseServer.js:10-17`.

La autenticación tampoco produce una identidad de usuario:

- `lib/internalAuth.js:34-56` valida tokens compartidos o una cookie, y devuelve
  solo booleano.
- `lib/authSession.js:30-43` firma únicamente versión y expiración; el payload
  no contiene user id ni tenant id.
- `app/api/auth/session/route.js:49-55` intercambia un único token compartido
  por esa cookie.

Así, «no se acepta un owner del cliente» evita ese IDOR concreto, pero no
demuestra aislamiento: dos personas autenticadas por el mismo perímetro
recibirían el mismo `STATSEDGE_OWNER_ID`. Este P0 bloquea por sí mismo permitir
un segundo usuario aunque C2, interpretada literalmente, sea falsa.

## 3. Test de aislamiento con dos usuarios reales

### Conclusión: CONFIRMADO VERDADERO

Predicado de no-go confirmado: **no existe una prueba con dos usuarios reales
que cubra Data API con credenciales cliente y API de aplicación**.

El único candidato nominal es
`tests/integration/diagnose-isolation.test.mjs`, pero no cumple:

- genera un solo `TARGET_OWNER`, no dos usuarios, en `:31-35`;
- requiere y usa `SUPABASE_SERVICE_ROLE_KEY` en `:36-40`;
- el acceso PostgREST directo usa esa clave como `apikey` y Bearer en `:50-57`
  y `:69-74`;
- la “vía código de app” cambia `process.env.STATSEDGE_OWNER_ID` en `:82-99`,
  no autentica a un usuario;
- sus aserciones centrales solo comprueban cero filas para un owner recién
  generado en `:64-66`, `:78-79`, `:95-99` y `:109-117`.

La evidencia histórica tampoco sustituye esa prueba:
`docs/reliability-audit-2026-07-10.md:19-24` afirma que suites con owners
distintos pasaron, pero `:9-12` deja claro que se trataba de dos workers con
`owner_id`, no de dos identidades Supabase Auth. Las suites reales usan el
helper de `service_role`, por ejemplo
`tests/integration/check-scan-finalize.real.test.mjs:84-104`.

`package.json:4-30` no declara una suite específica de tenancy. La existencia y
el pass de la prueba requerida no son inferibles de `npm test`, y no se ejecutó
ningún test en esta auditoría.

Prueba mínima necesaria para cerrar C3:

1. Crear dos identidades Supabase Auth reales A y B.
2. Sembrar datos distintos para A y B.
3. Con JWT/publishable key de A, probar Data API contra cada tabla/RPC y
   demostrar que no ve ni muta B; repetir simétricamente con B.
4. Con sesiones separadas A/B, probar las rutas de aplicación de lectura y
   escritura.
5. Fallar ante cualquier cruce y conservar log de HTTP status, actor, tabla,
   owner esperado y owner observado.

## 4. Tablas internas alcanzables vía Data API con credenciales cliente

### Conclusión: NO VERIFICABLE ESTÁTICAMENTE

El esquema del checkout contiene 19 tablas `public`; el inventario real del
archivo y su activación RLS es:

| Tabla | `CREATE TABLE` | `ENABLE RLS` |
|---|---:|---:|
| `scans` | `supabase/schema.sql:6` | `:1334` |
| `scan_results` | `:24` | `:1335` |
| `favorites` | `:437` | `:1336` |
| `favorite_snapshots` | `:745` | `:1337` |
| `notes` | `:758` | `:1338` |
| `alerts` | `:770` | `:1339` |
| `company_profiles` | `:993` | `:1340` |
| `universe_snapshots` | `:1009` | `:1341` |
| `universe_snapshot_symbols` | `:1025` | `:1342` |
| `daily_bars` | `:1043` | `:1343` |
| `fundamental_snapshots` | `:1061` | `:1344` |
| `shadow_instruments` | `:1076` | `:1345` |
| `symbol_resolutions` | `:1100` | `:1346` |
| `provider_runs` | `:1121` | `:1347` |
| `app_settings` | `:1134` | `:1348` |
| `leaderboard_snapshots` | `:1221` | `:1349` |
| `leaderboard_items` | `:1237` | `:1350` |
| `rs_weekly_snapshots` | `:1254` | `:1351` |
| `rs_weekly_items` | `:1271` | `:1352` |

Una búsqueda completa de `supabase/schema.sql` y
`supabase/migrations/*.sql` encuentra:

- cero `CREATE POLICY`;
- cero `GRANT ... ON TABLE` o `REVOKE ... ON TABLE`;
- cero `ALTER DEFAULT PRIVILEGES`;
- cero `FORCE ROW LEVEL SECURITY`.

El archivo solo habilita RLS en `supabase/schema.sql:1334-1352`. Las funciones
sí tienen cierres explícitos; por ejemplo
`supabase/migrations/20260710104226_coverage_scan_summary.sql:196-202` y
`supabase/migrations/20260710180000_leaderboard_publishable_rows.sql:116-121`
revocan `public/anon/authenticated` y conceden a `service_role`.

Con RLS habilitado y sin políticas, un rol sujeto a RLS no debería obtener
filas. Eso no demuestra estáticamente que:

- el endpoint de cada tabla no sea alcanzable;
- los grants/default privileges del proyecto desplegado coincidan con este
  archivo;
- `public` sea o no un schema expuesto en la configuración Data API;
- no existan políticas, grants, tablas, vistas o funciones añadidos fuera de
  este checkout;
- JWT reales de `anon`/`authenticated` reciban el comportamiento esperado.

El diagnóstico existente tampoco sirve: `scripts/supabase-admin.mjs:228-245`
prueba las 19 tablas, pero `:152-168` construye todas las peticiones con
`serviceKey`.

Para confirmar C4 hacen falta dos evidencias live:

1. SQL de solo lectura sobre `pg_class`, `pg_namespace`, `pg_policy`,
   `information_schema.role_table_grants`, `pg_default_acl`, funciones y vistas,
   además de la configuración de schemas expuestos por PostgREST.
2. Matriz HTTP contra `/rest/v1/<tabla>?select=*&limit=1` y RPCs usando
   credencial anon, JWT autenticado A y JWT autenticado B, registrando status y
   filas devueltas.

Hasta obtener ambas, C4 no puede convertirse en `CONFIRMADO FALSO`.

## 5. Alcance de datos `legacy_unknown` desde rutas de producto

### Conclusión: CONFIRMADO VERDADERO

Este checkout no contiene ninguna referencia a `legacy_unknown`,
`integrity_class`, result sets publicados ni una barrera equivalente.
`scan_results` se define sin columna de integridad en
`supabase/schema.sql:24-44`.

Por ello, si la base desplegada contiene filas clasificadas
`integrity_class='legacy_unknown'`, los lectores del checkout no pueden
excluirlas. Los caminos concretos son:

- **Scans:** `app/api/scans/route.js:389-401` devuelve `scans` y
  `scan_results` por owner/id sin predicado de integridad ni publicación.
- **Leaderboards:** `lib/leaderboards.js:713-731` llama
  `leaderboard_publishable_rows`; la SQL lee `scan_results` en
  `supabase/migrations/20260710180000_leaderboard_publishable_rows.sql:52-78`
  y solo filtra por owner/fecha. En `:103-112` la única barrera de publicación
  es `parent_status in ('complete','partial','done')`.
- **Discovery:** `app/api/discovery/route.js:81-99` reutiliza `readScanRows` y
  `:136-179` construye la respuesta desde esas filas. Hereda exactamente la
  barrera insuficiente de leaderboards.
- **Coverage:** `lib/coveragePlan.js:195-211` llama `coverage_scan_summary`; la
  SQL selecciona `scan_results` solo por owner/fecha en
  `supabase/migrations/20260710104226_coverage_scan_summary.sql:80-92`.
  `/api/scan-coverage` repite el patrón en
  `app/api/scan-coverage/route.js:258-271`, cuya SQL filtra solo owner/fecha en
  `supabase/migrations/20260710112255_scan_coverage_breakdown_parity_fix.sql:27-40`.
- **Comparables:** `app/api/comparables/route.js:45-77` elige scans por
  owner/fecha/row count y luego lee sus `scan_results`, sin integridad.
- **Company brief:** `app/api/company-brief/route.js:817-835` toma la fila más
  reciente de `scan_results` para el símbolo y owner sin comprobar siquiera el
  estado del scan padre.

Además, los snapshots materializados de leaderboard/discovery no guardan una
clase de integridad de origen: `lib/discoveryCache.js:85-104` persiste el
payload derivado y `lib/leaderboards.js:805-837` persiste snapshots/items. Una
fila legacy que ya haya alimentado esos snapshots tampoco queda identificada
para ser excluida al leer el cache.

La conclusión es de alcanzabilidad del código, no de conteo de datos: esta
auditoría no consultó la base para determinar cuántas filas
`legacy_unknown` existen actualmente.

## 6. Borrado íntegro de un usuario sin afectar al otro

### Conclusión: CONFIRMADO VERDADERO

Predicado de no-go confirmado: **no existe ni está probado un borrado íntegro
de usuario**.

No hay modelo de usuario Supabase en el esquema: las 19 tablas usan
`owner_id text` y ninguna referencia `auth.users`. Los cascades existentes son
solo entre datos internos:

- `scan_results.scan_id -> scans.id` en `supabase/schema.sql:24-27`;
- `favorite_snapshots.favorite_id -> favorites.id` en `:745-749`;
- `notes.favorite_id -> favorites.id` con `SET NULL` en `:758-763`;
- `universe_snapshot_symbols.snapshot_id` en `:1025-1029`;
- `leaderboard_items.snapshot_id` en `:1237-1241`;
- `rs_weekly_items.snapshot_id` en `:1271-1275`.

Los puntos de borrado encontrados no borran un usuario:

- `DELETE /api/auth/session` solo expira la cookie en
  `app/api/auth/session/route.js:61-71`.
- `DELETE /api/scans` crea tombstones mediante `delete_scan_newer_wins` en
  `app/api/scans/route.js:441-467`.
- `DELETE /api/favorites` crea tombstones mediante
  `delete_favorite_newer_wins` en `app/api/favorites/route.js:208-229`.

Los tests reales de cleanup cubren subconjuntos y un solo owner:

- `tests/integration/check-scan-finalize.real.test.mjs:84-104` borra y
  comprueba solo `scan_results` y `scans`; `:105-112` convierte incluso una
  comprobación fallida en `console.warn`.
- `tests/integration/check-daily-bars-cap.real.test.mjs:133-152` borra solo
  `daily_bars` y `favorites`; `:154-172` comprueba únicamente esas dos tablas.
- `tests/integration/check-signal-contradictions.real.test.mjs:99-102` y
  `:125-144` vuelve a limitarse a `scan_results` y `scans`.
- El contrato estático de purga declara expresamente que no toca favoritos en
  `tests/upsertScanPurge.test.js:13-28` y `:133-139`; no pretende ser borrado de
  cuenta.

No existe una prueba que:

- cree A y B como usuarios reales;
- pueble todas las tablas/relaciones para ambos;
- borre A mediante un flujo de producto/administración definido;
- demuestre cero filas residuales de A en las 19 tablas, caches y Auth;
- compare un digest completo de B antes/después para probar que B no cambió.

Para cerrar C6 hace falta esa prueba sobre Postgres/Supabase real, idealmente en
una transacción o entorno efímero, con inventario automático de tablas
tenant-scoped. Debe fallar si aparece una tabla nueva sin estrategia de borrado,
si queda una fila de A, si se modifica una fila de B o si permanecen
materializaciones derivadas de A.

## Condiciones mínimas para reabrir el gate

1. Eliminar el uso de `service_role` de los caminos de aplicación o encapsular
   toda operación en un contrato server-side cerrado que derive tenant de una
   identidad autoritativa.
2. Implementar un `resolveOwner(request)` único, basado en usuario/sesión
   verificable, sin aceptar owner/tenant de body, query o headers de negocio.
3. Añadir y ejecutar la prueba bidireccional A/B descrita en C3.
4. Auditar ACL, policies y Data API live, y probar con anon/JWT A/JWT B.
5. Introducir una barrera explícita que haga imposible leer o materializar
   `legacy_unknown` desde cualquier producto.
6. Implementar y ejecutar borrado íntegro de A con digest de no alteración de B.

Hasta que las seis condiciones de riesgo estén **confirmadas falsas con
evidencia runtime donde corresponde**, el gate permanece **NO-GO**.
