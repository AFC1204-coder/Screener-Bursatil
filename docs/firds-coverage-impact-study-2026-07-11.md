# StatsEdge — impacto operativo de FIRDS y cobertura real por mercado

Fecha de corte: **11 de julio de 2026**. Rama observada: `codex/statsedge-ui-polish`.

Este documento es un estudio, no una implementación. No se activaron flags persistentes, no se cambiaron límites y no se escribieron datos de prueba. La evidencia de ejecución está en [`docs/evidence/firds-coverage-study-2026-07-11.md`](evidence/firds-coverage-study-2026-07-11.md).

**Postura de evidencia: research-grade.** Los tiempos, conteos de proveedor y estados Supabase indicados como M/X son reproducibles y tienen freeze time. Las cifras E son extrapolaciones explícitas de una sola muestra DE; los targets T proceden del plan interno y no prueban cobertura. No es decision-grade para activar producción porque falta medir mapping/OHLCV en muestras representativas de los demás mercados y el coste DB/scan del cron completo.

## Resumen ejecutivo

1. **La capacidad de proveedor/universo sí supera el target DE cuando se eliminan ambos caps artificiales.** Con key real y límites 20.000/20.000, el shard produjo 10.534 referencias estables, 960 símbolos `.DE`, 638 OHLCV-valid y una unión exacta de **642** tras sumar 32 curados y restar 28 solapes: **+142 sobre el target 500**. La ruta productiva actual no puede alcanzarlo porque el wrapper sigue capado a 500 y el cron a 3. [E9](evidence/firds-coverage-study-2026-07-11.md#e9--tercera-medición-de-openfigi-keyed-y-expansión-de-referencias)
2. **La referencia FIRDS no es un cuello temporal grave.** Medir los 13 mercados ESMA + UK acumuló **575.713 ms = 575,713 s = 9 min 35,713 s** de descarga/escaneo. El diseño repite descarga/descompresión por mercado, pero la magnitud correcta es minutos, no horas. [E2](evidence/firds-coverage-study-2026-07-11.md#e2--descargaescaneo-firds-por-mercado)
3. **El cron citado no hace esa descarga.** `app/api/cron/shadow-europe-refresh/route.js` consume referencias ya persistidas; rota cuatro cohortes, resuelve 3 ISIN/mercado y valida hasta 6 precios/mercado. Los flags afectan `getUniverse()` y el sembrado FIRDS, pero no activan por sí mismos ese cron.
4. **El `dryRun` del endpoint de sembrado no es estrictamente read-only.** Crea `provider_runs` y puede materializar snapshots antes de llegar al bloque `persist=false`; por eso la medición se hizo importando las funciones de proveedor directamente.
5. **Ya existe cobertura shadow real aunque los flags estén apagados:** 14.506 referencias, 578 resoluciones y 484 símbolos `priced`. La unión deduplicada curado + `priced` es 761 símbolos europeos, pero esa unión no es la lista principal que devuelve `getUniverse()` con los flags apagados. [E4](evidence/firds-coverage-study-2026-07-11.md#e4--estado-shadow-real-en-supabase)
6. **La key OpenFIGI real está confirmada y cambia radicalmente el throughput.** El wrapper devolvió `keyConfigured=true`; la primera corrida recibió headers keyed (`ratelimit-limit: 250`). En la comparación idéntica 5.000/5.000, OpenFIGI bajó de **1.197.089 ms** anónimo a **16.208 ms** keyed (73,86×); el total bajó de **1.220.985 ms** a **42.437 ms** (28,77×). Las tres corridas keyed sumaron 262 requests HTTP 200 y **cero 429**. [E9](evidence/firds-coverage-study-2026-07-11.md#e9--tercera-medición-de-openfigi-keyed-y-expansión-de-referencias)
7. **Japón no está configurado.** Las variables existen, pero contienen placeholders `your-*` que `envValue()` trata como ausentes; la llamada real fue 0 filas/0 ms. [E3](evidence/firds-coverage-study-2026-07-11.md#e3--universos-oficialesno-europeos)
8. **US y HK ya superan sus targets raw:** 7.090 NasdaqTrader y 2.768 HKEX medidos. No equivalen todavía a cobertura “investable”: US conserva unidades/SPAC y ninguno de esos conteos aplica la puerta final de liquidez, capitalización, frescura y calidad. [E3](evidence/firds-coverage-study-2026-07-11.md#e3--universos-oficialesno-europeos)
9. **Yahoo tampoco fue el cuello de botella a máxima cobertura.** Concurrencia 8, 960 comprobaciones terminaron en **19.638 ms = 19,638 s**, sin ningún 429; 638 pasaron. La corrida más generosa completa tardó **90.682 ms = 1 min 30,682 s**.
10. **TWSE no está caído de forma general.** El HTML oficial descargó y el parser real produjo 1.050 símbolos al ampliar el timeout a 30 s; el default de 6 s aborta a mitad de transferencia. La OpenAPI oficial respondió más rápido con 1.089 compañías, pero no incluye ISIN y no es un reemplazo exacto. [E7](evidence/firds-coverage-study-2026-07-11.md#e7--diagnóstico-twse)
11. **El shard DE observado se estabiliza en 10.534 referencias.** Tanto `referenceLimit=15.000` como 20.000 devolvieron 10.534 con `maxFiles=1` y `scanRecordLimit=750.000`. Es el techo estable del fichero/scan actual, no un master DE completo: FIRDS sigue agrupando por autoridad, incluye cross-listings y pueden existir otros shards.
12. **Europa no justifica una activación indiscriminada.** Con cap 20.000 y resolución completa, superan el target BE, ES, FR, IT, NO y GB; quedan por debajo AT, DK, FI, IE, NL, PT y SE. Ninguno topó 20.000 y OpenFIGI no produjo 429. [E10](evidence/firds-coverage-study-2026-07-11.md#e10--techo-real-y-ohlcv-de-los-otros-12-mercados-esma--fca-gb)

## Definiciones de cobertura

- **Curado visible:** `marketSymbols()` con los flags apagados.
- **Referencia:** ISIN/MIC/CFI FIRDS; no implica ticker ni OHLCV.
- **Resolved:** OpenFIGI produjo un símbolo aceptado por el sufijo del mercado.
- **Priced:** el símbolo pasó la puerta de ≥180 barras y precio ≤5 días de antigüedad.
- **Shadow union:** unión deduplicada de curado + `priced`. Es capacidad ya almacenada, no necesariamente expuesta por `getUniverse()`.
- **M:** medido en esta sesión. **X:** conteo exacto de código/DB. **E:** extrapolado. **T:** target de `coveragePlan.js`, no una medición.

# Estudio 1 — Impacto operativo real de activar los flags

## 1.1 Corrida controlada DE, de extremo a extremo

Se ejecutaron las funciones reales `fetchEsmaFirdsReferenceUniverse`, `mapOpenFigiIsins` y `fetchYahooChart` en un único proceso efímero, con `enabled:true` solo en argumentos y sin importar el store de escritura.

| Fase | Tiempo real | Resultado real |
|---|---:|---|
| Búsqueda + descarga + unzip + escaneo FIRDS | 18.974 ms = 18,974 s | 5.000 referencias; el número es un cap, por tanto solo demuestra **≥5.000** |
| OpenFIGI | 1.602 ms = 1,602 s | 25 ISIN enviados, 82 filas multi-venue, 9 símbolos `.DE` aceptados |
| Yahoo secuencial | 1.341 ms = 1,341 s | 9 comprobados, 8 pasan, 1 falla |
| **Total** | **21.918 ms = 21,918 s** | **8 OHLCV-valid de 25 ISIN** |

Evidencia: [log completo y lista de tickers E1](evidence/firds-coverage-study-2026-07-11.md#e1--corrida-de-completa-firds--openfigi--yahoo).

La muestra expone un problema de precisión: FIRDS agrupa por país de la autoridad relevante, no por domicilio del emisor ni mercado primario. Aparecieron ISIN canadienses, australianos, británicos, neerlandeses y chinos dentro de DE. OpenFIGI devolvió cotizaciones de múltiples países; StatsEdge descartó todas salvo `.DE`. Además, `XFRA` se normaliza a `.F`, pero `fetchFirdsUniverse("DE")` exige `.DE`, por lo que Frankfurt queda fuera aunque el instrumento sea alemán.

### ¿Es `RESOLVE_LIMIT_PER_MARKET=25` el cuello de botella?

Sí, para el adaptador live. Con 25 intentos no se puede producir un universo de 500 en una ejecución; el máximo matemático sería 25 ISIN resueltos y el resultado medido fue 8 OHLCV-valid. Incluso elevando solo ese env var, `fetchFirdsUniverse` tiene un cap interno de 500. Para llegar de forma estable a 500 hay que paginar/repetir lotes, deduplicar por ISIN/venue y validar OHLCV; no basta con activar el flag.

Hay un límite aún menor en operación: el cron shadow usa **3 ISIN por mercado y por turno** (`lib/cronPlan.js`), con máximo HTTP 10. Por tanto, `25` limita el refresco live/seed, mientras `3` gobierna el crecimiento normal del shadow cron.

## 1.2 Curva real de `resolveLimit` en DE

Se repitió el mismo pipeline en solo lectura con `.DE`, ≥180 barras y frescura ≤5 días. Yahoo usó concurrencia 8 en las tres nuevas corridas. `fetchFirdsUniverse()` limita internamente a 500, por lo que el punto 5.000 se ejecutó llamando directamente al mapper sobre 5.000 referencias, exactamente como artefacto de medición; **no es una configuración que el wrapper actual pueda alcanzar**.

| Límite | OpenFIGI | `.DE` únicos | OHLCV pasa | Tasa extremo a extremo | OpenFIGI | Yahoo | Total |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 25 | 82 filas | 9 | 8 | 32,00% | 1.602 ms = 1,602 s | 1.341 ms = 1,341 s, secuencial | 21.918 ms = 21,918 s |
| 100 | 283 filas | 18 | 16 | 16,00% | 3.561 ms = 3,561 s | 602 ms = 0,602 s | 17.076 ms = 17,076 s |
| 500 | 1.483 filas | 45 | 38 | 7,60% | 124.809 ms = 2 min 4,809 s | 1.030 ms = 1,030 s | 139.929 ms = 2 min 19,929 s |
| 5.000 | 14.824 filas | 484 | 437 | 8,74% | 1.197.089 ms = 19 min 57,089 s | 9.466 ms = 9,466 s | 1.220.985 ms = 20 min 20,985 s |

La muestra 25 estaba sesgada por orden alfabético y su 32% no escala. En 500–5.000, el rendimiento se estabiliza alrededor de 8–9%. El límite 500 sin pacing hizo 15 requests HTTP 200 y luego un 429; el mapper actual lanzó excepción y descartó el parcial. La cifra de 500 de la tabla procede de la repetición con pacing conservador, 50 requests de 10 jobs y cero 429. En 5.000 fueron 500 requests anónimas de 10 jobs; la espera por cuota domina los 19 min 57 s.

Para el objetivo DE de 500, los 437 nuevos no bastan. Incluso suponiendo, de forma irrealmente favorable, cero solape con los 32 curados, la unión máxima sería **469**. Alcanzar 500 exige ampliar referencias/shards y decidir el tratamiento de `.F`/venue primario; no basta con subir el límite.

Evidencia detallada y telemetría HTTP: [E6](evidence/firds-coverage-study-2026-07-11.md#e6--curva-de-resolvelimit-100--500--5000).

## 1.3 Tercera medición: key real y expansión 5.000 / 15.000 / 20.000

Antes de ejecutar se verificó `openFigiStatus()`: `keyConfigured=true`, `mode=api-key`. La autenticación quedó validada contra el proveedor en la primera respuesta: 50 requests HTTP 200, headers `ratelimit-limit: 250` y cero 429. Se mantuvieron filtro `.DE`, Yahoo `2A/D`, ≥180 barras, frescura ≤5 días y concurrencia 8.

El gate se reprodujo al cierre con `STATUS_ONLY=1 node --env-file=.env.local --import ./scripts/refactor-check/register.mjs docs/evidence/firds-curve-runner.mjs`; volvió a devolver `configured=true`, `keyConfigured=true`, `mode=api-key` sin imprimir la credencial.

| Entorno | Ref/resolve solicitados | Referencias / ISIN enviados | Filas OpenFIGI | `.DE` | OHLCV pass/fail | FIRDS | OpenFIGI | Yahoo | Total | Requests / 429 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| E6 anónimo | 5.000 / 5.000 | 5.000 / 5.000 | 14.824 | 484 | 437 / 47 | 14.427 ms | 1.197.089 ms | 9.466 ms | 1.220.985 ms | 500 / 0 |
| E9 keyed | 5.000 / 5.000 | 5.000 / 5.000 | 14.824 | 484 | 437 / 47 | 15.215 ms | 16.208 ms | 11.012 ms | 42.437 ms | 50 / 0 |
| E9 keyed | 15.000 / 15.000 | 10.534 / 10.534 | 32.317 | 960 | 638 / 322 | 43.148 ms | 64.477 ms | 18.659 ms | 126.293 ms | 106 / 0 |
| E9 keyed | 20.000 / 20.000 | 10.534 / 10.534 | 32.317 | 960 | 638 / 322 | 45.134 ms | 25.902 ms | 19.638 ms | **90.682 ms** | 106 / 0 |

### Key vs. sin key, misma cohorte

Con 5.000 referencias, los resultados fueron idénticos —14.824 filas, 484 `.DE`, 437 pass—, pero el total keyed fue **1.178.548 ms menor**, una reducción de **96,52%** o aceleración de **28,77×**. La fase OpenFIGI cayó **98,65%**, de 19 min 57,089 s a 16,208 s (**73,86×**). La key faltante era, por tanto, un artefacto de tiempo y número de requests; no explicaba el techo de 437, porque E6 sí completó los 5.000 ISIN mediante pacing.

### Expansión real y target 500

Subir conjuntamente referencia y resolución encontró **10.534** referencias tanto con cap 15.000 como 20.000. El número es estable para el único shard y scan actual; no debe llamarse universo DE completo. De 10.534 ISIN, OpenFIGI mapeó 10.453 al menos una vez, 960 sobrevivieron como `.DE` y 638 símbolos únicos pasaron OHLCV.

| Métrica | E6 anterior | E9 máxima |
|---|---:|---:|
| FIRDS `.DE` OHLCV-valid | 437 | 638 |
| Curados DE | 32 | 32 |
| Solape exacto | no medido | 28 |
| Unión exacta | ≤469 (cota superior) | **642** |
| Target | 500 | 500 |
| Superávit / (déficit) | ≤−31 | **+142** |

La estimación anterior de 469 era una cota superior sobre una muestra de 5.000, no un techo estructural. Al ampliar ambos límites, el runner de estudio supera el target en 142. Esto elimina la capacidad del proveedor/universo como bloqueo para DE, pero no convierte la activación actual en 642 símbolos: `fetchFirdsUniverse()` sigue capado a 500, el cron shadow a 3 y la ruta productiva no ejecuta este batch directo.

La corrida más generosa tardó **90.682 ms = 90,682 s = 1 min 30,682 s**: 45,134 s FIRDS, 25,902 s OpenFIGI y 19,638 s Yahoo. No incluye DB, persistencia, scans posteriores ni el cron completo. La corrida 15.000 fue más lenta (126,293 s) pese a procesar el mismo conjunto, por variabilidad de proveedor/descarga de cuerpos; no se usa como expectativa determinista.

Evidencia completa: [E9](evidence/firds-coverage-study-2026-07-11.md#e9--tercera-medición-de-openfigi-keyed-y-expansión-de-referencias).

## 1.4 Medición completa del resto de FIRDS + UK

| Mercado | Referencias reales | Símbolos OHLCV-valid | Target | ¿Supera? | Tiempo total |
|---|---:|---:|---:|:---:|---:|
| AT | 78 | 66 | 70 | No (−4) | 16.955 ms |
| BE | 191 | 114 | 100 | Sí (+14) | 19.328 ms |
| DK | 144 | 80 | 120 | No (−40) | 18.277 ms |
| ES | 319 | 233 | 140 | Sí (+93) | 21.513 ms |
| FI | 186 | 133 | 150 | No (−17) | 19.550 ms |
| FR | 1.373 | 645 | 450 | Sí (+195) | 36.216 ms |
| IE | 57 | 15 | 50 | No (−35) | 15.825 ms |
| IT | 427 | 393 | 300 | Sí (+93) | 24.112 ms |
| NL | 162 | 104 | 200 | No (−96) | 17.915 ms |
| NO | 267 | 245 | 180 | Sí (+65) | 21.241 ms |
| PT | 46 | 39 | 50 | No (−11) | 16.192 ms |
| SE | 951 | 203 | 350 | No (−147) | 26.294 ms |
| GB/FCA | 11.375 | 1.434 | 650 | Sí (+784) | 167.902 ms |

La tabla compara el conjunto FIRDS/FCA OHLCV-valid por sí solo contra el target. Añadir curados no cambia ningún veredicto: las uniones de los siete mercados deficitarios son AT 66, DK 89, FI 133, IE 17, NL 107, PT 39 y SE 230.

Ninguno topó el cap 20.000. Los conteos ESMA son idénticos a E2 porque ya estaban por debajo de 5.000; GB deja de estar capado y converge en 11.375. La fase FIRDS actual fue 13,021–14,462 s para ESMA y 24,127 s para FCA, frente a 41,918–48,647 s y 32,902 s en E2: subir el cap no añadió coste observable; la bajada es variabilidad de descarga/proveedor. OpenFIGI resolvió todas las referencias con key real y cero 429. Evidencia y desglose de los déficits: [E10](evidence/firds-coverage-study-2026-07-11.md#e10--techo-real-y-ohlcv-de-los-otros-12-mercados-esma--fca-gb).

No debe usarse el conteo FIRDS como techo de acciones domésticas: los shards agrupan por autoridad, incluyen cross-listings y `maxFiles=1` no prueba completitud. En SE, por ejemplo, 951 referencias se reducen a 392 símbolos `.ST` y 203 OHLCV-valid; en IE solo existen 57 referencias observadas y 15 pasan.

## 1.5 Coste para cron

### Sembrado/refresco FIRDS

E2 estimaba **616.915 ms** para una pasada ligera de 25 ISIN/mercado. E9+E10 sustituyen esa extrapolación por resolución completa real: sumar las 14 corridas independientes da **512.002 ms = 8 min 32,002 s provider-only**, incluidos 10.534 ISIN DE y 11.375 GB. La suma es orientativa para batch —cada proceso repitió búsqueda/descarga— y no incluye DB, persistencia ni scan.

Ese coste no cabe en una función única con `maxDuration=60`, pero es razonable para jobs paginados por mercado. `shadow-europe-refresh` no ejecuta este sembrado completo y su cap 3 continúa siendo otra ruta operativa.

### `shadow-europe-refresh`

Ese cron no descarga FIRDS y no procesa todos los mercados a la vez: rota UK (1), Nordics (4), West (3) y South (2); AT/BE/IE/PT no están en ninguna cohorte. Con 3 ISIN y hasta 6 precios por mercado, el provider-only estimado es **1,1–2,5 s por mercado E**, o **4,3–10,0 s E** para la cohorte máxima de cuatro. El rango trata la latencia OpenFIGI como lineal en el extremo bajo y como una petición completa en el alto. DB, cache, scan y leaderboards no se midieron; por tanto no presento un “tiempo total del cron” ficticio.

Hipotéticamente meter los 14 mercados en una sola ejecución añadiría **15,1–34,9 s E** solo para OpenFIGI + Yahoo, antes de DB/scan. Con `maxDuration=60`, sería una configuración de riesgo.

## 1.6 Riesgos operativos adicionales

- `unzipSync` carga el ZIP completo en memoria y ESMA decodifica XML completo.
- La caché por mercado repite búsqueda, descarga y descompresión del mismo shard.
- OpenFIGI no implementa retry/backoff aunque su documentación recomienda reintento exponencial para 500/503.
- El endpoint seed hace dos pasadas lógicas —referencias y resolved—; la caché evita una segunda descarga dentro del mismo mercado/proceso, pero no entre mercados.
- El `dryRun` seed crea logs y puede escribir snapshots; no debe usarse como prueba “sin residuos” hasta corregirlo.

# Estudio 2 — Cobertura real alcanzable por mercado

## 2.1 Europa y UK

La columna “hoy” muestra el universo principal curado con flags off y, tras `/`, la unión exacta curado + shadow `priced`. “1 refresh” es la cobertura OHLCV-ready superior aproximada tras sumar el rendimiento de ocho símbolos; solo DE está medido y en los demás es extrapolación.

Esta tabla describe la ruta productiva **con sus límites actuales**, no el techo del runner. E10 ya mide el techo completo de los otros mercados; por tanto, las aproximaciones “1 refresh” no deben usarse para decidir capacidad máxima.

| Mercado | Estado real | Hoy: main / shadow union | Target; hueco main | Si se activa con límites actuales | Coste operativo | Bloqueadores reales |
|---|---|---:|---:|---|---|---|
| GB | FCA integrado, flag off | 44 / 81 X | 650; 606 | ≈52 E en 1 refresh; 81 X ya logrados shadow | seed 32,902 s M; cron 1,1–2,5 s E | cap 25; cron 3; FCA cap 5.000; cross-listings |
| DE | ESMA integrado, flag off | 32 / 144 X | 500; 468 | 40 con límites live; **642** unión exacta en runner máximo | seed original 18,974 s; runner máximo 90,682 s; cron 1,1–2,5 s E | cap live 500/cron 3; `.F` descartado; 10.534 refs en shard |
| FR | ESMA integrado, flag off | 33 / 131 X | 450; 417 | ≈41 E; 131 X shadow | seed 44,149 s M; cron 1,1–2,5 s E | cap 25/3; cross-listings; OHLCV no medido |
| NL | ESMA integrado, flag off | 22 / 52 X | 200; 178 | ≈30 E; 52 X shadow | seed 41,974 s M; cron 1,1–2,5 s E | cap 25/3; Yahoo mapping |
| SE | ESMA + core nórdico | 41 / 53 X | 350; 309 | ≈49 E; 53 X shadow | seed 41,918 s M; cron 1,1–2,5 s E | full Nasdaq Nordic comercial; cap 25/3 |
| DK | ESMA + core nórdico | 27 / 45 X | 120; 93 | ≈35 E; 45 X shadow | seed 44,448 s M; cron 1,1–2,5 s E | full Nasdaq Nordic comercial; cap 25/3 |
| NO | ESMA + core curado | 31 / 68 X | 180; 149 | ≈39 E; 68 X shadow | seed 42,315 s M; cron 1,1–2,5 s E | Euronext master comercial; cap 25/3 |
| FI | ESMA + core curado | 13 / 41 X | 150; 137 | ≈21 E; 41 X shadow | seed 43,061 s M; cron 1,1–2,5 s E | full Nasdaq Nordic comercial; cap 25/3 |
| IT | adaptador ESMA existe; plan dice gap | 25 / 66 X | 300; 275 | ≈33 E; 66 X shadow | seed 42,248 s M; cron 1,1–2,5 s E | status del plan desactualizado; cap 25/3 |
| ES | adaptador ESMA existe; plan dice gap | 33 / 61 X | 140; 107 | ≈41 E; 61 X shadow | seed 42,767 s M; cron 1,1–2,5 s E | status del plan desactualizado; cap 25/3 |
| BE | adaptador ESMA existe; plan dice gap | 6 / 6 X | 100; 94 | ≈14 E | seed 45,801 s M; **sin shadow cron** | omitido de seed default y cohorts; 0 refs DB |
| PT | adaptador ESMA existe; plan dice gap | 5 / 5 X | 50; 45 | ≈13 E | seed 42,483 s M; **sin shadow cron** | omitido de seed default y cohorts; 0 refs DB |
| AT | adaptador ESMA existe; plan dice gap | 5 / 5 X | 70; 65 | ≈13 E | seed 48,647 s M; **sin shadow cron** | omitido de seed default y cohorts; 0 refs DB |
| IE | adaptador ESMA existe; plan dice gap | 3 / 3 X | 50; 47 | ≈11 E | seed 44,026 s M; **sin shadow cron** | omitido de seed default y cohorts; 0 refs DB |
| CH | solo curado; fuera de FIRDS | 69 / 69 X | 250; 181 | sin master gratuito confirmado | sin provider cron | SIX ofrece CSV EOD, no un security master equivalente; licencia por confirmar |

El baseline curado y targets se reproducen en [E5](evidence/firds-coverage-study-2026-07-11.md#e5--baseline-curado-derivado-del-código); la unión shadow exacta, en [E4](evidence/firds-coverage-study-2026-07-11.md#e4--estado-shadow-real-en-supabase).

### Licencias europeas

- Nasdaq ofrece ficheros completos de Helsinki, Estocolmo, Copenhague e Islandia con ISIN/ticker/acciones listadas como producto entitlement; la tarifa publicada de abril de 2026 era €236/mes. No encontré un master oficial completo, automatizable y con redistribución clara gratis. [Producto Nasdaq Nordic](https://www.nasdaq.com/solutions/data/nasdaq-nordic-reference-data-files), [pricing/policies](https://www.nasdaq.com/sv/node/16128091).
- Euronext comercializa referencia avanzada/full-market para Oslo y otros mercados. FIRDS + OpenFIGI es una alternativa gratuita razonable para discovery, pero la medición no demuestra master completeness ni derechos sobre OHLCV. [Euronext Advanced Reference Data](https://www.euronext.com/en/products-services/advanced-reference-data), [client specification 2026](https://connect2.euronext.com/sites/default/files/documentation/clearing/euronext-markets-advanced-reference-data-client-specification-v355013012026_0.pdf).
- Suiza: retiro la equivalencia anterior entre un CSV público y un master gratuito. SIX publica [precios de cierre](https://www.six-group.com/en/market-data/shares/closing-prices.html) e [históricos](https://www.six-group.com/en/market-data/statistics/historical-prices.html), útiles para discovery/EOD, pero no prueban un security master completo ni redistribución comercial. La [tarifa/licencia SIX Exfeed de abril de 2026](https://www.six-group.com/dam/download/market-data/exfeed/price-lists/six-exfeed-mdla-pricelist-april-2026-markup.pdf) contempla licencias específicas. Producción requiere confirmación contractual.

## 2.2 Resto de mercados

| Mercado | Estado real | Cobertura hoy M/X | Target; hueco | Alcanzable | Coste medido/estimado | Bloqueadores reales |
|---|---|---:|---:|---|---|---|
| US | NasdaqTrader integrado | 7.090 M raw | 5.500; 0 raw | 7.090 M raw | 1,399 s M refresh | filtro investable insuficiente; OHLCV/quality gate no contados |
| HK | HKEX integrado | 2.768 M raw | 2.500; 0 raw | 2.768 M raw | 6,013 s M refresh | parser/layout y licencia de operación; OHLCV no auditado |
| AU | ASIC short + curado | 690 M raw | 1.200; 510 | 1.200 T con master, no medido | 0,402 s M ASIC | ASIC solo cubre short-report; ASX master licenciado |
| JP | J-Quants adapter, **no configurado** | 73 X curados | 1.500; 1.427 | 1.500 T, no medido | 0 ms M porque no hubo key | API key real; plan/licencia Pro si uso comercial; rate limit |
| TW | TWSE integrado; timeout default insuficiente | 1.050 M TWSE HTML; 12 X fallback con default | 900; 0 raw a 30 s | 1.050 M raw TWSE | 19,744 s M HTML; 3,918 s M OpenAPI | subir timeout/cache; OpenAPI no trae ISIN; falta TPEX |
| CA | core curado | 205 X | 1.000; 795 | directorio público, no master comercial confirmado | cron scan 24 símbolos/turno | términos TMX limitan uso no comercial; licencia para producción |
| SG | core curado | 45 X | 350; 305 | 350 T, no medido | cron scan 12/turno | SGX directory no equivale a bulk master/licencia |
| KR | solo curado | 10 X | 1.100; 1.090 | OpenDART con key como company master parcial | sin cron | KRX bulk/API no confirmado; OpenDART mezcla no listadas y no clasifica KOSPI/KOSDAQ |
| IN | diferido, curado | 75 X | 1.200; 1.125 | CSV NSE Main Board útil, no licencia comercial | sin cron | ficheros separados para SME/ETF; acuerdo para uso/redistribución comercial |
| IL | diferido, curado | 33 X | 450; 417 | 450 T, no medido | sin cron | TASE Data Hub/API y permiso/plan |
| CN | solo curado | 14 X | 1.600; 1.586 | 1.600 T, no medido | sin cron | adaptadores SSE/SZSE, idioma/mapping y OHLCV |
| ZA | core curado | 55 X | 250; 195 | 250 T, no medido | cron scan 12/turno | master JSE/licencia y OHLCV |
| BR | solo curado | 10 X | 250; 240 | 250 T, no medido | sin cron | adaptador B3, términos y OHLCV |
| MX | solo curado | 8 X | 120; 112 | 120 T, no medido | sin cron | adaptador BMV, términos y OHLCV |

### Alternativas gratuitas y límites legales

- **Canadá — afirmación corregida:** el [TMX Listed Company Directory](https://www.tsx.com/en/listings/listing-with-us/listed-company-directory) ofrece descarga pública de nombres y símbolos TSX/TSXV. Sin embargo, los [términos de TMX](https://www.tsx.com/en/terms-of-use) limitan el uso a fines personales/no comerciales y prohíben distribución, republicación y obras derivadas sin permiso. Sirve para comprobación manual/prototipo; **no queda confirmado como master gratuito para StatsEdge comercial**. Para producción hay que licenciarlo con TMX/Datalinx o conseguir permiso.
- **Suiza — afirmación corregida:** los CSV públicos de [closing prices](https://www.six-group.com/en/market-data/shares/closing-prices.html) e [historical prices](https://www.six-group.com/en/market-data/statistics/historical-prices.html) aportan símbolo/precio/volumen EOD, no un master completo. La [documentación de precios/licencias](https://www.six-group.com/dam/download/market-data/exfeed/price-lists/six-exfeed-mdla-pricelist-april-2026-markup.pdf) confirma que ciertos usos de referencia requieren licencia. **Retiro la afirmación de que existe un sustituto gratuito equivalente.**
- **Corea — afirmación corregida:** KRX ofrece una [pantalla oficial](https://global.krx.co.kr/contents/GLB/03/0308/0308010000/GLB0308010000.jsp) con búsqueda y descarga para KOSPI/KOSDAQ/KONEX, pero no quedó confirmado un endpoint bulk estable ni derechos de redistribución. La alternativa oficial técnicamente documentada es [OpenDART Corporation Code](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DE001&apiId=AE00004): requiere API key y devuelve código, nombre y `stock_code`; incluye no listadas y no aporta clasificación de mercado. Es un company master autenticado y parcial, no un instrument master KRX.
- **India — afirmación corregida:** NSE publica el [directorio de valores negociables](https://www.nseindia.com/static/market-data/securities-available-for-trading) y el [CSV directo del segmento equity](https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv), sin autenticación, con símbolo, compañía, serie, fecha de listing e ISIN. No cubre por sí solo SME/ETF y la [Data Sharing and Usage Policy](https://nsearchives.nseindia.com/web/sites/default/files/inline-files/NSE_Data_Sharing_and_Usage_Policy_0.pdf) exige acuerdo/precio para usos comerciales y restringe redistribución. Es la fuente técnica más directa de las cuatro, pero **no una licencia comercial gratuita**.
- **Taiwán:** el [endpoint ISIN de TWSE](https://isin.twse.com.tw/isin/e_C_public.jsp?strMode=2) sí funciona con un timeout adecuado. La [OpenAPI oficial](https://openapi.twse.com.tw/v1/opendata/t187ap03_L) es más rápida y aporta datos básicos de compañías, pero no ISIN/CFI. Es fallback/complemento, no sustituto semántico exacto.
- **Hong Kong:** la Full List gratuita funcionó y devolvió 2.768 filas. Para un master diario contractual, HKEX vende Securities Master File por HK$1.000/mes en su catálogo. [HKEX Securities Master File](https://www.hkex.com.hk/eng/ods/historicalDataProfile.aspx?ProductID=%2F4gJGeo8HhiXrJyflPnaivkYY6ztFMqJBrNB1Pdgsrg%3D&SchemeID=THTu3mhSmcGOGp9mXI5FBSOdEJeg5VsH3OHbAH6vwlk%3D&isPrint=Y).
- **Australia:** el Company Directory es público, pero ASX declara exclusiones y contenido con copyright LSEG/Morningstar; no sustituye al Master List. ReferencePoint Master List es el producto oficial completo. [ASX directory](https://www.asx.com.au/markets/trade-our-cash-market/directory), [ASX ReferencePoint](https://www.asx.com.au/connectivity-and-data/information-services/reference-data).
- **Japón:** J-Quants V2 requiere API key. El plan Free incluye master/OHLC con retraso, pero el servicio retail limita distribución/uso continuado a terceros; para StatsEdge comercial corresponde J-Quants Pro. [Planes J-Quants](https://elb.test-dlv.jpx-jquants.com/), [J-Quants Pro license](https://pro.jpx-jquants.com/termsofservice).
- **OpenFIGI:** API y FIGI son gratuitos y reutilizables comercialmente, pero OpenFIGI es mapping, no un master de bolsa ni proveedor OHLCV. [API](https://www.openfigi.com/api/documentation), [términos](https://www.openfigi.com/docs/terms-of-service).

No encontré evidencia suficiente para afirmar que los directorios gratuitos de SGX/JSE/TASE/B3/BMV/SSE/SZSE permitan una redistribución comercial amplia. Deben considerarse fuentes de discovery hasta revisar términos; no los presento como sustitutos legales confirmados.

## 2.3 Hallazgos de consistencia del código

1. `coveragePlan.js` marca IT/ES/BE/PT/AT/IE como `gap`, pero el adaptador ESMA ya soporta los seis.
2. AT/BE/IE/PT no están en `DEFAULT_MARKETS` del seed ni en las cohortes shadow; activar el flag no los mantiene operativamente.
3. Las policies de readiness no exigen FIRDS para Europa; un mercado puede aparecer `operational` por ratios genéricos sin probar fuente oficial.
4. JP busca la fuente exacta `J-Quants`, mientras el adapter emite `J-Quants V2 equities/master`; podría dejar `officialCount=0` aun con key válida.
5. El cron de universos omite KR/CN/BR/MX aunque aparecen en `CORE_COVERAGE_MARKETS`; IN/IL también quedan fuera por diseño.
6. AU usa un informe de posiciones cortas como pseudo-universo: 690 no significa 690/1.200 del master ASX.
7. `actionable` es alias legacy de `rankingEligible`; no debe confundirse con número de tickers descubiertos o `priced`.

## Conclusión y decisión recomendada

**Las mediciones keyed completas cambian el diagnóstico europeo.** DE produjo una unión exacta de 642 (+142), y BE, ES, FR, IT, NO y GB también superan sus targets solo con símbolos FIRDS/FCA OHLCV-valid. AT, DK, FI, IE, NL, PT y SE no los alcanzan ni después de resolver todo el shard observado. Las 14 corridas suman 512.002 ms provider-only y OpenFIGI no produjo ningún 429.

Esto no justifica activar ambos flags globalmente sin cambios de código. La capacidad existe en el runner directo, pero la ruta live sigue limitada a 500 ISIN y el cron a 3; por tanto, activarla hoy no materializa los 642. Además, el conjunto sigue siendo un discovery universe de autoridad DE con cross-listings y filtro `.DE`, no una lista doméstica/venue-primary limpia.

### Qué cambia frente al informe anterior

- Se elimina el coste temporal FIRDS como fundamento para posponer la activación.
- La key OpenFIGI deja de ser un dato pendiente: está activa y validada con respuestas/header keyed. Para 5.000, OpenFIGI pasa de 19 min 57,089 s a 16,208 s.
- Se retira la afirmación amplia de que CA/CH/KR/IN tienen masters oficiales gratuitos aptos para producción comercial. Hay fuentes públicas útiles, pero con alcance o licencias limitados.
- TWSE pasa de “endpoint que no responde” a “timeout default insuficiente”; a 30 s el adaptador produjo 1.050 símbolos.
- La cota anterior ≤469 queda sustituida por una unión exacta de 642 al resolver las 10.534 referencias del shard observado.
- La limitación anterior de 437 era de amplitud de muestra; la key faltante explicaba el tiempo, no ese yield para los mismos 5.000.
- La estimación de 25 ISIN para el resto de Europa queda sustituida por E10: resolución completa y OHLCV real de todos los shards observados.

### Qué no cambia

- Activar los flags en la ruta actual sigue sin entregar 500 símbolos, porque `fetchFirdsUniverse()` continúa capado a 500 y el cron a 3. Los puntos 5.000/10.534 requirieron un runner fuera del wrapper.
- Cross-listings, venue primario y la exclusión de `.F` siguen contaminando la equivalencia “autoridad DE = mercado DE”.
- El cron shadow de 3 ISIN y las cohorts incompletas siguen siendo insuficientes para crecimiento rápido y mantenimiento de todos los mercados.
- El endpoint seed `dryRun` sigue sin ser estrictamente read-only.
- El mapper productivo sigue sin retry/backoff ni conservación de parciales ante un 429, aunque en las corridas keyed no apareció ninguno.

**Decisión:** no activar FIRDS/FCA para todos los mercados europeos de una vez. Sí preparar un rollout paginado y controlado para **DE, BE, ES, FR, IT, NO y GB**, que superan sus targets en la medición completa. **AT, DK, FI, IE, NL, PT y SE no justifican el flag como solución suficiente de cobertura**: incluso resolviendo todo el shard observado quedan por debajo; IE y NL son los déficits estructurales más claros, y SE requiere corregir venue/símbolo/calidad además de ampliar referencias. Antes del rollout siguen siendo necesarios: (1) eliminar el cap productivo 500 con checkpoints y conservación de parciales; (2) ampliar el cron más allá de 3; (3) introducir allowlist/cohortes por mercado; (4) medir DB/scan. FCA-GB debe desplegarse como fuente separada de ESMA.
