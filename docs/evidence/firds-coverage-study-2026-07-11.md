# Evidencia de ejecución — estudio FIRDS y cobertura (2026-07-11)

Todas las horas están en UTC. Las corridas fueron procesos Node efímeros, de solo lectura, cargando las funciones reales del repositorio. No se invocaron endpoints de cron, no se cambiaron flags persistentes y no se escribieron filas en Supabase. Las lecturas de Supabase utilizaron `GET`/conteo exacto.

## E1 — Corrida DE completa: FIRDS → OpenFIGI → Yahoo

Inicio: `2026-07-11T09:10:20.132Z`
Fin: `2026-07-11T09:10:42.051Z`

Parámetros efectivos:

```json
{
  "market": "DE",
  "maxFiles": 1,
  "scanRecordLimit": 750000,
  "referenceLimit": 5000,
  "resolveLimit": 25,
  "minBars": 180,
  "maxAgeDays": 5
}
```

Resultado:

```json
{
  "phasesMs": {
    "referenceDownloadAndScan": 18974,
    "openfigi": 1602,
    "ohlcvSequential": 1341,
    "total": 21918
  },
  "counts": {
    "referencesIdentified": 5000,
    "isinsSubmitted": 25,
    "openfigiRowsAllMarkets": 82,
    "marketMatchedMapped": 9,
    "ohlcvChecked": 9,
    "ohlcvPassed": 8,
    "ohlcvFailed": 1
  }
}
```

OpenFIGI devolvió 82 filas multi-venue para 25 ISIN. Los nueve símbolos que sobrevivieron al filtro de mercado `.DE` fueron:

| ISIN | Símbolo | Yahoo | Barras | Última fecha | Duración Yahoo |
|---|---|---:|---:|---|---:|
| DE000A2LQ2D0 | Z29.DE | pasa | 507 | 2026-07-10 | 226 ms |
| DE0005545503 | 1U1.DE | pasa | 507 | 2026-07-10 | 118 ms |
| DE0005118806 | TGT.DE | pasa | 507 | 2026-07-10 | 104 ms |
| DE000A2P4HL9 | 123F.DE | pasa | 507 | 2026-07-10 | 93 ms |
| DE000A0HL8N9 | 2GB.DE | pasa | 507 | 2026-07-10 | 110 ms |
| DE000A3H3L44 | 2INV.DE | falla | 0 | — | 89 ms |
| DE0005167902 | UUU.DE | pasa | 507 | 2026-07-10 | 135 ms |
| DE000A11QW68 | HRPK.DE | pasa | 507 | 2026-07-10 | 183 ms |
| NL0010872388 | 3SQ1.DE | pasa | 507 | 2026-07-10 | 283 ms |

Error literal de `2INV.DE`: `Yahoo historico insuficiente · Stooq fallback sin STOOQ_API_KEY · Alpha Vantage sin ALPHA_VANTAGE_API_KEY`.

Muestra que demuestra que “autoridad DE” no equivale a “emisor alemán”: las primeras referencias incluyeron `CA65442J1075` (1911 Gold Corp.) y OpenFIGI devolvió para los 25 ISIN símbolos de DE, FR, UK, Suiza, Austria, Canadá, US, Australia, Hong Kong y México.

Volumen real generado: 25 mapping jobs de OpenFIGI y nueve consultas secuenciales de gráfico Yahoo. Esta primera corrida no instrumentó el número de requests ni verificó autenticación. La comprobación posterior mostró `keyConfigured=false` porque `.env.local` contenía un placeholder `your-*`; con el límite anónimo de 10 jobs/request, lo esperable son tres requests, no una petición autenticada. No hubo escrituras.

## E2 — Descarga/escaneo FIRDS por mercado

Límites: 1 fichero, 750.000 registros escaneables, 5.000 referencias por mercado. Solo referencia: sin OpenFIGI ni Yahoo.

| Mercado | Fuente | Referencias | Tiempo medido |
|---|---|---:|---:|
| AT | ESMA | 78 | 48.647 s |
| BE | ESMA | 191 | 45.801 s |
| DE | ESMA | 5.000 (cap) | 18.974 s |
| DK | ESMA | 144 | 44.448 s |
| ES | ESMA | 319 | 42.767 s |
| FI | ESMA | 186 | 43.061 s |
| FR | ESMA | 1.373 | 44.149 s |
| IE | ESMA | 57 | 44.026 s (retry; primer intento falló en 0.194 s) |
| IT | ESMA | 427 | 42.248 s |
| NL | ESMA | 162 | 41.974 s |
| NO | ESMA | 267 | 42.315 s |
| PT | ESMA | 46 | 42.483 s |
| SE | ESMA | 951 | 41.918 s |
| GB | FCA | 5.000 (cap) | 32.902 s |

Suma observada sustituyendo el intento fallido de IE por su retry: **575.713 ms = 575,713 s (9 min 35,713 s)**. El fichero se descargó y descomprimió de nuevo por mercado porque la caché de `officialUniverses.js` está indexada por mercado.

## E3 — Universos oficiales/no europeos

Corrida directa de solo lectura:

| Mercado/fuente | Resultado | Tiempo | Nota |
|---|---:|---:|---|
| US / NasdaqTrader | 7.090 | 1.399 s | Directorios raw tras excluir ETF/test issues; no se aplicó quality gate de liquidez/capitalización |
| HK / HKEX Full List | 2.768 | 6.013 s | Parser integrado funcionando |
| AU / ASIC short reports + curado | 690 | 0.402 s | 680 ASIC + 10 curados; ASIC no es master ASX |
| TW / TWSE actual | error inicial | 6.006 s y un intento que agotó 30.006 s | Diagnóstico posterior E7: el endpoint sí funciona; la latencia/transferencia es variable y el default 6 s es insuficiente |
| JP / J-Quants | 0 | 0 ms | `JQUANTS_API_KEY` y tokens eran placeholders `your-*`, rechazados por `envValue()`; no hubo llamada de red |

## E4 — Estado shadow real en Supabase

Lectura a `2026-07-11T09:22:40.604Z`:

| Mercado | Referencias FIRDS persistidas | Resoluciones totales |
|---|---:|---:|
| AT | 0 | 0 |
| BE | 0 | 0 |
| DE | 10.417 | 146 |
| DK | 142 | 42 |
| ES | 312 | 41 |
| FI | 183 | 31 |
| FR | 1.441 | 109 |
| GB | 216 | 57 |
| IE | 0 | 0 |
| IT | 421 | 44 |
| NL | 159 | 41 |
| NO | 263 | 45 |
| PT | 0 | 0 |
| SE | 952 | 22 |
| **Total** | **14.506** | **578** |

Estados exactos de `symbol_resolutions` a `2026-07-11T09:23:25.804Z`:

| Mercado | resolved | priced | stale | price-unavailable |
|---|---:|---:|---:|---:|
| DE | 12 | 113 | 6 | 15 |
| DK | 0 | 24 | 2 | 16 |
| ES | 0 | 37 | 0 | 4 |
| FI | 0 | 28 | 3 | 0 |
| FR | 0 | 107 | 1 | 1 |
| GB | 0 | 38 | 6 | 13 |
| IT | 0 | 44 | 0 | 0 |
| NL | 0 | 38 | 2 | 1 |
| NO | 0 | 42 | 3 | 0 |
| SE | 0 | 13 | 0 | 9 |
| AT/BE/IE/PT | 0 | 0 | 0 | 0 |
| **Total** | **12** | **484** | **23** | **59** |

Unión deduplicada de símbolos curados + shadow `priced`:

| Mercado | Curado | Priced único | Solape | Unión |
|---|---:|---:|---:|---:|
| AT | 5 | 0 | 0 | 5 |
| BE | 6 | 0 | 0 | 6 |
| DE | 32 | 113 | 1 | 144 |
| DK | 27 | 24 | 6 | 45 |
| ES | 33 | 37 | 9 | 61 |
| FI | 13 | 28 | 0 | 41 |
| FR | 33 | 107 | 9 | 131 |
| GB | 44 | 38 | 1 | 81 |
| IE | 3 | 0 | 0 | 3 |
| IT | 25 | 44 | 3 | 66 |
| NL | 22 | 38 | 8 | 52 |
| NO | 31 | 42 | 5 | 68 |
| PT | 5 | 0 | 0 | 5 |
| SE | 41 | 13 | 1 | 53 |
| **Total** | **320** | **484** | **43** | **761** |

## E5 — Baseline curado derivado del código

Conteos de `marketSymbols()` (CURATED + EXTRA + EXPANDED, deduplicados), targets de `coveragePlan.js`:

```text
US 155/5500; AU 10/1200; JP 73/1500; HK 76/2500;
GB 44/650; DE 32/500; FR 33/450; NL 22/200; CH 69/250;
SE 41/350; DK 27/120; NO 31/180; FI 13/150; IT 25/300;
ES 33/140; BE 6/100; PT 5/50; AT 5/70; IE 3/50;
CA 205/1000; SG 45/350; TW 12/900; KR 10/1100;
IN 75/1200; IL 33/450; CN 14/1600; ZA 55/250;
BR 10/250; MX 8/120.
```

Total: 1.170 símbolos curados únicos frente a 21.480 de target agregado.

## E6 — Curva de `resolveLimit`: 100 / 500 / 5.000

Runner de evidencia: [`firds-curve-runner.mjs`](firds-curve-runner.mjs). Importa directamente las funciones de proveedor; no importa stores Supabase ni endpoints. Parámetros comunes: DE, un fichero, 750.000 registros escaneables, 5.000 referencias, filtro `.DE`, Yahoo `2A/D`, mínimo 180 barras, frescura máxima 5 días y concurrencia Yahoo 8.

`fetchFirdsUniverse()` limita `resolveLimit` a 500. Para medir 5.000, el runner pasó las 5.000 referencias directamente a `mapOpenFigiIsins`; este punto mide la capacidad del mapper/proveedores, no una ruta actualmente alcanzable por el wrapper.

Estado de credencial observado en las tres corridas nuevas:

```json
{
  "openFigiKeyConfigured": false,
  "reason": "OPENFIGI_API_KEY era placeholder your-* y envValue() lo rechaza"
}
```

| Resolve limit | Inicio UTC | Fin UTC | FIRDS | OpenFIGI | Yahoo | Total | ISIN con mapping | `.DE` únicos | OHLCV pass/fail |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| 100 | 09:44:03.472 | 09:44:20.550 | 12.913 ms | 3.561 ms | 602 ms | 17.076 ms | 99 | 18 | 16 / 2 |
| 500, paced | 09:45:55.926 | 09:48:15.856 | 14.090 ms | 124.809 ms | 1.030 ms | 139.929 ms | 496 | 45 | 38 / 7 |
| 5.000, paced | 09:48:44.918 | 10:09:05.906 | 14.427 ms | 1.197.089 ms | 9.466 ms | 1.220.985 ms | 4.959 | 484 | 437 / 47 |

Conversión inequívoca de totales: **17.076 ms = 17,076 s**; **139.929 ms = 139,929 s = 2 min 19,929 s**; **1.220.985 ms = 1.220,985 s = 20 min 20,985 s**.

Tasas:

| Resolve limit | Match `.DE` / enviados | OHLCV pass / `.DE` | Pass / enviados |
|---:|---:|---:|---:|
| 25 (E1) | 36,00% | 88,89% | 32,00% |
| 100 | 18,00% | 88,89% | 16,00% |
| 500 | 9,00% | 84,44% | 7,60% |
| 5.000 | 9,68% | 90,29% | 8,74% |

### OpenFIGI y rate limits

- 100: 10 requests, todos 200, cero 429. Último header observado: límite 25, remaining 15, reset 58.
- 500 sin pacing: 16 requests; 15 fueron 200 y el 16.º fue 429. `mapOpenFigiIsins` lanzó y no devolvió las filas parciales. Duración hasta fallo: 16.279 ms total; no se ejecutó Yahoo.
- 500 con pacing: 50 requests de 10 jobs, todos 200; tiempo de servicio HTTP agregado 8.442 ms, pero tiempo de fase 124.809 ms por esperas de cuota.
- 5.000 con pacing: 500 requests de 10 jobs, todos 200; servicio HTTP agregado 83.090 ms, fase 1.197.089 ms. La espera por cuota dominó.

El modo paced fue una envoltura de medición: troceó según disponibilidad de key, respetó `ratelimit-remaining/reset`, reintentó 429 y conservó resultados por chunk. No modifica el mapper de producción.

### Yahoo

- 100: 18 requests; 18 HTTP 200; cero 429; pared 602 ms.
- 500: 45 requests; 41 HTTP 200, 4 HTTP 404, cero 429; pared 1.030 ms.
- 5.000: 484 requests; 470 HTTP 200, 14 HTTP 404, cero 429; pared 9.466 ms. 437 pasaron y 47 fallaron: 28 errores/fallback no disponible y 19 historiales con menos de 180 barras.

Conclusión de E6: a concurrencia 8, Yahoo no mostró throttling y no fue el cuello de tiempo. OpenFIGI anónimo sí lo fue. En ese momento aún no se había ejecutado una corrida con key real; E9, más abajo, sustituye esa laguna con medición keyed directa.

## E7 — Diagnóstico TWSE

Endpoint usado por el código: <https://isin.twse.com.tw/isin/e_C_public.jsp?strMode=2>.

- GET real: HTTP 200, 7.735.783 bytes, Big5, entre ~8 s y ~19,7 s en las comprobaciones.
- Con el timeout predeterminado de 6.000 ms, la descarga abortó a los 6.006 ms después de recibir 4.187.587 bytes: error `AbortError`, no error de autenticación ni bloqueo geográfico general.
- Con `TWSE_ISIN_TIMEOUT_MS=30000` y el parser real: **1.050 símbolos**, primero `1101.TW`, último `9958.TW`, **19.744 ms = 19,744 s**. El propio código limita el timeout a 30.000 ms.
- No hicieron falta cookie ni `Referer`; el `User-Agent` existente fue aceptado. La decodificación Big5 funcionó.

Alternativa oficial: <https://openapi.twse.com.tw/v1/opendata/t187ap03_L> ([Swagger](https://openapi.twse.com.tw/)). Respondió HTTP 200, JSON UTF-8, 1.319.992 bytes, **1.089 filas** en **3.918 ms = 3,918 s**, con `Last-Modified` 10 de julio de 2026. Incluye código/nombre de compañía, sector, fecha de listing, capital y acciones; no incluye ISIN/CFI. Por tanto es una fuente primaria complementaria/fallback, no un reemplazo semántico exacto del adaptador actual.

Diagnóstico: la causa primaria reproducible es el default de 6 s frente a un payload de ~7,7 MB y latencia variable. No se cambió la configuración.

## E8 — Fuentes oficiales CA / CH / KR / IN y límite legal

| País | Fuente primaria exacta | Acceso/campos | Límite confirmado |
|---|---|---|---|
| CA | [TMX Listed Company Directory](https://www.tsx.com/en/listings/listing-with-us/listed-company-directory) | Descarga pública TSX/TSXV; nombre y símbolo | [Términos TMX](https://www.tsx.com/en/terms-of-use): uso personal/no comercial; sin distribución/republicación/derivados sin permiso. No master comercial gratuito confirmado. |
| CH | [SIX closing prices](https://www.six-group.com/en/market-data/shares/closing-prices.html), [historical prices](https://www.six-group.com/en/market-data/statistics/historical-prices.html) | CSV EOD con security, símbolo, divisa, cierre, volumen y fecha | No equivale a security master. [SIX Exfeed pricing/licensing](https://www.six-group.com/dam/download/market-data/exfeed/price-lists/six-exfeed-mdla-pricelist-april-2026-markup.pdf) contempla licencia; redistribución comercial no confirmada gratis. |
| KR | [KRX Listed Company](https://global.krx.co.kr/contents/GLB/03/0308/0308010000/GLB0308010000.jsp); [OpenDART Corporation Code](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DE001&apiId=AE00004) | KRX: UI con descarga. OpenDART: API con key; código/nombres/stock code/fecha | No se confirmó endpoint bulk KRX estable ni derecho de redistribución. OpenDART incluye no listadas y no clasifica KOSPI/KOSDAQ; company master parcial, no instrument master. |
| IN | [NSE directory](https://www.nseindia.com/static/market-data/securities-available-for-trading), [EQUITY_L.csv](https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv) | CSV sin auth: símbolo, compañía, serie, fecha listing, lote, ISIN, valor nominal | Solo segmento equity principal; SME/ETF separados. [NSE Data Sharing Policy](https://nsearchives.nseindia.com/web/sites/default/files/inline-files/NSE_Data_Sharing_and_Usage_Policy_0.pdf): acuerdo/precio y restricciones de redistribución comercial. |

Corrección explícita: se retira la afirmación de que estas cuatro jurisdicciones ofrecen, sin más, un master oficial gratuito apto para producción comercial. Las fuentes existen y son útiles para discovery/prototipo; su cobertura y/o licencia no equivalen al master contractual que necesitaría StatsEdge.

## E9 — Tercera medición DE: OpenFIGI keyed y expansión de referencias

### Gate de credencial

Antes de cualquier llamada de medición se ejecutó `openFigiStatus()` con `.env.local`:

```json
{
  "configured": true,
  "keyConfigured": true,
  "mode": "api-key"
}
```

El estado confirma un valor no-placeholder; la autenticación real quedó validada por la primera corrida: 50 respuestas OpenFIGI HTTP 200 y headers keyed `ratelimit-limit: 250`, `ratelimit-remaining: 200`, `ratelimit-reset: 45`. No se imprimió ni persistió la key.

Invariantes: DE, `maxFiles=1`, `scanRecordLimit=750000`, filtro `.DE`, Yahoo `2A/D`, mínimo 180 barras, frescura ≤5 días, concurrencia Yahoo 8, funciones de proveedor directas y ninguna ruta Supabase.

### Resultados

| Corrida | Inicio / fin UTC | Ref/resolve solicitados | Referencias / ISIN enviados | Filas OpenFIGI / ISIN con mapping | `.DE` | OHLCV pass/fail | FIRDS | OpenFIGI | Yahoo | Total | OpenFIGI requests / 429 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| E6 anónimo | 09:48:44.918 / 10:09:05.906 | 5.000 / 5.000 | 5.000 / 5.000 | 14.824 / 4.959 | 484 | 437 / 47 | 14.427 ms | 1.197.089 ms | 9.466 ms | 1.220.985 ms | 500 / 0 |
| E9-A keyed | 10:45:58.792 / 10:46:41.231 | 5.000 / 5.000 | 5.000 / 5.000 | 14.824 / 4.959 | 484 | 437 / 47 | 15.215 ms | 16.208 ms | 11.012 ms | 42.437 ms | 50 / 0 |
| E9-B keyed | 10:47:44.460 / 10:49:50.756 | 15.000 / 15.000 | 10.534 / 10.534 | 32.317 / 10.453 | 960 | 638 / 322 | 43.148 ms | 64.477 ms | 18.659 ms | 126.293 ms | 106 / 0 |
| E9-C keyed | 10:50:35.028 / 10:52:05.712 | 20.000 / 20.000 | 10.534 / 10.534 | 32.317 / 10.453 | 960 | 638 / 322 | 45.134 ms | 25.902 ms | 19.638 ms | **90.682 ms** | 106 / 0 |

Conversiones: 42.437 ms = 42,437 s; 126.293 ms = 2 min 6,293 s; 90.682 ms = 1 min 30,682 s.

Las tres corridas keyed acumularon **262 requests OpenFIGI, todos HTTP 200, cero 429**. Últimos headers respectivamente: `250/200/reset 45`, `250/243/reset 57` y `250/144/reset 35` (`limit/remaining/reset`). No se observó contradicción con la cuota keyed. La fase OpenFIGI varió entre E9-B y E9-C aun procesando el mismo conjunto; los tiempos incluyen descarga/parseo de cuerpos y no deben tratarse como deterministas.

Yahoo tampoco mostró rate limiting: E9-C hizo 960 requests, 917 HTTP 200 y 43 HTTP 404, cero 429. De 960 símbolos `.DE`, 638 pasaron; 195 terminaron en error/fallback no disponible y otros 127 devolvieron historial insuficiente para 180 barras.

### Comparación aislada: 5.000 con key vs. sin key

La cohorte y el resultado fueron idénticos en E6 y E9-A: 14.824 filas OpenFIGI, 4.959 ISIN con mapping, 484 `.DE` y 437 OHLCV-valid. La diferencia es de throughput:

| Métrica | E6 anónimo | E9-A keyed | Cambio |
|---|---:|---:|---:|
| Requests OpenFIGI | 500 | 50 | −90,00% |
| Fase OpenFIGI | 1.197.089 ms | 16.208 ms | −98,65%; **73,86×** |
| Total | 1.220.985 ms | 42.437 ms | −96,52%; **28,77×** |
| Ahorro total | — | **1.178.548 ms** | 19 min 38,548 s |

Conclusión causal: la key faltante era un techo artificial de **velocidad**, no la causa del yield 437/5.000. E6 había completado los 5.000 ISIN con pacing; por eso el resultado de cobertura se replica exactamente al cambiar la autenticación.

### Techo observado de referencias y unión exacta

`referenceLimit=15.000` y 20.000 devolvieron ambos **10.534 referencias**. Como el resultado queda por debajo de ambos caps, es un techo estable observado para el fichero único y `scanRecordLimit=750000`. No demuestra el master DE completo: `maxFiles=1`, la autoridad DE mezcla cross-listings y pueden existir otros shards/CFI.

El runner calcula sobre símbolos OHLCV-valid únicos, no filas, y los une con los 32 de `marketSymbols("DE")`:

| Métrica | E6 | E9-C máxima |
|---|---:|---:|
| FIRDS `.DE` OHLCV-valid únicos | 437 | 638 |
| Curados DE | 32 | 32 |
| Solape exacto | no medido | 28 |
| FIRDS netos nuevos | no medido | 610 |
| Unión exacta | ≤469, cota superior | **642** |
| `investableTarget` | 500 | 500 |
| Superávit / (déficit) | ≤−31 | **+142** |

Los 28 solapes fueron: `SAP.DE`, `SIE.DE`, `RHM.DE`, `ALV.DE`, `DTE.DE`, `MBG.DE`, `BMW.DE`, `ADS.DE`, `IFX.DE`, `DHER.DE`, `HNR1.DE`, `ENR.DE`, `SHL.DE`, `BEI.DE`, `AFX.DE`, `BAS.DE`, `BAYN.DE`, `CON.DE`, `DB1.DE`, `DBK.DE`, `EOAN.DE`, `FRE.DE`, `MRK.DE`, `MTX.DE`, `MUV2.DE`, `PUM.DE`, `QIA.DE` y `ZAL.DE`.

La cota anterior 469 era artefacto de resolver solo las primeras 5.000 referencias, no de la key. Al ampliar conjuntamente `referenceLimit` y `resolveLimit`, la capacidad medida supera el target en 142. La ruta productiva todavía no puede materializarla: `fetchFirdsUniverse()` capa 500 y el cron shadow procesa 3.

### Coste de la corrida más generosa

E9-C solicitó 20.000/20.000 y procesó todas las 10.534 referencias disponibles en el shard observado. Total provider-only: **90.682 ms = 1 min 30,682 s**, compuesto por 45.134 ms FIRDS, 25.902 ms OpenFIGI y 19.638 ms Yahoo. No incluye DB, persistencia, scans posteriores, cache de aplicación ni duración literal del cron productivo.

## E10 — Techo real y OHLCV de los otros 12 mercados ESMA + FCA-GB

Gate previo: `configured=true`, `keyConfigured=true`, `mode=api-key`. Cada proceso usó `referenceLimit=20000`, `resolveLimit=20000`, un fichero, `scanRecordLimit=750000`, el sufijo canónico de `FIRDS_MARKET_SUFFIX`, Yahoo `2A/D`, mínimo 180 barras, frescura ≤5 días y concurrencia 8. Para GB se invocó `fetchFcaFirdsReferenceUniverse`; para los otros 12, `fetchEsmaFirdsReferenceUniverse`. Todas las referencias identificadas se enviaron a OpenFIGI.

| Mercado | Referencias reales | OHLCV-valid únicos FIRDS/FCA | Target | ¿Supera target? | Tiempo total |
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

Ningún mercado topó 20.000. Los 12 conteos ESMA coinciden exactamente con E2, que ya estaba por debajo del cap 5.000; GB era el único capado y ahora converge en **11.375** para el shard FCA observado. Como en DE, `maxFiles=1` impide interpretar estos valores como masters completos.

### Tiempos FIRDS frente a E2

| Mercado | FIRDS E2 (cap 5.000) | FIRDS E10 (cap 20.000) |
|---|---:|---:|
| AT | 48.647 ms | 14.462 ms |
| BE | 45.801 ms | 14.437 ms |
| DK | 44.448 ms | 14.358 ms |
| ES | 42.767 ms | 14.157 ms |
| FI | 43.061 ms | 13.021 ms |
| FR | 44.149 ms | 14.237 ms |
| IE | 44.026 ms | 14.092 ms |
| IT | 42.248 ms | 14.040 ms |
| NL | 41.974 ms | 14.091 ms |
| NO | 42.315 ms | 14.030 ms |
| PT | 42.483 ms | 14.292 ms |
| SE | 41.918 ms | 14.312 ms |
| GB/FCA | 32.902 ms | 24.127 ms |

Subir el cap no encareció el escaneo: todos los tiempos bajaron en esta repetición. Es variabilidad/mejora de descarga del proveedor, no un efecto atribuible al cap, porque los conteos ESMA fueron idénticos. No se repitió una segunda corrida redundante por mercado.

### Mercados por debajo del target

La unión con curados tampoco cambia el veredicto: AT 66/70, DK 89/120, FI 133/150, IE 17/50, NL 107/200, PT 39/50 y SE 230/350. Los curados se solapan en gran parte con FIRDS-valid.

- **AT y PT** están cerca, pero el shard observado es matemáticamente pequeño: solo 78 y 46 referencias. Más resolución no puede cerrar de forma fiable el target.
- **IE** es el caso más débil: 57 referencias → 23 símbolos `.IR` → 15 OHLCV-valid; unión 17. El target 50 no se justifica con este shard/filtro.
- **NL**: 162 referencias → 112 símbolos `.AS` únicos → 104 válidos; unión 107 frente a 200. El problema principal es tamaño de referencia/venue, no Yahoo.
- **DK y FI** quedan moderadamente por debajo aun con buen pass OHLCV; sus shards observados contienen 144 y 186 referencias.
- **SE** tiene referencias suficientes en bruto (951), pero pierde cobertura en la conversión: 392 `.ST` y 203 OHLCV-valid; unión 230. Aquí el problema no es tamaño FIRDS bruto, sino venue/símbolo y calidad Yahoo.

OpenFIGI recibió **cero 429** en las 13 corridas. GB fue la mayor: 114 requests HTTP 200, header final keyed `ratelimit-limit: 250`; procesó 11.375 ISIN y terminó en 167.902 ms. Las corridas importaron funciones de proveedor directamente y no tocaron rutas Supabase.

## Reproducibilidad y seguridad

Comando reproducible del gate (el preload registra el alias interno `@/` y es necesario antes de importar las librerías):

```bash
STATUS_ONLY=1 node --env-file=.env.local --import ./scripts/refactor-check/register.mjs docs/evidence/firds-curve-runner.mjs
```

El gate se repitió antes de E10 y volvió a devolver `configured=true`, `keyConfigured=true`, `mode=api-key`; el comando solo imprime el estado y nunca el valor de la credencial.

Las funciones invocadas fueron:

- `fetchEsmaFirdsReferenceUniverse("DE", { enabled: true, maxFiles: 1, scanLimit: 750000, referenceLimit: 5000 })`
- `mapOpenFigiIsins(first25Isins, { limit: 25 })`
- `mapOpenFigiIsins()` sobre 100, 500 y 5.000 ISIN mediante el runner efímero, con pacing solo en las corridas 500/5.000 completadas
- `openFigiStatus()` en modo `STATUS_ONLY` antes de E9; no se registró el valor de la key
- `mapOpenFigiIsins()` keyed sobre 5.000 y sobre las 10.534 referencias identificadas con caps 15.000/20.000
- `fetchEsmaFirdsReferenceUniverse()` sobre AT, BE, DK, ES, FI, FR, IE, IT, NL, NO, PT y SE con cap 20.000; `fetchFcaFirdsReferenceUniverse()` sobre GB
- `mapOpenFigiIsins()` keyed sobre todas las referencias E10 identificadas y `fetchYahooChart()` sobre cada símbolo con el sufijo canónico del mercado
- `fetchYahooChart(symbol, { range: "2A", interval: "D" })`
- `fetchUSUniverse()`, `fetchHkexUniverse()`, `fetchTwseUniverse()`, `fetchJquantsUniverse()`
- `fetchTwseUniverse()` con timeout efectivo de 30.000 ms y GET directo a la OpenAPI TWSE
- `getUniverse("AU")`
- `readShadowReferenceCounts()`, `readSymbolResolutionCounts()`, `supabaseCount()` y `supabaseRequestAll()` únicamente en lectura.

El `git status` anterior a la prueba ya contenía archivos no rastreados ajenos a este estudio. Ninguna corrida cambió flags persistentes, límites de aplicación, tablas, `sectorScore` o `scanStatus`; tampoco creó residuos nuevos en Supabase. Los límites 15.000/20.000 existieron únicamente como variables del proceso efímero del runner.
