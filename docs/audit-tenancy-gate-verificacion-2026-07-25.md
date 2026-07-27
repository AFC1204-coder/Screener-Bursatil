# Verificación del gate de tenancy (Hito 2) — 2026-07-25

## Dictamen

**NO-GO. El estado material del gate no ha mejorado respecto al informe del
2026-07-24.**

De las seis condiciones:

| # | Predicado de no-go del informe original | Estado actual | ¿Sigue bloqueando? |
|---|---|---|---|
| 1 | Alguna ruta usa la credencial `service_role` | **CONFIRMADO VERDADERO** | **Sí** |
| 2 | Algún owner/tenant procede de body, query o header del cliente | **CONFIRMADO FALSO** en sentido estricto | **No por ese IDOR concreto**; el owner global sigue siendo un P0 independiente |
| 3 | Falta una prueba aprobatoria con dos usuarios reales, Data API cliente y API de aplicación | **CONFIRMADO VERDADERO** | **Sí** |
| 4 | Alguna tabla interna es alcanzable con credenciales cliente | **NO VERIFICABLE** sin proyecto y credenciales live | **Sí, hasta obtener prueba live** |
| 5 | `legacy_unknown` puede alcanzar rutas de producto | **CONFIRMADO VERDADERO** | **Sí** |
| 6 | Falta probar borrado íntegro de un usuario sin afectar al otro | **CONFIRMADO VERDADERO** | **Sí** |

Resultado: siguen existiendo cuatro bloqueadores confirmados, una condición no
verificable que debe permanecer cerrada por defecto y una condición confirmada
falsa en su formulación estricta. El hallazgo P0 independiente también sigue
vigente: no hay identidad de tenant por usuario; hay un único owner global
derivado de `STATSEDGE_OWNER_ID`.

## Alcance y checkout realmente verificado

La verificación se hizo contra el filesystem y Git reales, no contra el relato
del informe anterior.

Comando:

```sh
pwd
git branch --show-current
git rev-parse HEAD
git status --short
```

Output real:

```text
/Users/alejandrofrutos1204/Documents/Codex/2026-05-13/estoy-desarrollando-un-screener-investment-research/Statsedge-v0.1
codex/statsedge-ui-polish
69fffd2e9d11d0af224ee7243373cb02fb91a4a2
 M package-lock.json
?? docs/note-scan-coverage-breakdown-parity-failure-2026-07-24.md
?? tests/e2e/stockChartRangeSequence.e2e.mjs
```

Esos tres cambios ya existían antes de crear este documento y se conservaron
intactos. Se leyó `AGENTS.md` antes de ejecutar los probes.

No se ejecutaron tests, SQL, comandos contra el proyecto Supabase, Data API,
servidor, jobs ni autenticación live. No se leyeron ni imprimieron secretos.
Para los searches con `rg`, `exit=1` significa «cero coincidencias».

## C1. Uso de `SUPABASE_SERVICE_ROLE_KEY` desde rutas de aplicación

### Estado actual: CONFIRMADO VERDADERO — sigue bloqueando

El helper todavía obtiene la service key y la usa simultáneamente como
`apikey` y Bearer. `/api/scan` sigue importando ese helper y lo usa para
lecturas y escrituras.

Comando:

```sh
rg -n 'SUPABASE_SERVICE_ROLE_KEY|apikey: config\.key|Authorization: `Bearer \$\{config\.key\}`' lib/supabaseServer.js
rg -n 'supabaseConfig|supabaseRequest' app/api/scan/route.js
```

Output real:

```text
12:  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
16:  if (!key) missing.push("SUPABASE_SERVICE_ROLE_KEY");
56:      apikey: config.key,
57:      Authorization: `Bearer ${config.key}`,
129:      apikey: config.key,
130:      Authorization: `Bearer ${config.key}`,
12:import { disabledPayload, requirePersistenceAuth, supabaseConfig, supabaseRequest, textOrNull } from "@/lib/supabaseServer";
21:  const config = supabaseConfig();
34:    const [saved] = await supabaseRequest("scans", {
81:  const config = supabaseConfig();
90:    const [scan] = await supabaseRequest("scans", {
98:      const results = await supabaseRequest("scan_results", {
```

La existencia de una sola ruta efectiva basta para que el predicado de riesgo
sea verdadero. RLS no crea una frontera de tenant para este camino porque la
service key lo omite.

## C2. Owner/tenant derivado de body, query o header

### Estado actual: CONFIRMADO FALSO en sentido estricto — no bloquea por ese IDOR

El owner de persistencia sigue procediendo exclusivamente de una variable de
entorno global, con fallback `personal`. No existe `resolveOwner`.

Comando:

```sh
rg -n 'DEFAULT_OWNER|STATSEDGE_OWNER_ID|resolveOwner' lib/supabaseServer.js lib/authSession.js lib/internalAuth.js app/api/auth/session/route.js
echo "search_exit=$?"
rg -n -i 'user_id|tenant_id|auth\.uid|sub|email' lib/authSession.js lib/internalAuth.js app/api/auth/session/route.js
echo "identity_search_exit=$?"
```

Output real:

```text
lib/supabaseServer.js:4:const DEFAULT_OWNER = "personal";
lib/supabaseServer.js:13:  const ownerId = envValue("STATSEDGE_OWNER_ID") || DEFAULT_OWNER;
search_exit=0
identity_search_exit=1
```

Se ejecutó además un probe sobre los 48 handlers `route.js`. Busca acceso
directo a campos de owner/tenant en objetos habituales de body, destructuring
desde `request.json()`, query params, headers y headers `x-owner`/`x-tenant`.

Comando exacto:

```sh
node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; const files=[]; const walk=(dir)=>{for(const name of fs.readdirSync(dir)){const p=path.join(dir,name);const s=fs.statSync(p);if(s.isDirectory())walk(p);else if(name==="route.js")files.push(p)}}; walk("app/api"); const patterns=[/\b(?:body|payload|data|input|json)\s*\??\.\s*(?:ownerId|owner_id|tenantId|tenant_id)\b/gu,/\{[^}\n]*\b(?:ownerId|owner_id|tenantId|tenant_id)\b[^}\n]*\}\s*=\s*await\s+[\w.]+\.json\(/gu,/searchParams\s*\.\s*get\([^\n)]*(?:ownerId|owner_id|tenantId|tenant_id)/gu,/headers\s*\.\s*get\([^\n)]*(?:ownerId|owner_id|tenantId|tenant_id)/gu,/\bx-(?:owner|tenant)(?:-id)?\b/gu]; const hits=[]; for(const file of files){const text=fs.readFileSync(file,"utf8"); for(const re of patterns){for(const m of text.matchAll(re)){hits.push(`${file}:${text.slice(0,m.index).split("\n").length}:${m[0]}`)}}} console.log(`route_files_scanned=${files.length}`); console.log(`client_owner_sources=${hits.length}`); for(const hit of hits)console.log(hit);'
```

Output real:

```text
route_files_scanned=48
client_owner_sources=0
```

Esto mantiene falsa C2 en su sentido literal. No cierra el gate: la cookie de
sesión tampoco contiene `user_id`, `tenant_id`, `auth.uid`, `sub` ni email, y
todos los usuarios del perímetro compartirían el mismo
`STATSEDGE_OWNER_ID`. El P0 de identidad global sigue confirmado.

## C3. Prueba aprobatoria con dos usuarios reales

### Estado actual: CONFIRMADO VERDADERO — sigue bloqueando

Los únicos archivos cuyo nombre sugiere auth/aislamiento son dos tests puros de
la cookie/perímetro y el mismo diagnóstico de un solo owner del informe
anterior.

Comando:

```sh
rg --files tests | rg -i 'tenan|isolat|rls|auth'
rg -n 'TARGET_OWNER|SUPABASE_SERVICE_ROLE_KEY|STATSEDGE_OWNER_ID|apikey|Authorization' tests/integration/diagnose-isolation.test.mjs
```

Output real:

```text
tests/internalAuth.test.js
tests/authSession.test.js
tests/integration/diagnose-isolation.test.mjs
7:// STATSEDGE_OWNER_ID=playwright-check produce owner_id correcto en:
8://   1. PostgREST directo (fetch nativo con apikey) — control de bajo nivel
35:const TARGET_OWNER = `playwright-diag-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
37:const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
51:    const url = `${SUPABASE_URL}/rest/v1/daily_bars?owner_id=eq.${TARGET_OWNER}&select=id&limit=1`;
55:        apikey: SERVICE_KEY,
56:        Authorization: `Bearer ${SERVICE_KEY}`,
70:    const url = `${SUPABASE_URL}/rest/v1/favorites?owner_id=eq.${TARGET_OWNER}&select=id&limit=1`;
73:      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
83:    process.env.STATSEDGE_OWNER_ID = TARGET_OWNER;
88:    expect(cfg.ownerId).toBe(TARGET_OWNER);
93:    process.env.STATSEDGE_OWNER_ID = TARGET_OWNER;
103:    process.env.STATSEDGE_OWNER_ID = TARGET_OWNER;
112:        query: `owner_id=eq.${TARGET_OWNER}&symbol=eq.PROBE-SYMBOL&select=id&limit=1`,
```

La búsqueda corregida —con límites de palabra para no confundir `userAgent` o
`USER_AUDIT` con «user A»— no encuentra creación/login de dos identidades ni
uso de credenciales cliente en tests.

Comando:

```sh
rg -n -i 'auth\.(signUp|signInWithPassword|admin\.createUser)|createClient\(|SUPABASE_(ANON|PUBLISHABLE)|\buser[ _-]?[ab]\b|\bowner[ _-]?[ab]\b|two[ _-]?users|dos usuarios' tests scripts --glob '*.js' --glob '*.mjs'
echo "two_user_status=$?"
rg -n '"@supabase/supabase-js"|createClient\(' package.json package-lock.json tests scripts --glob '*.json' --glob '*.js' --glob '*.mjs'
echo "client_usage_status=$?"
git --no-pager diff --exit-code a8abc2f4755987540695b098b895dafa5504a056..HEAD -- tests/integration/diagnose-isolation.test.mjs
echo "diagnose_diff_status=$?"
node -e 'const p=require("./package.json"); console.log(Object.keys(p.scripts).filter((name)=>/tenan|isolat|rls/i.test(name)).join("\n") || "<none>")'
```

Output real:

```text
two_user_status=1
client_usage_status=1
diagnose_diff_status=0
<none>
```

Por tanto, no existe en este checkout evidencia ejecutable de la matriz A/B
requerida. No se corrió `diagnose-isolation`: usa service role y un único
`TARGET_OWNER`, así que un pass suyo tampoco cerraría C3.

## C4. Tablas internas alcanzables vía Data API con credenciales cliente

### Estado actual: NO VERIFICABLE — sigue bloqueando hasta prueba live

El repositorio sigue habilitando RLS en 19 tablas, pero no contiene policies,
ACL de tabla, default privileges ni `FORCE RLS`. Tampoco había nombres de
credenciales cliente disponibles en el entorno del proceso de auditoría.

Comando:

```sh
echo 'rls_enable_statements:'
rg -n -i 'alter\s+table\s+[a-z0-9_]+\s+enable\s+row\s+level\s+security' supabase/schema.sql supabase/migrations | wc -l
echo 'table_policy_or_acl_statements:'
rg -n -i 'create\s+policy|grant\s+.*\s+on\s+table|revoke\s+.*\s+on\s+table|alter\s+default\s+privileges|force\s+row\s+level\s+security' supabase/schema.sql supabase/migrations
acl_status=$?
echo "acl_search_exit=$acl_status"
echo 'available_client_credential_env_names:'
env | cut -d= -f1 | rg '^(NEXT_PUBLIC_)?SUPABASE_(URL|ANON_KEY|PUBLISHABLE_KEY)$'
env_status=$?
echo "client_env_search_exit=$env_status"
```

Output real:

```text
rls_enable_statements:
      19
table_policy_or_acl_statements:
acl_search_exit=1
available_client_credential_env_names:
client_env_search_exit=1
```

Este output no demuestra accesibilidad ni denegación en el proyecto
desplegado. Faltan, como mínimo:

1. configuración live de schemas expuestos y default grants;
2. catálogo live de `pg_policy`, ACL y funciones/vistas;
3. requests HTTP con anon/publishable key y JWT de A y B.

No se intentó descubrir, leer o usar secretos desde `.env*`. Sin esas
credenciales y sin autorización para consultar el proyecto live, C4 debe
permanecer **NO VERIFICABLE**, no inferirse desde RLS estático.

## C5. Alcance de `legacy_unknown` desde producto

### Estado actual: CONFIRMADO VERDADERO — sigue bloqueando

El dato decisivo es que el commit verificado del lector Hito 1B-3
(`93929ce`) **no es ancestro del HEAD auditado**. Solo está contenido en
`codex/scan-integrity-result-sets`. En el árbol actual no existe ninguna
referencia a los símbolos de integridad/publicación, mientras las rutas de
producto continúan leyendo `scan_results`.

Comando:

```sh
echo 'scan_integrity_commit_in_HEAD:'
git merge-base --is-ancestor 93929ce HEAD
echo "ancestor_exit=$?"
echo 'branches_containing_scan_integrity_commit:'
git branch --contains 93929ce
echo 'legacy_barrier_symbols_in_current_tree:'
rg -n 'legacy_unknown|integrity_class|read_published_scan_result_set_v1|published_result_set_id|scan_result_set_rows' app lib supabase tests --glob '*.js' --glob '*.mjs' --glob '*.sql'
legacy_status=$?
echo "legacy_symbol_search_exit=$legacy_status"
echo 'current_product_readers:'
rg -n 'supabaseRequest(All)?\("scan_results"|supabaseRpc\("(leaderboard_publishable_rows|coverage_scan_summary|scan_coverage_breakdown)"' app/api lib --glob '*.js' --glob '*.mjs'
```

Output real:

```text
scan_integrity_commit_in_HEAD:
ancestor_exit=1
branches_containing_scan_integrity_commit:
+ codex/scan-integrity-result-sets
legacy_barrier_symbols_in_current_tree:
legacy_symbol_search_exit=1
current_product_readers:
app/api/comparables/route.js:77:    const rows = await supabaseRequestAll("scan_results", { query }, { pageSize: COMPARABLES_PAGE_SIZE, maxRows: COMPARABLES_MAX_ROWS });
lib/coveragePlan.js:201:    const payload = await supabaseRpc("coverage_scan_summary", {
lib/serverScanRunner.js:200:    await supabaseRequest("scan_results", {
lib/serverScanRunner.js:236:        await supabaseRequest("scan_results", {
lib/materializedScanner.js:1121:  const rows = await supabaseRequestAll("scan_results", {
lib/materializedScanner.js:1535:  await supabaseRequest("scan_results", {
lib/materializedScanner.js:1540:    await supabaseRequest("scan_results", {
app/api/scan-coverage/route.js:263:  const payload = await supabaseRpc("scan_coverage_breakdown", {
app/api/scans/route.js:398:        results = await supabaseRequest("scan_results", {
app/api/scan/route.js:98:      const results = await supabaseRequest("scan_results", {
app/api/company-brief/route.js:821:  const rows = await supabaseRequest("scan_results", {
```

Esto contradice cualquier premisa de que Hito 1B-3 ya esté fusionado en el
HEAD actual. La rama puede contener otros merges recientes, pero Git confirma
que el commit que introduce la barrera y el lector publicado no llegó a
`codex/statsedge-ui-polish`.

La conclusión sigue siendo de alcanzabilidad del código, no de existencia o
conteo live de filas legacy.

## C6. Borrado íntegro de A sin afectar a B

### Estado actual: CONFIRMADO VERDADERO — sigue bloqueando

La búsqueda actual no encuentra modelo `auth.users`, `user_id`/`tenant_id`,
flujo de borrado de cuenta ni purga integral por owner. La única coincidencia
de «purge owner» es una aserción de purga de tombstones de scans. Los handlers
DELETE siguen limitados a scans, favoritos y cookie de sesión.

Comando:

```sh
echo 'user_identity_or_account_deletion_symbols:'
rg -n -i 'auth\.users|references\s+auth\.users|\buser_id\b|\btenant_id\b|delete\s+account|deleteUser|admin\.deleteUser|delete_user|purge.*owner|owner.*purge' app lib tests supabase package.json --glob '*.js' --glob '*.mjs' --glob '*.sql' --glob '*.json'
user_model_status=$?
echo "user_model_search_exit=$user_model_status"
echo 'DELETE_handlers:'
rg -n 'export\s+async\s+function\s+DELETE|delete_scan_newer_wins|delete_favorite_newer_wins' app/api --glob 'route.js'
echo 'two_actor_deletion_proof:'
rg -n -i '\b(user|owner)[ _-]?[ab]\b.*(delete|purge)|(delete|purge).*\b(user|owner)[ _-]?[ab]\b|digest.*(before|after)|(before|after).*digest' tests --glob '*.js' --glob '*.mjs'
deletion_test_status=$?
echo "two_actor_delete_search_exit=$deletion_test_status"
```

Output real:

```text
user_identity_or_account_deletion_symbols:
tests/upsertScanPurge.test.js:190:    expect(purgeBlock).toMatch(/delete from public\.scans\s+where owner_id = v_owner\s+and deleted_at is not null\s+and deleted_at < \(/);
user_model_search_exit=0
DELETE_handlers:
app/api/scans/route.js:347:  if (code === "PGRST202" || /(upsert_scan_newer_wins|delete_scan_newer_wins)/i.test(message)) {
app/api/scans/route.js:441:export async function DELETE(req) {
app/api/scans/route.js:463:      const savedRows = await supabaseRpc("delete_scan_newer_wins", {
app/api/favorites/route.js:134:  if (code === "PGRST202" || /(upsert_favorites_newer_wins|delete_favorite_newer_wins)/i.test(message)) {
app/api/favorites/route.js:151:    const savedRows = await supabaseRpc("delete_favorite_newer_wins", {
app/api/favorites/route.js:208:export async function DELETE(req) {
app/api/auth/session/route.js:61:export async function DELETE() {
two_actor_deletion_proof:
two_actor_delete_search_exit=1
```

No existe una prueba que pueble todas las superficies para A/B, borre A,
demuestre residuo cero y compare un digest completo de B antes/después. C6
sigue bloqueando.

## Cambios desde el checkout del informe original

El informe del 2026-07-24 auditó `a8abc2f`. El diff de superficies relevantes
hasta el HEAD actual no muestra cambios de identidad, auth, persistencia o
tenancy. El único cambio API listado es `scan-coverage`; el resto corresponde
al refactor de chart y `AGENTS.md`.

Comando:

```sh
git --no-pager diff --name-status a8abc2f4755987540695b098b895dafa5504a056..HEAD -- app lib tests supabase package.json AGENTS.md
```

Output real:

```text
A	AGENTS.md
M	app/UniversalPriceChart.jsx
M	app/api/scan-coverage/route.js
A	app/chartNativeAdapter.js
M	app/review/page.jsx
M	app/stock/[symbol]/StockClient.jsx
A	app/useChartController.js
A	app/useChartDataModel.js
A	app/useChartViewport.js
A	lib/chartDataModel.js
M	lib/chartDataQuality.js
A	lib/chartSeriesModel.js
A	lib/chartViewportLifecycle.js
A	lib/chartViewportModel.js
M	lib/vcpDiagnostics.js
A	tests/chartController.test.js
A	tests/chartDataModel.test.js
M	tests/chartDataQuality.test.js
A	tests/chartNativeAdapterTokens.test.js
A	tests/chartSeriesModel.test.js
A	tests/chartUniversalPriceChartBehavior.test.js
A	tests/chartViewport.test.js
A	tests/chartViewportModel.test.js
A	tests/useChartDataModel.test.js
```

## Condición para reabrir el gate

El gate no debe reabrirse hasta que:

1. el tenant se derive de una identidad autoritativa por request;
2. el acceso privilegiado quede encapsulado en contratos que apliquen esa
   identidad, o se retire de caminos de aplicación;
3. exista y pase la matriz A/B sobre Data API y API de aplicación;
4. C4 tenga evidencia live de grants, policies, schemas expuestos y HTTP;
5. la barrera Hito 1B-3 esté realmente contenida en el HEAD de producto y todos
   los lectores/materializadores la usen;
6. exista y pase el borrado integral A con digest de no alteración de B.
