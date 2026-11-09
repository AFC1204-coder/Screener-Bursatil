# Plan: completar las barras del Mini y arreglar el guardián (2026-11-08)

Estado: **solo plan, nada ejecutado**. Todo lo marcado «verificado» sale de lecturas de solo lectura en el Mini (SSH por Tailscale, 2026-11-08 00:00–00:30 CET).

## 1. Diagnóstico

**Verificado**
- Base `statsedge` del Mini: 4.378.299 filas, 11.520 símbolos, hasta el 2026-11-06.
- Universo del último snapshot (símbolos con `passed`): 1.387 tienen la barra del vie 6-nov, 4.636 llegan solo al jue 5-nov, 133 no tienen barras y ~150 van más atrasados (algunos desde octubre).
- Guardián del sábado 7-nov (04:00Z): `refresh-bars` terminó con `exit=2` **dos veces** (parada por tope: 401.231 y 401.227 filas escritas, tope 400.000). En ambas quedaron **los mismos 4.531 de 5.614 símbolos sin procesar**. El segundo intento no avanzó: reprocesó el mismo primer bloque (~1.083 símbolos, unas 370 filas por símbolo ⇒ reescribe la historia completa, no solo el delta).
- El guardián ignoró ese fallo: el scan se ejecutó igualmente y el estado final fue `result: ok` (`barsExit:"2"` solo aparece como dato suelto).
- El scan `materialized:US:2026-11-07` (3.507 filas) se calculó, por tanto, con barras del jueves para la mayoría de las acciones.
- La corrida completa de 1.083 símbolos tardó 36 s (34 ms/símbolo); el cuello de botella no es el tiempo sino el tope de filas.
- Código en el Mini: `scripts/refresh-bars.mjs` y `scripts/ops/nightly-us-guard.sh` son idénticos a los del portátil; `lib/dailyBarsCache.js` **no** (el del Mini es anterior: no incluye no-persistir-sesión-abierta, purga de fechas ausentes ni guard de escala de D4/D5). El repo del Mini está en `e74f6a9` (5-sep) con 64 archivos modificados sin commitear.

**Hipótesis (sin verificar)**
- Que el origen sean huecos de varios días tras la pausa de Supabase y la migración (el 4-nov se escribieron 1,6 M filas: una carga masiva).
- Que `withDailyBarsCache` refetchee todo el rango de un símbolo «stale» en lugar de pedir solo los días que faltan.

## 2. Plan por fases

### Fase A — Arreglar el guardián (en el repo local, con tests; sin tocar el Mini)
1. Estado nuevo `degraded`: si `barsExit != 0` (incluido 2), el JSON de estado y el log lo reflejan (`result:"degraded"`, `barsExit`, nº de símbolos sin procesar leído de la salida).
2. No repetir el reintento de barras cuando `exit=2` (parada por tope): repetirlo solo reescribe el mismo bloque. Reintentar solo ante errores de red/timeout.
3. Tras el refresco, comprobar la frescura real con `scripts/ops/data-health-check.mjs` (a3/a4/a6) y marcar `degraded` si el universo está atrasado.
4. Avisar por `notify.sh` (ntfy) en `degraded` y `fail`, con el mensaje «barras incompletas: N símbolos sin la última sesión».
5. Test del script (modo `STATSEDGE_GUARD_DRY` ya existe) para los tres resultados.
- Riesgo: bajo. Cambia solo el estado y el aviso. Sigue escaneando con lo que haya (decisión a confirmar).

### Fase B — Completar las barras (escritura en la base del Mini; la lanzas tú o lo autorizas expresamente)
1. **Copia de seguridad previa**: `pg_dump -t daily_bars` a una carpeta del Mini fuera del repo (tamaño sin medir).
2. Decidir el código: o se despliega primero la versión de `dailyBarsCache.js` con los guards D4/D5 (requiere revisar los 64 cambios sin commitear del Mini para no pisarlos), o se corre con el código actual del Mini.
3. Prueba `--dry-run --limit=200` y luego `--write --limit=200` con tope bajo; verificar con `data-health-check.mjs` que no aparecen barras mensuales ni escalas raras.
4. Corrida completa por tandas con el tope subido a propósito (por ejemplo `--max-filas=2500000`); es idempotente por la restricción única `(owner_id, symbol, trade_date, provider)`.
5. Verificar con la misma consulta: debería quedar ≥ 95 % del universo con la barra del 6-nov.
- Riesgo: medio. Escribe millones de filas; si Yahoo degrada la granularidad con rangos largos reaparecen barras mensuales (ya pasó, ver memoria `daily-bars-barras-mensuales`). Por eso el paso 3.
- Tiempo estimado: del orden de minutos por la medida de 34 ms/símbolo, pero no está verificado para una corrida completa.

### Fase C — Recalcular
1. No hace falta lanzar el scan a mano para el lunes: el nocturno de las 05:00 CET del 9-nov ya verá el viernes como última sesión si la Fase B está hecha.
2. Opcional: relanzar `scripts/run-scan-universe-us.sh` tras la Fase B para que el domingo ya se vea correcto.

### Fase D — Pendiente aparte
- Clasificar los 133 símbolos sin barras (¿deslistados, tickers nuevos, mapeo?).
- Decidir qué hacer con `cron-universe-refresh` (22:05 diario) frente al guardián de las 05:00.
- Comprobar por qué los scans nuevos quedan `legacy_unknown` y si el producto del Mini los muestra.
- `~/backfill-b-2026-11-08.sh` no existe en el Mini: ¿dónde lo tienes?
- Servicio web de producción, `tailscale serve`, avisos ntfy (runbook ya escrito).

## 3. Decisiones tuyas
1. ¿La Fase B la ejecutas tú o me das permiso para lanzarla por SSH (con copia previa)?
2. ¿Si las barras salen incompletas, el guardián debe escanear igualmente (marcando `degraded`) o saltar el scan?
3. ¿Desplegar antes `dailyBarsCache.js` con los guards D4/D5 en el Mini? Implica revisar sus 64 cambios locales.

## 4. Ejecución (2026-11-08, ~00:15–00:35 CET)

**Fase A** hecha y desplegada en el Mini: `nightly-us-guard.sh` (original en `~/statsedge-backups/2026-11-08/nightly-us-guard.sh.orig`), `bars-freshness.mjs`, `notify.sh`, `lib/marketCalendar.js`, `data-health-check.mjs`.

**Fase B** hecha, con el código `dailyBarsCache.js` que ya tenía el Mini (decisión 3 sin resolver; era fin de semana, sin sesión abierta):
1. Copia previa: `~/statsedge-backups/2026-11-08/daily_bars-2026-11-08.dump` (243 MB, formato custom, verificado con `pg_restore -l`).
2. `--dry-run --limit=200` y `--write --limit=200`: 75.498 filas, granularidad diaria correcta (48 sesiones desde el 1-sep), sin barras en fin de semana para símbolos US.
3. Corrida completa `--write --stale-days=1 --max-filas=2500000`: 5.610 símbolos, 5.589 refrescados, 21 fallidos (Yahoo sin histórico suficiente; IPO recientes y similares), 2.081.701 filas escritas en 182 s. Log: `logs/refresh-bars-faseB-2026-11-08.out.log`.
4. Frescura: **23,6 % → 95,1 %** del universo US con la sesión del 6-nov (5.582 de 5.870; 267 atrasados y 21 sin barras, el suelo estructural). `bars-freshness.mjs` sale OK.
5. Filas totales 4.378.299 → 4.379.079 (+780): casi todo fueron upserts, sin duplicación.
6. `data-health-check.mjs` en el Mini: a4 OK; a3 (39 picos), a6 (106 filas del 10-ago) y a11 (1.282 parpadeos de etapa) siguen fallando, pero todo es anterior a esta carga (fechas de octubre y agosto). Picos nuevos de una barra en la última semana: 1–4 por día. Se corrigen con `limpieza.sql` (D5) y con el recálculo de etapa (D1), aún no desplegados.

Pendiente: Hong Kong sigue atrasado (1.782 símbolos con última barra del 10-ago); no se ha tocado.

## 5. Staging del código actual en el Mini (2026-11-08, ~01:30 CET)

El servicio vivo (`com.statsedge.next`, `npm run start` en :3000, build del 27-oct) NO se ha tocado. Se creó `~/statsedge-staging` en el Mini (código actual del portátil, `node_modules` clonado, `.env.local` copiado) y se compiló con `npm run build` (11 s). Probado en 127.0.0.1:3001, ya parado:
- `/api/scans?anchor=nightly-us`: **34,5 MB sin comprimir (vivo) → 2,6 MB gzip (staging)**, ~0,7–0,9 s en caliente ambos.
- Páginas `/`, `/lists`, `/sectors`, `/market-health`, `/review` 200 en <30 ms; `/stock/AAPL` 1,9 s; `/api/discovery` 4,3 MB (el vivo daba 28 KB: el código nuevo lee el nocturno completo — candidato a recortar); HK acumulado 0,5 MB.
- Dependencias idénticas (mismo `package-lock.json`), sin `npm ci`.

Corte pendiente (decisión del usuario): cambiar el servicio vivo a este directorio o sincronizar el código al directorio vivo, fuera de la ventana 04:45–08:00. `scripts/ops/deploy-mini.sh` asume un servicio `com.statsedge.web` y `web.env` que en el Mini no existen; el real es `com.statsedge.next` con `.env.local`.

## 6. Tope de barras y corte del servicio (2026-11-08, ~11:25 CET)

**Hallazgo (nocturno US de las 05:00 del 8-nov):** `degraded`. El guardián fijaba `--max-filas=400000`; cada noche procesa solo ~1.089 de 5.610 símbolos (el mismo bloque, porque con `--stale-days=1` no se salta ninguno). El 95,1 % de frescura de hoy venía de la Fase B; el martes 10-nov a las 05:00 (sesión esperada: lunes 9) solo ~20 % tendría la barra nueva.
**Arreglo:** `--max-filas=2500000` en `scripts/ops/nightly-us-guard.sh` (mismo tope que la Fase B: 2,08 M filas en 182 s). Tests del guardián 10/10. Desplegado en el Mini; original en `~/statsedge-backups/2026-11-08/nightly-us-guard.sh.pre-tope`. **No verificado hasta el nocturno del lunes 9 / martes 10.**

**Corte del servicio vivo:** `scripts/run-next-prod.sh` del Mini ahora hace `cd /Users/cristian/statsedge-staging` (plist intacto; original en `~/statsedge-backups/2026-11-08/run-next-prod.sh.orig`). `launchctl kickstart -k` a las 11:25. Verificado: páginas 200; `/api/scans?anchor=nightly-us` 2,59 MB gzip (antes 34,5 MB); HK acumulado 525 KB; `/api/discovery` 4,3 MB; sin errores nuevos en `next.err.log`.
**Vuelta atrás:** restaurar `run-next-prod.sh.orig` sobre `~/Statsedge-v0.1/scripts/run-next-prod.sh` y `launchctl kickstart -k gui/$(id -u)/com.statsedge.next` (el build del 27-oct sigue en `~/Statsedge-v0.1/.next`).
Nota: en `~/statsedge-staging` quedó un archivo suelto con nombre raro (`cristisedge-sn@100.104.42.10aging`) por un `scp` erróneo mío; sin borrar.

## 7. Compresión de `/api/discovery` y `/api/weekly-changes` (2026-11-08, ~11:40 CET)

Ambas respuestas salían en claro (solo `/api/scans` y `/api/chart` usaban `compressedJsonResponse`). Cambio: las respuestas de éxito de `app/api/discovery/route.js` (4 retornos) y `app/api/weekly-changes/route.js` (2) pasan por `compressedJsonResponse`; los errores no. Mismo contrato (clientes sin `Accept-Encoding: gzip` reciben el JSON plano). Tests de discovery/weekly/compresión 160/160, eslint limpio.
Desplegado en `~/statsedge-staging` (servicio vivo), recompilado y reiniciado a las ~11:40. Copias previas en `~/statsedge-backups/2026-11-08/pre-compress/`. Medido en el Mini: `/api/discovery` **4.320.144 → 479.514 B** (0,26 s en caliente); `/api/weekly-changes` 70.358 → 17.043 B; `/api/scans` sin cambios (2,59 MB). JSON válido tras descomprimir.
No verificado: percepción de velocidad en un móvil real.
Siguiente recorte (no hecho): la propia lista (`/api/scans`, ~4,7 KB/fila × 3.287 filas) — detalle bajo demanda y caché local stale-while-revalidate.

## 8. Caché local del arranque (IndexedDB validada por sonda) — hecho en el repo, NO desplegado (2026-11-08, ~12:00 CET)

**Qué es.** `lib/startupScanCache.js` (nuevo) + `cachedStartupGet` en `lib/cloudSyncClient.js`. El arranque core (`/api/scans?includeRows=1&…&hydrateRs=0`, ~15 MB de JSON / 2,6 MB gzip) se guarda como texto en IndexedDB (`statsedge-cache`/`startupScans`, claves `<url>#text` y `<url>#meta`). En la siguiente apertura se pide una SONDA (misma URL con `includeRows=0`, ~2 KB, 8–17 ms en el Mini) con `id|updatedAt|rowsAvailable` del escaneo vigente; solo si coincide con la guardada y la copia tiene ≤ 4 h se sirve la caché con la misma forma de resultado que la red. Si no, o si la sonda falla, descarga como antes y reescribe. Máx. 4 entradas, tope 40 M de caracteres. La segunda fase (RS país/tema, `hydrateRs=1`) no se cachea. Interruptor: `NEXT_PUBLIC_STARTUP_CACHE=0` (en build).
**Por qué sonda y no stale-while-revalidate.** SWR obligaba a repintar dentro de la máquina de estados de `app/page.jsx` (dueño de resultados, sesión, copia local en muestra, avisos). Con la sonda por identidad no se puede enseñar un escaneo distinto del vigente y `page.jsx` no cambia. Lo no identificado por el escaneo (RS global hidratado en el core) queda acotado por las 4 h.
**Verificación.** `tests/startupScanCache.test.js` 14/14 (acierto, identidad distinta, `updatedAt`/filas distintos, caducada, sonda caída o con excepción, copia corrupta, sin almacén, almacén roto, payload vacío, poda, meta huérfana); relacionados 62/62; eslint limpio. En navegador (dev :3320, datos de octubre): 1.ª apertura descarga 2,35 MB y crea la base; 2.ª apertura solo sonda (2,2 KB) y la lista sale igual (937 de 3287); con la identidad alterada a mano descarga de nuevo y la restaura; sin errores de consola.
**No verificado.** Móvil real (Safari iOS/Android: cuota y modo privado de IndexedDB), build de producción minificada, y cuánto baja el tiempo total de apertura en el móvil. Tampoco se ha medido el coste de `JSON.parse` de 15 MB en móvil, que la caché no elimina.
**Despliegue pendiente de autorización del usuario.** Archivos: `lib/startupScanCache.js` (nuevo) y `lib/cloudSyncClient.js`; en el Mini el `cloudSyncClient.js` difiere solo por este cambio. Pasos: copia a `~/statsedge-backups/2026-11-08/pre-startup-cache/`, `scp` a `~/statsedge-staging/lib/`, `npm run build`, `launchctl kickstart -k gui/$(id -u)/com.statsedge.next`. Vuelta atrás: restaurar la copia + build + kickstart.

**Desplegado** en el Mini (staging, servicio vivo) a las ~12:05 CET; copia previa en `~/statsedge-backups/2026-11-08/pre-startup-cache/`. Build OK, home 200, el bundle cliente contiene la caché.

## 9. Rendimientos de 1 día, 1 semana, 1 mes y año en curso (2026-11-08, ~17:30 CET) — hecho en el repo, NO desplegado

**Qué.** Nuevo `lib/periodReturns.js` (`perf1d`, `perf1w` = 5 sesiones, `perf1m` = 21 sesiones, `perfYtd` = cierre actual frente al último cierre del año anterior; `null`, nunca 0, si no hay histórico; redondeo a 2 decimales). Lo usan `lib/researchRow.js` (canon) y `lib/materializedScanner.js` (copia; también la proyección persistida de ~línea 1600), y `lib/scanLightProjection.js` los incluye en `SCAN_LIGHT_FIELDS` (grupo `PERIOD_RETURN_FIELDS`). Sin ningún dato nuevo: salen de las ~400 barras diarias que ya hay. Para el panel de filtros A (ver memoria `rediseno-filtros-pendiente`).
**Peso medido** sobre el payload real del Mini (3.506 filas): +210 KB brutos (+1,4 %) y +70 KB comprimidos (+2,7 %), con valores simulados de la misma magnitud.
**Verificación.** `tests/periodReturns.test.js` 9/9; relacionados (`scanLight`, `researchRow`, `materializedScan`, `screenerColdPayload`, `scansMesaRow`, `persistenciaNavegador`…) 183/183; eslint limpio; suite completa verde en la última pasada. En la suite aparecieron fallos inestables que cambian de un test a otro y pasan solos (microbench de tiempos, `screenerAnnotation`): no relacionados. De paso: renombrado el motivo `"vacia"` de `lib/startupScanCache.js` (lo marcaba `tests/ortografiaUI.test.js`); la copia desplegada en el Mini aún lo lleva (inofensivo, es un motivo interno).
**No verificado.** Cifras reales por símbolo contra otra fuente; ningún escaneo contiene aún estos campos. Las filas de escaneos anteriores no los llevan: la interfaz debe decir «sin dato», no 0.
**Despliegue pendiente de autorización.** El nocturno corre desde `~/Statsedge-v0.1` del Mini, cuyo `researchRow.js`/`materializedScanner.js` son anteriores y divergen mucho del árbol local; copiar solo estos archivos arrastraría otros cambios locales. Hay que decidir si el nocturno pasa a ejecutarse desde `~/statsedge-staging` (código actual) o se sincroniza el directorio vivo.

## 10. Primer día con los cambios: nocturno del 9-nov, backup y frescura (2026-11-09, ~11:45 CET)
- **Backup de las 03:30**: `ok`, 398 s, 841.917.806 B, `uploadExit 0`, subido cifrado a Drive; 2 volcados locales conservados. Primer disparo programado real correcto.
- **Nocturno US de las 05:00** (04:00Z): barras bien (`barsExit 0`, ya sin tope: el tope de 2,5 M funcionó) y escaneo `materialized:US:2026-11-09:t040349` con 3.508 filas: **todas con `perf1d/1w/1m`, 3.469 con `perfYtd`** (39 sin valor por poca historia). AAPL y V coinciden con lo contrastado el 8-nov.
- **Fallo mío descubierto**: el guardián salió `degraded` con «universo 0». `bars-freshness.mjs` cogía el último snapshot de universo **sin filtrar por mercado**; a las 22:20 el cron de refresco había escrito un snapshot de KR (28 símbolos) y al buscar US dentro de él no había nada. Arreglado: `where market = $1` en la consulta, un universo vacío sale como error de medición (exit 2) y el guardián lo dice («no se pudo medir la frescura», no «atrasadas»); mismo texto en el guardián de HK. Desplegado en el Mini (copia previa en `~/statsedge-backups/2026-11-09/pre-freshness/`); medido en la base real: universo 5.870, 95,1 % al día, OK. Test nuevo en `tests/nightlyGuardDegraded.test.js` (19/19 con el de HK). **Pendiente de comitear.**
- **Servidor :3320 del portátil**: reiniciado (PID viejo 63442 parado por PID, `.next` de 610 MB borrado por ruta exacta). La app no tiene permiso de macOS sobre `Documents`, así que ni el terminal del panel ni `preview_start` pueden arrancarlo desde ahí; se arrancó con una tarea en segundo plano de la herramienta de comandos. Fichas 0425.HK, SBUX y AAPL en 200, 0 errores. Añadida la configuración `statsedge-dev-3320` a `.claude/launch.json`.
- Borrado el directorio basura `cristisedge-sn@100.104.42.10aging/` de la raíz del repo (copia del repo de un `rsync` mal dirigido; ningún archivo único ni más reciente). El mismo artefacto sigue en `~/statsedge-staging` del Mini (28 MB).
