# Corrección de selectores E2E — 2026-08-03

## Resultado

Se confirmaron las causas documentadas contra el código actual y se cambiaron únicamente los siete specs autorizados. Resultado funcional: **4 pasan y 3 siguen fallando después de superar el selector corregido**. `chartNavigation.e2e.mjs` no se modificó ni se ejecutó.

| Test | Causa documentada | ¿Confirmada? | Cambio aplicado | Resultado |
|---|---|---|---|---|
| `dataHealthFilter.e2e.mjs` | `.dataHealthBadge.compactTrustFilter` fue retirado de `CompactResultsTable`; el filtro equivalente vive en `DataHealthSummaryRail`. | Sí. `lib/screenerTable.jsx` solo conserva el badge agregado `.rowTrustBadge`; `DecisionGroups.jsx` renderiza `DataHealthSummaryRail` dentro de “Auditoría y datos”. | Abre el disclosure de auditoría y usa el botón del rail con `title="Filtrar Precio viejo"`. Mantiene las comprobaciones de filtrado, chip y reversibilidad. | **Pasa**, ejecución funcional 1/1 verde. |
| `decisionIssueFilter.e2e.mjs` | `decisionIssueBadge` por fila fue retirado de `CompactResultsTable`. | Sí. La incidencia filtrable vigente se renderiza como `button.decisionQualityIssue` en `DecisionQualityStrip`. | El helper busca la incidencia agregada “Evidencia incompleta” en `.resultsDecisionGroup` y conserva el toggle y las aserciones de filas/chip. | **Pasa**, 1/1 verde. |
| `scoreAuditFilter.e2e.mjs` | `.scoreAuditMini.compactTrustFilter` por fila fue retirado; el control equivalente es `ScoreAuditSummaryRail`. | Sí. Además se confirmó que el antiguo `select[aria-label="Filtrar por auditoría de score"]` tampoco existe en desktop; el rail es el control canónico. | Abre “Auditoría y datos” y usa los botones `Filtrar Score descuadrado` y `Filtrar Score incompleto`. Se mantienen las aserciones de filas, chips, cola Review y reversibilidad. | **Pasa**, 1/1 verde. |
| `pendingWorkReviewContext.e2e.mjs` | El test busca `.pendingDecisionWorkActions button`, pero el JSX usa `.decisionRailAction`. | Sí, en `lib/screenerDomains/decision.jsx`. | Se reemplazó exclusivamente el contenedor del botón “Revisar”. | **Sigue fallando** después de abrir Review, navegar a la ficha y conservar el origen. La ficha no muestra los textos de guardrail/checklist esperados; el código actual pasa `showMethodGuardrails={false}` a `StockDecisionDesk`. No se tocó esa aserción ni producto. |
| `screenerQuickReviewStock.e2e.mjs` | El select de prioridad existe solo en móvil; desktop usa `ReviewPriorityResultRail`. | Sí. `ScreenerShell.jsx` documenta que el re-click del chip limpia el filtro. | Aplica y limpia `validate-first` mediante el botón desktop `.priority-validate-first:not(.reviewPriorityAction)`. | **Sigue fallando** bastante después del selector: la resolución aparece en la cola de Vista rápida, pero el test espera `.reviewQueueResolutionBadge` dentro de la tabla compacta. `CompactResultsTable` solo añade la clase de fila `resolved-candidate`; no renderiza ese badge. No se corrigió fuera de la causa autorizada. |
| `restore.e2e.mjs` | El segundo contexto Playwright no queda autenticado por el login central del runner. | Sí. `scripts/e2e/run.mjs` autentica solo el contexto original antes de llamar al spec. | Se replicó en el propio spec la lectura segura del token y el POST a `/api/auth/session` para `fresh`, sin imprimir el token. | **Pasa**, 1/1 verde. |
| `reviewStockContext.e2e.mjs` | (a) `innerText` expone el `sourceLabel` en mayúsculas por CSS; (b) `ScreenerOriginPanel` no se renderiza en la ficha. | Sí, ambas partes siguen presentes. | Solo se corrigieron las dos comparaciones del origen a `REVIEW · SCREENER ACTUAL`. No se tocó ninguna espera/aserción de `.screenerOriginPanel` o `.screenerOriginReviewFocus`. | **Sigue fallando**, como estaba previsto, por timeout en la parte (b): `.screenerOriginReviewFocus` no aparece. |
| `chartNavigation.e2e.mjs` | Bug de producto: el zoom no activa vista manual. | Confirmado por inspección previa documentada; no se reabrió ni se alteró en esta tarea. | Ninguno. El diff del archivo es vacío. | **No ejecutado**, por estar expresamente fuera de alcance. |

## Salidas literales de las ejecuciones funcionales

### `dataHealthFilter`

```text
(node:39898) [DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
✓ filtro por salud de datos (11.6s)
E2E: 1/1 en verde
```

### `decisionIssueFilter`

```text
(node:39618) [DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
✓ filtro por incidencia desde badge de fila (10.9s)
E2E: 1/1 en verde
```

### `scoreAuditFilter`

```text
(node:39638) [DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
✓ filtro por auditoría de score (11.5s)
E2E: 1/1 en verde
```

### `pendingWorkReviewContext`

```text
(node:39658) [DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
✗ trabajo pendiente conserva contexto hasta ficha: Ficha muestra guardrail metodológico y checklist de observación no ocurrió. Texto visible: StatsEdge EQUITY RESEARCH Screener Listas Sectores Research Mercado WH CONSUMER CYCLICAL · OTC MARKETS WAIT Waitr Holdings Inc. CIERRE DEL GRÁFICO 420,39 -0,82 (-0.2%) DECISIÓN AUDITAR DEBIL / MIXTA CALIDAD DE DATO CIERRE 03 ago 2026 COBERTURA Cobertura estimada RS Sin snapshot HISTÓRICO Estimado FRENO 0 contracciones útiles SCORE — SETUP 2/5 condiciones · falta: contracciones, contracción decreciente, volumen seco REVIEW · TRABAJO PENDIENTE OBSERVACIÓN: PENDIENTE · VIGILAR Confluencia amplia · Validar las pruebas pendientes que impiden una entrada limpia. 8/9 REVIEW 1/1Pendientes Trabajo pendiente · 1 acciones Volver Anterior Siguiente FOCO A OBSERVAR Pendientes8/9 Confluencia amplia · Validar las pruebas pendientes que impiden una entrada limpia. Liderazgo TESIS Plan valido Setup
E2E: 1 fallo(s) de 1
```

### `screenerQuickReviewStock`

```text
(node:39801) [DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
✗ screener vista rápida a ficha con foco Review: Mostrar resolución en la tabla principal del Screener no ocurrió. Texto visible: StatsEdge EQUITY RESEARCH Screener Listas Sectores Research Mercado STATSEDGE · SCREENER Global Leaders Exploratorio amplio · 1 mercados · 2 resultados visibles Ejecutar ESTADO FRAG: Candidata desde Vista rápida MUESTRA PARCIAL · PERCENTIL POR LOTE MUESTRA PARCIAL DESCUBRIMIENTO GLOBAL CURADO No es un ranking global comparable. Reúne filas publicables con percentil por lote y las ordena con señales absolutas por símbolo. No se puede confirmar la disponibilidad de candidatas curadas ahora; no se concluye que no existan candidatas. La cobertura por mercado se mantiene como contexto independiente. ‹ 2 UNIVERSO 2 PASAN - SCORE FILTRO EDITABLE Base Exploratorio amplio Bases opcionales 7 Mis plantillas 0 guardadas MERCADOS 1/29 Global EE. UU. Europa Asia HK Cargar universo 🇺🇸 US 🇪🇸 ES �
E2E: 1 fallo(s) de 1
```

### `restore`

```text
(node:39833) [DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
✓ restore (sesión local + snapshot Supabase) (41.0s)
E2E: 1/1 en verde
```

### `reviewStockContext`

```text
(node:39866) [DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
✗ review a ficha con contexto de decision: page.waitForFunction: Timeout 20000ms exceeded.
E2E: 1 fallo(s) de 1
```

## Intentos iniciales bloqueados por el entorno

Antes de las ejecuciones funcionales, `dataHealthFilter` tuvo dos intentos que no llegaron a cargar el spec. Se incluyen para no presentar esos intentos como resultados del test.

### Intento 1: dependencias ausentes en el worktree

```text

node:internal/modules/run_main:107
    triggerUncaughtException(
    ^
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright' imported from /Users/alejandrofrutos1204/nightly-worktrees/e2e-selectores-20260803-144332/scripts/e2e/run.mjs
    at Object.getPackageJSONURL (node:internal/modules/package_json_reader:301:9)
    at packageResolve (node:internal/modules/esm/resolve:764:81)
    at moduleResolve (node:internal/modules/esm/resolve:855:18)
    at defaultResolve (node:internal/modules/esm/resolve:988:11)
    at nextResolve (node:internal/modules/esm/hooks:769:28)
    at resolve (file:///Users/alejandrofrutos1204/nightly-worktrees/e2e-selectores-20260803-144332/scripts/refactor-check/loader.mjs:24:10)
    at nextResolve (node:internal/modules/esm/hooks:769:28)
    at AsyncLoaderHooksOnLoaderHookWorker.resolve (node:internal/modules/esm/hooks:265:30)
    at MessagePort.handleMessage (node:internal/modules/esm/worker:251:24)
    at [nodejs.internal.kHybridDispatch] (node:internal/event_target:843:20) {
  code: 'ERR_MODULE_NOT_FOUND'
}

Node.js v26.0.0
```

### Intento 2: primer arranque de Chromium bloqueado

```text

lrwxr-xr-x@ 1 alejandrofrutos1204  staff  131 Aug  3 14:48 .env.local -> [redacted source]
lrwxr-xr-x@ 1 alejandrofrutos1204  staff  133 Aug  3 14:48 node_modules -> [redacted source]
(node:39427) [DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
node:internal/modules/run_main:107
    triggerUncaughtException(
    ^

browserType.launch: Target page, context or browser has been closed
Browser logs:

<launching> /Users/alejandrofrutos1204/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/mr/hxqn30sd2cl36d3p55m5prsm0000gn/T/playwright_chromiumdev_profile-Vo3A5P --remote-debugging-pipe --no-startup-window
<launched> pid=39432
[pid=39432][err] [0803/144815.257085:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
[pid=39432][err] [0803/144815.279131:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
[pid=39432][err] [0803/144815.284266:WARNING:net/dns/dns_config_service_posix.cc:197] Failed to read DnsConfig.
[pid=39432][err] [0803/144815.293270:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.39432: Permission denied (1100)
Call log:
  - <launching> /Users/alejandrofrutos1204/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/mr/hxqn30sd2cl36d3p55m5prsm0000gn/T/playwright_chromiumdev_profile-Vo3A5P --remote-debugging-pipe --no-startup-window
  - <launched> pid=39432
  - [pid=39432][err] [0803/144815.257085:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
  - [pid=39432][err] [0803/144815.279131:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
  - [pid=39432][err] [0803/144815.284266:WARNING:net/dns/dns_config_service_posix.cc:197] Failed to read DnsConfig.
  - [pid=39432][err] [0803/144815.293270:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.39432: Permission denied (1100)
  - [pid=39432] <gracefully close start>
  - [pid=39432] <kill>
  - [pid=39432] <will force kill>
  - [pid=39432] exception while trying to kill process: Error: kill EPERM
  - [pid=39432] <process did exit: exitCode=null, signal=SIGTRAP>
  - [pid=39432] starting temporary directories cleanup
  - [pid=39432] finished temporary directories cleanup
  - [pid=39432] <gracefully close end>

    at ensureServer (/Users/alejandrofrutos1204/nightly-worktrees/e2e-selectores-20260803-144332/scripts/e2e/run.mjs:40:39)
    at /Users/alejandrofrutos1204/nightly-worktrees/e2e-selectores-20260803-144332/scripts/e2e/run.mjs:104:29

Node.js v26.0.0
```

Después se reutilizaron temporalmente las dependencias y el entorno ignorado del checkout principal, cuyos `package-lock.json` eran idénticos. Las ejecuciones funcionales posteriores sí llegaron a cada spec. Los enlaces temporales ya se retiraron.

## LO QUE NO HE VERIFICADO

- No ejecuté `npm run test:e2e`.
- No ejecuté `serverScan.e2e.mjs` ni ninguna operación que escriba filas en producción.
- No ejecuté ni modifiqué `chartNavigation.e2e.mjs`.
- No validé ni modifiqué la base de datos.
- No modifiqué `app/`, `lib/`, `styles/` ni `scripts/`.
- No corregí los fallos posteriores de `pendingWorkReviewContext` o `screenerQuickReviewStock`; solo confirmé por código por qué sus aserciones actuales no encuentran esos elementos.
- No corregí la parte (b) de `reviewStockContext`.
- No ejecuté specs distintos de los siete listados.
- `node --check` pasó en los siete archivos modificados, pero esto solo prueba sintaxis.
- Hubo un intento de orquestación secuencial que quedó atascado al cerrar un Chromium abortado y se terminó sin obtener una salida atribuible a ningún spec; no se usa como evidencia funcional.
- No hice commit ni push.

## Git diff completo de los cambios de test

El siguiente diff se capturó después de las ejecuciones y antes de crear este informe. Incluye completos los siete archivos de test modificados. El propio informe se excluye porque incluir su diff dentro de sí mismo sería recursivo.

```diff
diff --git a/tests/e2e/dataHealthFilter.e2e.mjs b/tests/e2e/dataHealthFilter.e2e.mjs
index f83af5a..1e80598 100644
--- a/tests/e2e/dataHealthFilter.e2e.mjs
+++ b/tests/e2e/dataHealthFilter.e2e.mjs
@@ -94,25 +94,7 @@ export async function run({ context, baseUrl, sessionSeed }) {
     if (!before.includes(symbol)) throw new Error(`Falta ${symbol} antes de filtrar: ${before.join(",")}`);
   }
 
-  const clickedRowDataFilter = await page.evaluate(() => {
-    const row = [...document.querySelectorAll(".compactResultsTable tbody tr")]
-      .find((item) => item.querySelector("a.ticker")?.textContent.trim() === "STALE");
-    const button = row?.querySelector(".dataHealthBadge.compactTrustFilter");
-    button?.click();
-    return Boolean(button);
-  });
-  if (!clickedRowDataFilter) throw new Error("No encontré el filtro compacto de salud de datos en la fila STALE");
-  await page.waitForFunction(() => {
-    const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
-    return rows.length === 1 && rows[0] === "STALE";
-  }, null, { timeout: 10000 });
-  const rowFilterChip = await page.evaluate(() => [...document.querySelectorAll(".resultFilterChip")]
-    .map((el) => el.textContent.trim())
-    .join(" "));
-  if (!/Datos:\s*Viejos/.test(rowFilterChip)) throw new Error(`Chip activo inesperado desde fila: ${rowFilterChip}`);
-  await page.click(".resultFilterChip");
-  await page.waitForFunction(() => document.querySelectorAll(".desktopResultsSection table a.ticker").length >= 3, null, { timeout: 10000 });
-
+  await page.locator(".desktopResultsSection .resultsAuditGroup summary").click();
   const dataHealthSelector = '.desktopResultsSection .dataHealthSummaryRail button[title="Filtrar Precio viejo"]';
   try {
     await page.waitForSelector(dataHealthSelector, { timeout: 10000 });
@@ -122,6 +104,18 @@ export async function run({ context, baseUrl, sessionSeed }) {
     throw new Error(`No apareció el botón de precio viejo. Botones presentes: ${buttons.join(" | ") || "ninguno"}`);
   }
 
+  await page.click(dataHealthSelector);
+  await page.waitForFunction(() => {
+    const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
+    return rows.length === 1 && rows[0] === "STALE";
+  }, null, { timeout: 10000 });
+  const railFilterChip = await page.evaluate(() => [...document.querySelectorAll(".resultFilterChip")]
+    .map((el) => el.textContent.trim())
+    .join(" "));
+  if (!/Datos:\s*Viejos/.test(railFilterChip)) throw new Error(`Chip activo inesperado desde rail: ${railFilterChip}`);
+  await page.click(".resultFilterChip");
+  await page.waitForFunction(() => document.querySelectorAll(".desktopResultsSection table a.ticker").length >= 3, null, { timeout: 10000 });
+
   await page.click(dataHealthSelector);
   await page.waitForFunction(() => {
     const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
diff --git a/tests/e2e/decisionIssueFilter.e2e.mjs b/tests/e2e/decisionIssueFilter.e2e.mjs
index c3bcabb..5d49b37 100644
--- a/tests/e2e/decisionIssueFilter.e2e.mjs
+++ b/tests/e2e/decisionIssueFilter.e2e.mjs
@@ -10,7 +10,7 @@ async function visibleSymbols(page) {
 
 async function clickIssueBadge(page, titlePart) {
   return page.evaluate((needle) => {
-    const buttons = [...document.querySelectorAll(".desktopResultsSection .compactResultsTable button.decisionIssueBadge")];
+    const buttons = [...document.querySelectorAll(".desktopResultsSection .resultsDecisionGroup button.decisionQualityIssue")];
     const button = buttons.find((el) => (el.getAttribute("title") || "").includes(needle) || el.textContent.includes(needle));
     if (!button) return false;
     button.click();
@@ -86,7 +86,7 @@ export async function run({ context, baseUrl, sessionSeed }) {
     if (!before.includes(symbol)) throw new Error(`Falta ${symbol} antes de filtrar: ${before.join(",")}`);
   }
 
-  if (!await clickIssueBadge(page, "faltan")) throw new Error("No encontré badge de evidencia incompleta");
+  if (!await clickIssueBadge(page, "Evidencia incompleta")) throw new Error("No encontré la incidencia agregada de evidencia incompleta");
   await page.waitForFunction(() => {
     const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
     return rows.length === 1 && rows[0] === "MISS";
@@ -96,7 +96,7 @@ export async function run({ context, baseUrl, sessionSeed }) {
     .join(" "));
   if (!/Evidencia incompleta/.test(activeChip)) throw new Error(`Chip activo inesperado: ${activeChip}`);
 
-  if (!await clickIssueBadge(page, "faltan")) throw new Error("No encontré badge activo para quitar filtro");
+  if (!await clickIssueBadge(page, "Evidencia incompleta")) throw new Error("No encontré la incidencia agregada activa para quitar filtro");
   await page.waitForFunction(() => document.querySelectorAll(".desktopResultsSection table a.ticker").length >= 3, null, { timeout: 10000 });
   const restored = await visibleSymbols(page);
   for (const symbol of ["HIGH", "MISS", "EXT"]) {
diff --git a/tests/e2e/pendingWorkReviewContext.e2e.mjs b/tests/e2e/pendingWorkReviewContext.e2e.mjs
index 9388a68..b9e7307 100644
--- a/tests/e2e/pendingWorkReviewContext.e2e.mjs
+++ b/tests/e2e/pendingWorkReviewContext.e2e.mjs
@@ -94,7 +94,7 @@ export async function run({ context, baseUrl, sessionSeed }) {
   }, "Aplicar Trabajo pendiente");
 
   await page.evaluate(() => {
-    const reviewButton = [...document.querySelectorAll(".desktopResultsSection .pendingDecisionWorkActions button")]
+    const reviewButton = [...document.querySelectorAll(".desktopResultsSection .decisionRailAction button")]
       .find((button) => button.textContent.trim() === "Revisar");
     reviewButton?.click();
   });
diff --git a/tests/e2e/restore.e2e.mjs b/tests/e2e/restore.e2e.mjs
index d3a6337..f90d360 100644
--- a/tests/e2e/restore.e2e.mjs
+++ b/tests/e2e/restore.e2e.mjs
@@ -1,8 +1,25 @@
 // E2E restore: la sesión local con resultados se restaura tal cual (y sobrevive a
 // una recarga), y con la sesión vacía el último snapshot de Supabase puebla la
 // tabla sin pisar nada (no había nada que pisar).
+import { readFileSync } from "node:fs";
+
 export const name = "restore (sesión local + snapshot Supabase)";
 
+function accessToken() {
+  const source = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
+  const line = source.split(/\r?\n/).find((item) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(item));
+  if (!line) throw new Error("STATSEDGE_ACCESS_TOKEN no encontrado en .env.local");
+  return line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
+}
+
+async function login(context, baseUrl) {
+  const response = await context.request.post(`${baseUrl}/api/auth/session`, {
+    headers: { "Content-Type": "application/json" },
+    data: { token: accessToken() },
+  });
+  if (!response.ok()) throw new Error(`Login E2E del contexto fresh falló: ${response.status()} ${await response.text()}`);
+}
+
 export async function run({ context, baseUrl, sessionSeed, seedRows }) {
   // — Parte 1: restauración desde localStorage —
   const rows = seedRows();
@@ -24,6 +41,7 @@ export async function run({ context, baseUrl, sessionSeed, seedRows }) {
 
   // — Parte 2: sesión vacía → snapshot Supabase —
   const fresh = await context.browser().newContext({ viewport: { width: 1600, height: 1000 } });
+  await login(fresh, baseUrl);
   const cloudPage = await fresh.newPage();
   await cloudPage.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 90000 });
   await cloudPage.waitForFunction(() => document.querySelectorAll("table a.ticker").length > 0, null, { timeout: 45000 });
diff --git a/tests/e2e/reviewStockContext.e2e.mjs b/tests/e2e/reviewStockContext.e2e.mjs
index 110cf17..4056734 100644
--- a/tests/e2e/reviewStockContext.e2e.mjs
+++ b/tests/e2e/reviewStockContext.e2e.mjs
@@ -122,7 +122,7 @@ export async function run({ context, baseUrl, sessionSeed }) {
 
   await page.getByRole("link", { name: "Ficha" }).click();
   await page.waitForURL(`${baseUrl}/stock/FRAG`, { waitUntil: "domcontentloaded", timeout: 30000 });
-  await page.waitForFunction(() => document.body.innerText.includes("Review · Screener actual"), null, { timeout: 20000 });
+  await page.waitForFunction(() => document.body.innerText.includes("REVIEW · SCREENER ACTUAL"), null, { timeout: 20000 });
   await page.waitForFunction(() => Boolean(document.querySelector(".screenerOriginReviewFocus")), null, { timeout: 20000 });
 
   const stockState = await page.evaluate(() => {
@@ -150,7 +150,7 @@ export async function run({ context, baseUrl, sessionSeed }) {
   if (!savedContext.decisionTrace?.confidence || savedContext.decisionTrace.confidence.key === "high") {
     throw new Error("La trazabilidad no conserva la confianza frágil");
   }
-  if (!text.includes("Review · Screener actual")) throw new Error("La ficha no renderiza el origen Review");
+  if (!text.includes("REVIEW · SCREENER ACTUAL")) throw new Error("La ficha no renderiza el origen Review");
   if (!text.includes("Operable fragil")) throw new Error("La ficha no renderiza el perfil de decisión");
   if (!text.includes("Datos")) throw new Error("La ficha no renderiza el bloque de salud de datos del origen");
   if (!text.includes("Métricas")) throw new Error("La ficha no renderiza el bloque de métricas del origen");
diff --git a/tests/e2e/scoreAuditFilter.e2e.mjs b/tests/e2e/scoreAuditFilter.e2e.mjs
index fda07cb..2222d38 100644
--- a/tests/e2e/scoreAuditFilter.e2e.mjs
+++ b/tests/e2e/scoreAuditFilter.e2e.mjs
@@ -89,14 +89,9 @@ export async function run({ context, baseUrl, sessionSeed }) {
     if (!before.includes(symbol)) throw new Error(`Falta ${symbol} antes de filtrar: ${before.join(",")}`);
   }
 
-  const clickedRowScoreFilter = await page.evaluate(() => {
-    const row = [...document.querySelectorAll(".compactResultsTable tbody tr")]
-      .find((item) => item.querySelector("a.ticker")?.textContent.trim() === "MIS");
-    const button = row?.querySelector(".scoreAuditMini.compactTrustFilter");
-    button?.click();
-    return Boolean(button);
-  });
-  if (!clickedRowScoreFilter) throw new Error("No encontré el filtro compacto de score audit en la fila MIS");
+  await page.locator(".desktopResultsSection .resultsAuditGroup summary").click();
+  const mismatchSelector = '.desktopResultsSection .scoreAuditSummaryRail button[title="Filtrar Score descuadrado"]';
+  await page.click(mismatchSelector);
   try {
     await page.waitForFunction(() => {
       const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
@@ -112,7 +107,7 @@ export async function run({ context, baseUrl, sessionSeed }) {
   const rowScoreChip = await page.evaluate(() => [...document.querySelectorAll(".resultFilterChip")]
     .map((el) => el.textContent.trim())
     .join(" "));
-  if (!/Score:\s*Descuadre/.test(rowScoreChip)) throw new Error(`Chip de auditoría desde fila inesperado: ${rowScoreChip}`);
+  if (!/Score:\s*Descuadre/.test(rowScoreChip)) throw new Error(`Chip de auditoría desde rail inesperado: ${rowScoreChip}`);
   await page.click(".resultFilterChip");
   await page.waitForFunction(() => document.querySelectorAll(".desktopResultsSection table a.ticker").length >= 3, null, { timeout: 10000 });
 
@@ -150,7 +145,7 @@ export async function run({ context, baseUrl, sessionSeed }) {
   });
   await page.waitForFunction(() => !document.querySelector(".quickReviewModal"), null, { timeout: 10000 });
 
-  await page.click('.desktopResultsSection .scoreAuditSummaryRail button[title="Filtrar Score descuadrado"]');
+  await page.click(mismatchSelector);
   try {
     await page.waitForFunction(() => {
       const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
@@ -159,7 +154,7 @@ export async function run({ context, baseUrl, sessionSeed }) {
   } catch {
     const state = await page.evaluate(() => ({
       visible: [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim()),
-      options: [...document.querySelectorAll('.desktopResultsSection select[aria-label="Filtrar por auditoría de score"] option')].map((option) => ({ value: option.value, text: option.textContent.trim(), selected: option.selected })),
+      options: [...document.querySelectorAll(".desktopResultsSection .scoreAuditSummaryRail button")].map((button) => ({ title: button.getAttribute("title"), text: button.textContent.trim(), pressed: button.getAttribute("aria-pressed") })),
       chips: [...document.querySelectorAll(".resultFilterChip")].map((el) => el.textContent.trim()),
     }));
     throw new Error(`Filtro de score descuadrado no dejó solo MIS: ${JSON.stringify(state)}`);
@@ -172,7 +167,7 @@ export async function run({ context, baseUrl, sessionSeed }) {
 
   await page.click(".resultFilterChip");
   await page.waitForFunction(() => document.querySelectorAll(".desktopResultsSection table a.ticker").length >= 3, null, { timeout: 10000 });
-  await page.locator('.desktopResultsSection select[aria-label="Filtrar por auditoría de score"]').selectOption("missing");
+  await page.click('.desktopResultsSection .scoreAuditSummaryRail button[title="Filtrar Score incompleto"]');
   await page.waitForFunction(() => {
     const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
     return rows.length === 1 && rows[0] === "MISS";
diff --git a/tests/e2e/screenerQuickReviewStock.e2e.mjs b/tests/e2e/screenerQuickReviewStock.e2e.mjs
index ee92c5a..f867743 100644
--- a/tests/e2e/screenerQuickReviewStock.e2e.mjs
+++ b/tests/e2e/screenerQuickReviewStock.e2e.mjs
@@ -89,13 +89,13 @@ export async function run({ context, baseUrl, sessionSeed }) {
   await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 90000 });
   await waitForStage(page, () => document.body.innerText.includes("FRAG"), "Restaurar FRAG en Screener");
 
-  const appliedPriorityFilter = await page.evaluate(() => {
-    const select = document.querySelector('.desktopResultsSection select[aria-label="Filtrar por prioridad de investigacion"]');
-    if (!select || ![...select.options].some((option) => option.value === "validate-first")) return false;
-    select.value = "validate-first";
-    select.dispatchEvent(new Event("change", { bubbles: true }));
+  const priorityFilterSelector = ".desktopResultsSection .reviewPriorityResultRail button.priority-validate-first:not(.reviewPriorityAction)";
+  const appliedPriorityFilter = await page.evaluate((selector) => {
+    const button = document.querySelector(selector);
+    if (!button) return false;
+    button.click();
     return true;
-  });
+  }, priorityFilterSelector);
   if (!appliedPriorityFilter) throw new Error("No encontré el filtro de prioridad Validar primero en el Screener");
   await waitForStage(page, () => {
     const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
@@ -116,12 +116,7 @@ export async function run({ context, baseUrl, sessionSeed }) {
     close?.click();
   });
   await waitForStage(page, () => !document.querySelector(".quickReviewModal"), "Cerrar Vista rápida de prioridad");
-  await page.evaluate(() => {
-    const select = document.querySelector('.desktopResultsSection select[aria-label="Filtrar por prioridad de investigacion"]');
-    if (!select) return;
-    select.value = "all";
-    select.dispatchEvent(new Event("change", { bubbles: true }));
-  });
+  await page.click(priorityFilterSelector);
   await waitForStage(page, () => {
     const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
     return table.includes("FRAG") && table.includes("WAIT");
```
