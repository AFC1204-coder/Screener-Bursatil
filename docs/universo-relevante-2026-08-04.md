# Cuántos de los ~11.000 símbolos son candidatos de verdad (auditoría 2026-08-04)

BASE_SHA: a80caf2 · rama codex/statsedge-ui-polish. Continúa
`docs/universo-efectivo-2026-08-04.md` (no se repite lo ya verificado allí).

**Corrección de partida:** el documento previo sumó el universo elegible por
mercado y dio "≈8.998". Al re-sumar la misma tabla de origen
(`app_settings.value.markets[<mercado>].universeTotal`, consulta ya citada
en el documento previo) el total correcto es **11.123** (verificado con
`python3` sobre los mismos 23 valores por mercado). US+HK solos son 8.637
(77,6% del total); US+HK+AU son 9.303 (83,6%). Esta cifra corregida es la
que se usa en todo este documento.

---

## PARTE A — Cuántos sobreviven a los mínimos de higiene

### A1. Dónde vive el universo elegible completo

Confirmado en el documento previo (`lib/universeEngine.js:413`,
`getUniverseEngineSnapshot`) y en el caché `universe_snapshots` /
`universe_snapshot_symbols` de Supabase (`lib/universeEngine.js:329-411`).
No se repite la traza aquí.

### A2. Proporción que supera cada umbral — medido con `scan_symbol_history`

`baseRejectReason` (`lib/materializedScanner.js:609-623`) hace *short-circuit*:
evalúa en este orden y devuelve en el primer fallo — precio disponible →
`chartBarsCount` suficiente → frescura → precio mínimo → turnover mínimo →
market cap mínimo → cobertura mínima. Esto significa que **no se puede medir
el "pasa/no pasa" de cada umbral de forma independiente** con los datos que
persiste el sistema: un símbolo rechazado por precio nunca llega a
evaluarse contra turnover. Lo que sí se puede medir con exactitud es el
**embudo** (cuántos llegan vivos a cada etapa), que es lo que se reporta
abajo.

**Fuente:** la tabla `scan_symbol_history` (schema:
`supabase/schema.sql:1305-1428`) registra, para **todo símbolo analizado
por el cron** (pase o no pase), `passed_screen` y `absence_detail` con el
texto literal de `baseRejectReason`. Solo la escribe el cron
(`writeScanSymbolHistory` se llama exclusivamente desde
`app/api/cron/scan-refresh/route.js`, `app/api/cron/shadow-europe-refresh/route.js`
y `app/api/jobs/scan-refresh/route.js` — nunca desde el runner de escaneo de
la UI, `lib/serverScanRunner.js`), así que esta tabla mide únicamente el
camino cron, sin contaminación de escaneos manuales.

**Consulta y resultado:** `supabase_query table=scan_symbol_history
select=id limit=200` devuelve **147 filas** (ids 1-206 con huecos; menos
del tope de 200 ⇒ es la tabla completa). Rango: 2026-07-29T19:44 a
2026-08-03T23:08 (≈5 días, la tabla es reciente — no cubre toda la ventana
de 45 días de `scan_results`). Desglose exacto por `absence_detail`
(consultas: `filter=passed_screen=eq.true`, `filter=absence_reason=eq.insufficient_data`,
`filter=absence_reason=eq.filtered_out` con `select=id,absence_detail`):

| Etapa del embudo | Symbols vivos antes | Rechazados aquí | % del total rechazado en esta etapa |
|---|---|---|---|
| Analizados (total) | 147 | — | — |
| `precio no disponible` | 147 | 0 | 0% |
| `historico insuficiente` | 147 | 1 | 0,7% |
| frescura (`precio viejo: Nd > 5d`) | 146 | 6 | 4,1% |
| `precio bajo` (< 1) | 140 | 15 | 10,2% |
| `importe medio bajo` (turnover < 250.000) | 125 | 42 | 28,6% |
| `market cap bajo` (< 300M) | 83 | 4 | 2,7% |
| `cobertura baja` (< 40) | 79 | 0 | 0% |
| **Pasa los 5-7 filtros (`passed_screen=true`)** | **79** | — | **53,7%** |

(147−1−6−15−42−4−0 = 79, cuadra exactamente con el conteo directo de
`passed_screen=eq.true` → 79 filas.) El rechazo dominante, con diferencia,
es **turnover** (importe medio negociado < 250.000): 42 de 68 rechazos
totales (61,8% de todos los rechazos), y eso entre símbolos que ya habían
superado precio, histórico y frescura.

**¿Es representativa esta muestra de 147 del universo de 11.123?** No, y
por una razón medible: la composición de mercados de esta muestra no
coincide con la composición real del universo. En estos 5 días el cron
rotó por TW, ES/IT, JP, DE/FR/NL, GB/DE/FR/NL/CH/SE/IT/ES,
DK/NO/FI/BE/PT/AT/IE, AU/US/HK — pero **US+HK, que son el 77,6% del
universo real, aportan solo un puñado de símbolos** a esta muestra
concreta (el grupo `core-us-hk-au` solo corrió una vez en esta ventana de
5 días, aportando 12 símbolos de los 147). La muestra está dominada por
Europa/JP/TW, mercados con listas curadas de valores relativamente
líquidos. Esto se confirma de forma independiente con datos agregados de
`provider_runs` (ver abajo): el pass-rate de US+HK+AU es dramáticamente
distinto del resto.

### A3. Pass-rate por grupo de mercado — medido, agregado, 3 semanas

`provider_runs` (`run_type=cron-scan-refresh`, campos `stats.selected`,
`stats.rejected`, `stats.savedRows` — `savedRows = selected − rejected`,
ya que el cron no aplica `screenerFilters`, solo `baseRejectReason`) da un
histórico más largo (2026-07-13 → 2026-08-03, 21 corridas completadas) y
permite separar por grupo de mercado. Consulta:
`supabase_query table=provider_runs select=id,market,status,started_at,finished_at,stats
filter=run_type=eq.cron-scan-refresh order=started_at.desc limit=30`.
Sumando `selected`/`savedRows` por grupo en las corridas con `status=completed`:

| Grupo (`SCAN_CRON_GROUPS`) | Mercados | Σ selected | Σ savedRows | Pass-rate medido | Corridas |
|---|---|---|---|---|---|
| core-us-hk-au | US, HK, AU | 36 | 10 | **27,8%** | 3 (7/13, 7/21, 7/30) |
| asia-japan | JP | 72 | 72 | 100% | 3 |
| asia-taiwan | TW | 60 | 58 | 96,7% | 3 |
| north-america-canada | CA | 48 | 43 | 89,6% | 2 |
| asia-singapore-africa | SG, ZA | 48 | 43 | 89,6% | 2 |
| europe-priority | GB,DE,FR,NL,CH,SE,IT,ES | 72 | 60 | 83,3% | 3 |
| europe-secondary | DK,NO,FI,BE,PT,AT,IE | 59 | 52 | 88,1% | 3 |
| **Todo excepto core-us-hk-au** | — | 359 | 328 | **91,4%** | 16 |
| **Total agregado (todos)** | — | 395 | 338 | 85,6% (pooled, sesgado) | 19 |

El **pass-rate pooled (85,6%)** es engañoso porque JP/TW/CA/SG/ZA/Europa
aparecen con la misma frecuencia relativa que `core-us-hk-au` en la
rotación (1 de 7 grupos cada uno), pero en el universo real US+HK+AU pesan
83,6% de los símbolos. El número que importa es el desglose por grupo: **el
grupo que cubre el 83,6% del universo real tiene un pass-rate de solo
27,8%**, mientras el resto (16,4% del universo, mercados curados u
oficiales más pequeños) pasa a un ritmo de 91,4%.

**Por qué la muestra de `core-us-hk-au` (n=36) tampoco es aleatoria dentro
de US/HK:** `selectUniverseRows` (documento previo, `lib/materializedScanner.js:994-1104`)
no toma una muestra al azar del universo — recorre `orderedRows` desde un
`offset` acumulado (ver A3 del documento previo). Los símbolos observados
en las 3 corridas de `core-us-hk-au` (`0065.HK`…`0070.HK`, `AIRO`, `AIRS`,
`AIRJ`, `AIRT`, `ACF.AX`, `AX1.AX`, `ATV.AX`, `ACE.AX` — visibles en la
muestra de `scan_symbol_history`) son consecutivos por ticker/código, no
dispersos. Esto es consistente con `materializationPriorityForRow`
(ver C8): con el 99%+ del universo aún "nunca escaneado", casi todos los
símbolos empatan en prioridad y el desempate cae al orden original de la
lista (alfabético/numérico del proveedor), así que el efecto práctico hoy
es indistinguible de un barrido secuencial. **No se puede descartar** que
el pass-rate de 27,8% esté sesgado hacia el extremo bajo de tickers
HK (números 0065-0070 son small-caps/legacy, con precios de 0,01-0,9 HKD
en la muestra) o hacia el rango alfabético "A" de EE. UU. (tickers "AIR*",
"AC*", "AX*" no son necesariamente representativos de todo el alfabeto).

### Estimación combinada del universo (Parte A)

Ponderando el pass-rate medido por la composición real del universo
(9.303 símbolos en US+HK+AU al 27,8%; 1.820 símbolos en el resto al
91,4%):

```
9.303 × 0,278 = 2.586
1.820 × 0,914 = 1.664
Total estimado que supera baseRejectReason ≈ 4.250 de 11.123 (≈38,2%)
```

Esto es una **extrapolación**, no una medición directa: aplica un
pass-rate medido sobre una muestra de 36 símbolos (US+HK+AU) al resto de
los 9.267 símbolos de esos tres mercados que nunca se han analizado, bajo
el supuesto de que el resto del universo se comporta igual que la porción
ya observada — supuesto razonable en cuanto a "son listas dinámicas con
muchos nombres de baja capitalización/liquidez" pero no verificado
símbolo a símbolo.

---

## PARTE B — Cuántos son candidatos de verdad (criterios de tendencia)

### B4. Pass-rate de criterios de tendencia del preset `balanced`, sobre los que ya pasaron higiene

**Fuente:** `scan_results`, filas del cron (`preset` derivado del `scans`
padre = `materialized-cache`; se excluyen explícitamente los 5 lotes
"Scan servidor" del 2026-07-29/30 que son escaneos manuales UI repitiendo
MSFT/GOOGL/META, ya que esos NO pasan por `baseRejectReason` — ver
documento previo, A1). Consulta:
`supabase_query table=scan_results
select=symbol,created_at,total_score,weinstein_score,minervini_score,raw->perf3m,raw->perf6m,raw->perf12m,raw->weeklyStageState,raw->sma50,raw->sma150,raw->sma200,raw->sma200Slope,raw->price
filter=created_at=gte.2026-07-29T00:00:00 order=created_at.desc limit=200`
→ 146 filas; tras excluir los 5 timestamps de escaneo manual UI (30 filas),
quedan **116 filas cron**, procesadas con un script Python local (no se
modifica ningún archivo del repo; el script vive fuera del repo, en el
scratchpad de esta sesión).

`requireStage2` se evaluó reproduciendo `isDailyStage2`/`stage2RejectDetail`
(`lib/trendStructure.js:45-76`): tras analizar la lógica, **pasar
`stage2RejectDetail` es matemáticamente equivalente a `isDailyStage2(row)`
en todos los casos** (`dailyLeaderTrendIssue` y `isDailyStage2` comparan
exactamente las mismas seis relaciones price/sma50/sma150/sma200/slope), así
que se calculó directamente `price>sma50>sma150>sma200` ascendentes y
`sma200Slope>0`.

| Criterio (preset `balanced`) | Pasan / 116 | % |
|---|---|---|
| `requireStage2` (Stage 2 diario confirmado) | 35 | 30,2% |
| `minWeinsteinScore ≥ 50` | 79 | 68,1% |
| `minMinerviniScore ≥ 38` | 86 | 74,1% |
| `minPerf3m ≥ 3` | 61 | 52,6% |
| `minPerf6m ≥ 8` | 58 | 50,0% |
| `minPerf12m ≥ 12` | 59 | 50,9% |
| **Los 5 criterios a la vez** | **24** | **20,7%** |

Los 24 símbolos que pasan los cinco (listado completo, medido, sin
extrapolar): `1467.TW, 1456.TW, BAMI.MI, BDB.MI, 9962.T, 8766.T, AALB.AS,
VOE.VI, HAUTO.OL, ORNBV.HE, OMV.VI, ABI.BR, ALLEI.ST, FIA1S.HE, BNP.PA,
NN.AS, MAP.MC, ALFA.ST, BBVA.MC, SAB.MC, CABK.MC, BKT.MC, MT.AS, AAPL`.
Todos tienen `weinstein_score=100` y `minervini_score≥82` — el filtro
efectivo que más "corta" dentro de este grupo ya-pasó-higiene es la
combinación de los tres umbrales de rentabilidad (perf3m/6m/12m), no
Weinstein/Minervini en solitario.

**Representatividad de esta muestra de 116/24:** igual que en A2, está
dominada por Europa/JP/TW (solo 3 de las 116 filas son del grupo
`core-us-hk-au`, y ninguna de esas 3 pasó los 5 criterios). Hay un dato
adicional: la corrida aislada de 1 símbolo del 2026-07-29 (`AAPL`, que sí
pasó los 5) es el único punto de datos "US" fuera de esas 3 filas. Con
solo 4 observaciones US/HK/AU dentro de simbolos-que-ya-pasaron-higiene (1
de 4 pasa tendencia = 25%), **no hay muestra suficiente para dar un
pass-rate de tendencia específico para US/HK** — se usa el 20,7% agregado
como única estimación disponible, con la advertencia explícita de que se
midió casi enteramente sobre Europa/JP/TW.

### B5. El número que importa, con margen de error

Combinando A (pass-rate de higiene, ponderado por composición real del
universo: ≈4.250/11.123) con B (pass-rate de tendencia sobre los que ya
pasaron higiene: 20,7%, medido pero sesgado hacia mercados no-US/HK):

```
4.250 × 0,207 ≈ 880 símbolos candidatos plausibles en un momento dado
```

**Esto es una extrapolación de dos etapas, cada una con su propio sesgo de
muestra** (A: pass-rate de US/HK/AU medido en n=36 no-aleatorio; B:
pass-rate de tendencia medido casi enteramente fuera de US/HK). El margen
de error no se puede cuantificar con rigor estadístico con los datos
disponibles (muestras pequeñas, no aleatorias, de una población con
composición muy desigual). Como cota de sensibilidad: si el pass-rate de
tendencia de US/HK/AU fuera tan bajo como el único dato puntual disponible
(25%, n=4) en vez del 20,7% agregado, el estimado cambia poco (4.250×0,25
≈ 1.063); si fuera bien distinto (por ejemplo, la mitad, 10%, si las
mega-caps US resultan sistemáticamente menos "en tendencia" que las
europeas/asiáticas por estar en un régimen de mercado distinto — no
verificado), bajaría a ≈425. **Rango razonable a reportar: unos cientos a
~1.000 símbolos candidatos**, sin poder cerrar el número exacto con la
evidencia disponible hoy.

---

## PARTE C — Escaneo parcial viable

### C6. Noches para cubrir un universo de N símbolos

Con el techo de ~26 símbolos/invocación (contexto ya verificado) y
asumiendo que cada invocación nocturna se dedica **íntegramente** al
universo relevante de tamaño N (no a la rotación actual de 7 grupos por
mercado — ver C7 para qué implica ese supuesto):

| N (símbolos relevantes) | Noches (`ceil(N/26)`) | ≈ semanas |
|---|---|---|
| 500 | 20 | 2,9 |
| 1.000 | 39 | 5,6 |
| 1.500 | 58 | 8,3 |
| 3.000 | 116 | 16,6 |

Con el estimado de B5 (≈880 candidatos), noches ≈ `ceil(880/26)` = **34
noches (≈4,9 semanas)**.

### C7. ¿El cron se autoinvoca o está limitado a una pasada? ¿Límite de Vercel Hobby?

**Verificado leyendo código:** `app/api/cron/scan-refresh/route.js` no
tiene ningún mecanismo de re-encadenamiento. La función `GET` hace **una
sola** llamada a `runMaterializedScan(options)` (línea 219) y devuelve la
respuesta — no hay equivalente al `chainNextLink`/`after()` que sí existe
en `lib/serverScanRunner.js:131-141` y `app/api/scan/route.js:70`
(`after(runFirstChunk)`) para el camino UI. Mismo patrón sin
encadenamiento en `app/api/jobs/scan-refresh/route.js`. **Conclusión: el
cron está limitado a una sola invocación por disparo de `vercel.json`.**

`vercel.json` define `"schedule": "20 22 * * *"` para `scan-refresh` —
una vez al día, sin overrides de frecuencia en el repo.

**Sobre el límite de Vercel Hobby en número de invocaciones de cron: no
se pudo verificar en este repositorio.** No hay ningún comentario, doc ni
config que declare explícitamente "Hobby permite máximo N invocaciones/día
de cron". Lo único que se observa es que las 6 entradas de `crons` en
`vercel.json` usan todas una cadencia diaria (`* * *` con hora fija, sin
"*/N" de minutos u horas) — consistente con una restricción de granularidad
diaria, pero esto es una inferencia por patrón observado, no una cita de
código o documentación del repo que lo confirme.

### C8. `materializationPriorityForRow` — qué ordena y si serviría

Ya citado en el documento previo (`lib/materializedScanner.js:832-889`).
Resumen de la fórmula de puntuación:
```
if (!state) { score += 1000; reason = "never_scanned"; }
else if (state.recent) { score += 120; reason = "recent_scan"; }
else { score += 650; reason = "stale_scan";
  if (ageDays >= 180) score += 90;
  else if (ageDays >= 90) score += 50; }
```
más un componente de `universeInvestabilityPriority` (calidad de fuente e
"investabilidad": +35 por ser equity, −220/−260 por parecer
warrant/SPAC/preferente) y bonus por señal previa prometedora
(`plan_valid`/`watch`/score alto). El resultado ordena `orderedRows` de
mayor a menor prioridad (`lib/materializedScanner.js:1024-1026`) y
`selectUniverseRows` recorre esa lista ordenada desde `offset`.

**Sí serviría, en teoría, para escanear primero lo más probable de ser
candidato** — dentro de "nunca escaneado" no hay más señal disponible
(no hay `state`), así que el mecanismo no puede priorizar por probabilidad
de ser candidato ANTES de haber analizado un símbolo al menos una vez; solo
puede priorizar re-escaneos futuros usando el resultado del primer paso
(`priorScanScore`, `priorSetupState`). **Hoy, con menos del 1% de US/HK
alguna vez escaneado** (offset US=15/5866, HK=118/2771, documento previo),
prácticamente todo el universo grande está empatado en `never_scanned`
(+1000), y el desempate cae en `selectionIndex` (orden original de la
lista) — el mecanismo de priorización por *investabilidad*/*historial* aún
no tiene material sobre el que operar en los mercados que más importan.

---

## PARTE D — Frescura

### D9. Proporción obsoleta al completar la vuelta

Aplicando el techo de 26 símbolos/noche a los mismos valores de N de la
Parte C, y usando `maxPriceFreshnessDays = 5` como umbral:

| N (símbolos) | Noches para completar | Edad del día-1 al terminar | % del ciclo por encima de 5 días |
|---|---|---|---|
| 500 | 20 | 20 días | 75,0% |
| 1.000 | 39 | 39 días | 87,2% |
| 1.500 | 58 | 58 días | 91,4% |
| 3.000 | 116 | 116 días | 95,7% |
| ≈880 (estimado B5) | 34 | 34 días | 85,3% |

**Distinción importante, para no confundir dos cosas distintas:** este
cálculo mide la antigüedad del *resultado derivado* (score, stage,
composite) que el usuario ve para un símbolo, relativa al momento en que
se computó — NO es lo mismo que el chequeo `priceFreshnessOk` de
`baseRejectReason` (que compara la fecha del último cierre reportado por
el proveedor de datos con hoy, y se evalúa en el momento del análisis, no
depende de cuántas noches lleve el ciclo de cobertura). Un símbolo puede
tener `priceFreshnessOk=true` en el momento de su escaneo (el proveedor
tenía un cierre reciente) y aun así su `stage`/`composite_score` mostrado
al usuario estar desactualizado 34 días después si el ciclo tarda 34
noches en volver a tocarlo.

Nota de modelo (no medición): el cálculo de la tabla asume el caso
"peor noche" (el símbolo escaneado la primera noche del ciclo, visto justo
antes de que el ciclo se reinicie). En régimen estacionario, con
reescaneo continuo, la edad *media* de un símbolo cualquiera del universo
relevante sería aproximadamente `noches_del_ciclo / 2` (17 días para
N=880), todavía muy por encima de 5 días mientras el ciclo no baje de ~10
noches.

### D10. Mecanismo de refresco incremental por antigüedad

Sí existe y ya se citó en C8: la rama `stale_scan` de
`materializationPriorityForRow` (`lib/materializedScanner.js:857-861`) da
+650 de base a cualquier símbolo ya escaneado pero fuera de la ventana
`recentScanDays` (45 días por defecto), con bonus adicional (+90/+50) si
lleva ≥180/≥90 días sin refrescarse — es decir, cuanto más viejo el
último escaneo, mayor prioridad relativa (dentro de los ya-escaneados).
Combinado con `never_scanned` (+1000, la prioridad más alta de todas), el
orden de barrido es: nunca visto → visto hace mucho → visto hace poco. Es
el mismo mecanismo de C8, aplicado aquí a la pregunta de frescura en vez de
a la pregunta de cobertura inicial.

---

## PARTE E — Respuesta

### 11. El número

**Candidatos plausibles en un momento dado: del orden de unos cientos a
~1.000 símbolos** (estimado central ≈880, sin poder cerrar un margen de
error estadístico riguroso — ver B5). Esto es **~8-12x más pequeño** que
el universo elegible completo (11.123), y compuesto mayoritariamente de
símbolos que hoy caen en mercados con `perMarket` bajo (US, HK) porque ahí
vive la mayoría del universo bruto, aunque su pass-rate de higiene sea
bajo (27,8% medido).

Con el techo actual de ~26 símbolos/invocación y 1 invocación/noche (C7,
sin overrides de frecuencia en `vercel.json`), cubrir ≈880 candidatos
llevaría **≈34 noches (≈5 semanas)** — muy lejos de los 28 años que
tardaría el universo bruto completo (documento previo), pero sigue siendo
un ciclo de un mes, no de un día.

### 12. Viabilidad en Vercel Hobby y cuello de botella exacto

**No es viable como "screener con contenido fresco todos los días" bajo
la arquitectura actual, incluso limitando el universo a ~880 candidatos.**
El cuello de botella no es uno solo — son dos, en cascada:

1. **Duración por invocación** (ya establecido en el documento previo:
   maxDuration=60s, ~26 símbolos/invocación). Este es el límite que fija
   cuántas noches hacen falta para una vuelta completa (34 para ≈880).
2. **Frescura** (D9): con `maxPriceFreshnessDays=5` como referencia y un
   ciclo de 34 noches, el 85,3% del ciclo queda con datos derivados de más
   de 5 días de antigüedad en cualquier instante dado. Reducir el universo
   relevante a 880 arregla la cobertura (E11) pero **no** arregla la
   frescura por sí solo: haría falta un ciclo de 5 noches o menos para que
   ningún símbolo del universo relevante supere el umbral de 5 días, y
   `ceil(N/26) ≤ 5` exige N ≤ 130 — muy por debajo incluso del estimado
   más optimista de candidatos (≈880).

**No se identificó, en esta auditoría, un tercer cuello de botella de
"número de invocaciones"** (C7): el cron no se autoinvoca hoy, así que no
hay un límite ya alcanzado ahí — es una capacidad no usada, no una
restricción. Si el número de invocaciones/día en Hobby resulta ser mayor
que 1 (no verificado, ver C7), encadenar varias invocaciones por noche
(al estilo de `lib/serverScanRunner.js`, que el cron hoy no usa) reduciría
directamente el número de noches necesarias — pero esto no se pudo
confirmar como viable dentro del alcance de esta auditoría (afecta al
cuello de botella 1, no lo elimina: seguiría habiendo un techo de símbolos
por invocación individual).

---

## CONFIANZA

**Verificado leyendo código (alta confianza, cita directa):**
- `baseRejectReason` hace short-circuit en 7 chequeos ordenados
  (`lib/materializedScanner.js:609-623`).
- `scan_symbol_history` solo la escribe el camino cron
  (`writeScanSymbolHistory`, grep confirmado en 3 rutas cron, ninguna UI).
- Equivalencia `stage2RejectDetail` ⇔ `isDailyStage2` para el criterio
  `requireStage2` (`lib/trendStructure.js:45-76`).
- El cron no se autoinvoca (`app/api/cron/scan-refresh/route.js`,
  `app/api/jobs/scan-refresh/route.js`, ambos de una sola pasada).
- Fórmula completa de `materializationPriorityForRow`
  (`lib/materializedScanner.js:832-889`).

**Verificado consultando datos (alta confianza, consulta y resultado
citados):**
- Total universo recalculado: 11.123 (corrige el ≈8.998 del documento
  previo).
- Embudo de `baseRejectReason` sobre 147 símbolos analizados
  (`scan_symbol_history`, 2026-07-29→08-03): 79 pasan (53,7%), desglose
  por etapa exacto.
- Pass-rate por grupo de mercado agregado sobre 21 corridas de
  `provider_runs` (2026-07-13→08-03): core-us-hk-au 27,8% (n=36) vs. resto
  91,4% (n=359).
- Pass-rate de criterios de tendencia del preset `balanced` sobre 116
  filas de `scan_results` (cron, mismo rango de fechas): 20,7% pasan los 5
  criterios a la vez, con desglose individual por criterio.
- `vercel.json`: cron `scan-refresh` a `"20 22 * * *"`, una vez al día.

**Inferido / no cerrado (confianza media o explícitamente abierto):**
- El estimado central de ≈880 candidatos (B5) combina dos pass-rates
  medidos en muestras pequeñas y no aleatorias — se reporta como rango
  ("cientos a ~1.000"), no como cifra cerrada.
- Si el pass-rate de higiene o de tendencia de US/HK difiere
  sistemáticamente del medido en las muestras disponibles (n=36 y n≈4
  respectivamente), el estimado cambia de forma significativa — no se pudo
  ampliar la muestra sin más corridas reales del cron sobre esos mercados.
- El límite de número de invocaciones de cron en Vercel Hobby (C7, D12):
  no verificado en este repo; se observa un patrón (todas las cadencias
  son diarias) consistente con una restricción de granularidad diaria,
  pero no hay cita de código o doc que lo confirme.
- D9 asume distribución uniforme del "día de escaneo" dentro del ciclo
  para el cálculo de edad media en régimen estacionario — es un modelo
  simplificado, no una medición del comportamiento real del cursor a largo
  plazo (no hay histórico de un ciclo completo observado, documento
  previo).
- El sesgo de orden (alfabético/secuencial) en las muestras de
  `core-us-hk-au` (A3) se infiere de los símbolos observados y de la
  lógica de `materializationPriorityForRow`, pero no se verificó
  consultando `providerRuntimeStatus` ni el orden exacto en que
  `fetchUSUniverse`/`fetchHkexUniverse` devuelven sus listas.
