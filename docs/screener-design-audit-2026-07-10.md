# Auditoría de diseño del screener — profundidad y fiabilidad real

- Fecha: 2026-07-10
- Alcance: diseño (no solo implementación) de universo, resolución de
  símbolos, puerta de calidad, señales y opciones de usuario. Rama
  `codex/statsedge-ui-polish` @ `3212b76`.
- Regla respetada: no se proponen señales nuevas (Camino A primero); los
  huecos conceptuales se documentan como recomendación.
- Marcas: **[ahora]** = implementable ya, acotado y de bajo riesgo;
  **[producto]** = cambia qué se considera candidato válido o qué se promete
  al usuario; requiere decisión.

## Veredicto general

El diseño es más sólido de lo habitual en esta categoría: registry de señales
con cobertura por input, contrato de fila, percentiles finalizados
atómicamente, trazabilidad de decisión y guardas de calidad de datos. Los
problemas graves no están en las fórmulas sino en **dos costuras**: (1) la
promesa de cobertura de mercados vs. el universo realmente escaneable, y
(2) señales relativas (RS benchmark, sectorScore, percentiles) cuya población
de referencia no es la que el usuario cree estar viendo. Ninguno de los dos se
arregla con más señales; se arreglan con cableado y con decisiones de producto
explícitas.

---

## A. Cobertura de universo

### A1. La profundidad europea depende de flags de entorno y degrada en silencio — Alta [producto + ahora]

**Evidencia.** Para los 13 mercados FIRDS + GB, el universo oficial solo se
construye si `ESMA_FIRDS_ENABLED` / `FCA_FIRDS_ENABLED` están activos
([universes.js:134-146](lib/universes.js:134),
[universeEngine.js:37-58](lib/universeEngine.js:37)). Si no, `getUniverse`
cae a las listas curadas: p.ej. DE ≈ 33 valores, FR ≈ 33, ES ≈ 33
([universes.js:21-70](lib/universes.js:21)). El snapshot marca
`partialOfficialSource` y `coverageReadiness` lo refleja, pero el scan
**procede igual** con el universo raquítico. Un usuario que "escanea Alemania"
puede estar escaneando 33 blue chips y ver un ranking con percentiles sobre
esa muestra.

**Recomendación.** [ahora] Propagar `coverageReadiness` del snapshot al
resultado del scan (campo en `stats`/settings) para que la fila de resultados
declare sobre qué universo real se calculó. [producto] Decidir el mínimo de
universo por mercado por debajo del cual el scan de ese mercado se marca
`partial` en vez de publicarse como normal.

### A2. Australia: el universo "dinámico" son los informes de cortos de ASIC — Alta [producto, ya documentado]

**Evidencia.** `getUniverse("AU")` = ASIC short reports + 10 curados
([universes.js:340-344](lib/universes.js:340)); solo aparecen valores con
posiciones cortas reportadas y nombre que case el regex de
`isInvestableAsicProduct` ([universes.js:104-110](lib/universes.js:104)).
`shadowUniverse.js:14` ya lo reconoce: "ASIC no es master list". Sesgo
estructural: small caps ASX sin interés corto — exactamente el vivero
Minervini — no existen para el screener.

**Recomendación.** [producto] O se comunica AU como "parcial" en la UI de
cobertura (hoy la política vive solo en el informe shadow), o se despriorizan
las promesas de cobertura AU hasta tener proveedor. No hay fix técnico barato.

### A3. Canadá y Japón: curado / condicionado a J-Quants — Media [producto, documentado]

CA ≈ 200 curados legal-safe; JP requiere `JQUANTS_API_KEY` y si no, ≈ 72
curados. Coherente con la política H0 de licencias; el punto de auditoría es
que la ficha de marketing ("US, Europa, Japón, HK, Canadá, Australia") y el
universo efectivo divergen mercado a mercado, y esa divergencia solo es
visible en `/api/shadow-universe`, no donde el usuario decide qué escanear.

### A4. Clasificación de instrumento por regex de nombre — Baja

`instrumentTypeFor` ([universeEngine.js:66-80](lib/universeEngine.js:66))
excluye fondos/deuda/warrants por patrones del nombre. Razonable y con
`excludedByReason` observable en el snapshot. Riesgo residual de
falsos positivos aceptable; no requiere acción.

---

## B. Resolución de símbolos

### B1. MIC/exchange no mapeado ⇒ descarte silencioso — Media [ahora]

**Evidencia.** `mapOpenFigiRow` devuelve `null` cuando el MIC del resultado no
está en las tablas de sufijos ([openfigi.js:115-121,136-139](lib/openfigi.js:115))
y el candidato desaparece sin contarse. Un ISIN del shadow universe listado en
un venue fuera del mapa nunca se vuelve escaneable y nadie lo sabe.

**Recomendación.** [ahora] Contabilizar "unmapped MIC/exch" en el job de
resolución (`jobs/shadow-symbol-resolve`) y exponerlo en el informe shadow.
Es solo observabilidad; no cambia qué se resuelve.

### B2. Ritmo de resolución shadow: 25 ISINs por mercado y corrida — Media [producto]

**Evidencia.** `ESMA_FIRDS_RESOLVE_LIMIT_PER_MARKET` default 25
([universeEngine.js:42,52](lib/universeEngine.js:42)). Con miles de ISINs por
mercado FIRDS, la profundidad escaneable crece a un ritmo que hace la promesa
europea nominal durante meses. Coherente con límites de OpenFIGI anónimo
(con API key el batch sube a 100, [openfigi.js:218](lib/openfigi.js:218)).

**Recomendación.** [producto/ops] Configurar `OPENFIGI_API_KEY` en prod y
subir el límite; decidir el objetivo de profundidad por mercado
(`MARKET_COVERAGE_TARGETS`) como criterio de "mercado anunciable".

### B3. Ambigüedad multi-listing resuelta por score — Baja

`scoreRow` prima ticker exacto + Equity + compositeFIGI y dedupe por símbolo
([openfigi.js:123-134,192-200](lib/openfigi.js:123)). Diseño razonable.

---

## C. Fiabilidad de las señales relativas (el bloque más serio)

### C1. Los benchmarks locales nunca se hidratan en scans batch ⇒ `rsRating` null para todo mercado no-US — Alta [ahora]

**Evidencia.** `benchmarkSymbolForRow` asigna benchmark local por país (^IBEX,
^GDAXI, ^N225, ^HSI, ^AXJO…,
[relativeStrength.js:7-36,99-102](lib/relativeStrength.js:99)). Pero los dos
runners batch solo hidratan `["SPY","QQQ","ACWI"]`
([serverScanRunner.js:99-108](lib/serverScanRunner.js:99) con
`BENCHMARK_SYMBOLS` de [researchRow.js:15](lib/researchRow.js:15);
[materializedScanner.js:630-641](lib/materializedScanner.js:630)). Resultado:
para una fila española, `benchmarks["^IBEX"]` es `undefined`, `bars = []`,
`hasBenchmarkComparison = false` y `rsRating = null` con
`rsBenchmarkIssue: "benchmark insuficiente"`
([relativeStrength.js:139-177](lib/relativeStrength.js:139)). Solo la búsqueda
individual del cliente hidrata el benchmark correcto
([page.jsx:1054-1055](app/page.jsx:1054)). Nota lateral: `company-brief`
mantiene su propia copia de `LOCAL_BENCHMARK_BY_COUNTRY`
([app/api/company-brief/route.js:214](app/api/company-brief/route.js:214)) —
misma clase de duplicación que motiva el ADR de consolidación.

**Consecuencias en cascada:** el filtro `minRsBenchmarkRating` es inoperante
fuera de US; `rsPrimaryValue` cae siempre al percentil de lote; la cadena de
fallback de `scoreWeakness` pierde un eslabón; la UI muestra "benchmark
insuficiente" como si fuera un problema del valor, cuando es del runner.

**Recomendación.** [ahora] En ambos runners, hidratar
`unique(benchmarkSymbolForRow)` de los mercados del scan (≤ ~10 series extra,
cacheables). Es exactamente el tipo de fix que la consolidación del ADR deja
en un solo sitio.

### C2. `sectorScore`: población batch-local + bonus temático hardcodeado — Alta [producto]

**Evidencia.** (a) En el scan de servidor, `sectorize` se ejecuta por lotes de
50 filas ([serverScanRunner.js:216](lib/serverScanRunner.js:216)); en el cron,
sobre ≤40 filas repartidas entre ~11 mercados. `sectorScore` depende del
número de miembros del tema en esa población (`clamp(a.length*10,0,25)` …) —
con grupos de 1-3 miembros, la señal es mayormente ruido de composición de
lote. (b) Además lleva un bonus estático de +20 vs +10 si el tema casa
`/Semis|fotonica|Defensa|Software|Energia|Automatizacion/`
([screenerPipeline.js:311](lib/screenerPipeline.js:311), duplicado en
[materializedScanner.js:407](lib/materializedScanner.js:407)): el 20% del
rango de una señal con peso 0.10 en el composite es una preferencia sectorial
fija, en un score comercializado como "objetivo" (el `ratingModel` describe
sectorScore como fuerza de grupo medida). (c) A diferencia de los percentiles
RS, `sectorScore` **no** se recalcula en la finalización
([scanPercentileFinalization.js:96-104](lib/scanPercentileFinalization.js:96)).

**Recomendación.** [producto] Redefinir la señal de grupo: población = scan
completo (moverla al paso de finalización) y eliminar o declarar el bonus
temático. Cambia rankings ⇒ decisión de producto; bloqueado además por la
regla Camino A si se considera "señal nueva". Mientras tanto, [ahora] como
mínimo documentar en `ratingModel` que el grupo lleva sesgo temático fijo.

### C3. El composite se calcula con percentiles batch y no se recalcula tras la finalización — Media [producto]

**Evidencia.** `rsAnchor = rsGlobalPct ?? rsRating` se toma del percentil del
lote de 50 al hacer flush ([screenerPipeline.js:329-335](lib/screenerPipeline.js:329));
la finalización reescribe `rsGlobalPct/rsCountryPct/rsSectorPct` pero no
`objectiveScore/totalScore` ([scanPercentileFinalization.js:96-108](lib/scanPercentileFinalization.js:96)).
Resultado: el RS que se muestra es "final", el RS dentro del score es
batch-local; dos scans del mismo universo con distinto orden de lotes pueden
rankear distinto. `rank_index` en el scan de servidor es además orden de
inserción, no ranking ([serverScanRunner.js:220](lib/serverScanRunner.js:220)).

**Recomendación.** [producto] Recalcular el composite en el mismo paso de
finalización (técnica y atómicamente barato: la RPC ya parchea metrics por
fila) — pero cambia el ranking publicado, así que es decisión de producto.
Documentarlo como limitación conocida hasta entonces.

### C4. Filas del cron nunca finalizan percentiles y se mezclan con filas finalizadas — Media [ahora, vía ADR fase 3]

**Evidencia.** `writeMaterializedScan` no invoca finalización; sus filas
quedan con `percentileScope` default "batch"
([scanDecisionProjection.js:44-48](lib/scanDecisionProjection.js:44)) y las
leaderboards (`readScanRows`, 45 días) mezclan ambas semánticas. En realidad
la población del cron sí es el scan completo (todo `passedBase` se sectoriza
junto), así que el arreglo es marcar el scope correctamente — recogido como
fase 3 del ADR de consolidación.

### C5. `weaknessScore` con semántica distinta por pipeline — Media [cubierto por ADR §4.4]

El scan vivo lo recalcula tras los percentiles; el cron persiste el valor
pre-percentil. Mismo nombre de señal, distinta base informativa. Se resuelve
con la consolidación; Camino A debería confirmarlo como divergencia.

### C6. Proyección compacta del `chartPreview`: posible pérdida de las 48 sesiones más recientes — Media [ahora, verificar primero]

**Evidencia.** `chartPreviewBars` devuelve las últimas 96 barras en orden
ascendente ([researchRow.js:166-182](lib/researchRow.js:166));
`compactChartPreview` toma `slice(0, 48)`
([researchRowContract.js:56-58](lib/researchRowContract.js:56)) — sobre una
serie ascendente, eso es la mitad **antigua** de la ventana, no la reciente.
Si los consumidores compactos (sessionStorage, `/api/scans` default) pintan
sparklines con eso, muestran datos que terminan ~48 sesiones atrás. Las filas
del cron, en cambio, llevan preview descendente (más reciente primero), así
que el mismo `slice` conserva lo reciente: los dos orígenes no son
equivalentes.

**Recomendación.** [ahora] Verificar con una fila real (encaja en el audit de
equivalencia de Camino A); si se confirma, el fix es `slice(-48)` para series
ascendentes, un cambio de una línea en el contrato + test.

---

## D. Puerta de calidad

### D1. Doble estándar entre el scan vivo y el cron — Media [producto]

**Evidencia.** El gate del scan vivo exige solo ≥180 barras (20 en modo IPO) y
precio > 0 ([qualityGate.js](lib/qualityGate.js)); el cron impone además, por
defecto, precio ≥ 1, importe medio ≥ 250k, market cap ≥ 300M y cobertura ≥ 40
([materializedScanner.js:590-604](lib/materializedScanner.js:590)). Un small
cap de 150M puede aparecer en el scan vivo y no existir jamás en la caché
materializada/leaderboards, sin que nada lo explique. Para el perfil
Minervini, 300M de suelo es una decisión de producto relevante, hoy implícita
en un default de código.

**Recomendación.** [producto] Decidir los suelos del cron y hacerlos visibles
(están en `scan.settings`, pero no en la UI de resultados). [ahora] Persistir
en `stats.rejections` el conteo por causa ya existe; basta exponerlo.

### D2. El gate deja pasar deliberadamente filas con señal degradada — Baja (diseño correcto)

Las 20 fórmulas degradan sin lanzar y `signalCoverage` rastrea qué inputs
faltaban (decisión documentada en
[scoringEngine.js:689-699](lib/scoringEngine.js:689)); las contradicciones
C1-C6 se saltan señales `partial`. Es un buen diseño; no tocar.

### D3. Filas IPO (20 barras) entran al mismo pool de percentiles — Baja [producto]

`rsRawComposite` imputa 0 para perf12m/rs12m ausentes
([relativeStrength.js:180-190](lib/relativeStrength.js:180)), así que una IPO
de 3 meses compite en `rsGlobalPct` contra valores con historial completo con
la mitad de su composite imputado a neutro. Sesgo hacia el centro del ranking,
no hacia fuera — aceptable, pero conviene documentarlo en la metodología.

---

## E. Profundidad de señales frente a Weinstein/Minervini (sin proponer nuevas)

Conceptos **bien cubiertos** por las 20 actuales: stage analysis semanal 10/30
con pendiente ([weeklyStage.js](lib/weeklyStage.js)) + template diario
(`minerviniScore`, incluida la condición ≥30% sobre mínimo 52w vía
`lowAdvance52w`), RS dual (percentil de universo + benchmark), extensión sobre
SMA50, demanda/volumen (relVol, surge, up/down vol, A/D proxy), VCP y
estructura de base (contracciones, profundidad, semanas, pivot, dry-up,
tightness), proximidad a máximos, IPO reciente, proxy de crecimiento,
riesgo/recompensa, deterioro, y régimen de mercado como filtro de contexto
(`regimeRejectReason`).

Huecos conceptuales del **diseño** (documentados, no implementar hasta cerrar
Camino A):

1. **Volumen en la confirmación de stage semanal.** Weinstein exige expansión
   de volumen en la ruptura a Stage 2; `weeklyStageForBars` clasifica solo con
   precio/medias — agrega volumen semanal pero no lo usa
   ([weeklyStage.js:110-139](lib/weeklyStage.js:110)). El concepto existe en
   otras señales diarias, pero la *clasificación de stage* que se muestra al
   usuario no lo incorpora. [producto]
2. **Aceleración de beneficios trimestral.** `growthScore`/`epsGrowthProxyScore`
   usan ratios TTM estáticos; la aceleración secuencial (núcleo SEPA) no es
   capturable con los datos actuales. Es una limitación de proveedor (ya
   reconocida en H0), no de fórmula. [producto/datos]
3. **Grupo/industria real.** La fuerza de grupo se calcula sobre "temas"
   heurísticos derivados de texto (`businessThemeKey`), no sobre una
   clasificación industrial estable; ver C2. [producto]
4. **Sponsorship institucional.** `institutionalOwnership` se captura solo
   como cobertura de datos, no participa en ninguna señal. Coherente con la
   regla de no añadir señales; se deja constancia. [producto]

Conclusión de este bloque: **no falta ningún concepto central de forma
absoluta**; los dos déficits con impacto real (volumen en stage, grupo real)
son de calidad de señal existente, no de señal ausente.

---

## F. Opciones de filtro expuestas al usuario

**Amplitud:** 60+ umbrales, 8 modos de setup, 3 niveles de strictness,
presets, plantillas de usuario, universo manual, IPO radar y ventanas de
stage configurables ([screenerFilterCatalog.js](lib/screenerFilterCatalog.js)).
La profundidad de control no es el problema; si acaso hay exceso de opciones
frente a curación (nota de producto, no de diseño técnico).

Limitaciones de diseño reales:

1. **"Sin dato" = rechazo en umbrales min/max** — Media [producto].
   `screenerFilterRejectReason` rechaza cuando el campo no es finito
   ([screenerFilters.js:722](lib/screenerFilters.js:722)). Con campos de
   disponibilidad asimétrica por mercado (short float, fundamentales), activar
   un umbral excluye mercados enteros en silencio. El panel de explicación sí
   distingue `missing`, pero el flujo de filtrado no ofrece la alternativa
   "ignorar si falta". Decisión de producto: rechazo estricto (actual) vs.
   opt-in por filtro.
2. **Benchmark no elegible** — Baja [producto]. El benchmark RS es fijo por
   país; un usuario no puede comparar contra QQQ o contra el índice que usa su
   metodología. Con C1 arreglado, esto pasa a ser una preferencia razonable de
   backlog, no un fallo.
3. **Ventanas RS fijas** (1/3/6/12m con pesos fijos) — Baja. Coherente con
   mantener el score comparable entre usuarios; no cambiar.
4. **El percentil es intra-scan.** `rsGlobalPct` es "percentil del lote/scan",
   no del universo global histórico; el `ratingModel` lo declara, pero la UI
   lo llama "RS" a secas y el scope batch/final solo vive en metrics. Con A1
   (universos pequeños) el percentil puede ser sobre 33 valores. [producto:
   mínimo de muestra ya existe (RS_GLOBAL_MIN_SAMPLE=20) — decidir si es
   suficiente; exponer la muestra en la UI de la señal.]

---

## Priorización sugerida

| # | Hallazgo | Severidad | Vía |
|---|---|---|---|
| C1 | Benchmarks locales sin hidratar (rsRating null no-US) | Alta | [ahora] fix acotado en runners |
| A1 | Universo europeo degrada en silencio a curado | Alta | [ahora] propagar readiness + [producto] mínimos |
| C2 | sectorScore: población de lote + bonus temático fijo | Alta | [producto] |
| A2 | AU = informes de cortos ASIC | Alta | [producto] (documentado) |
| C3 | Composite no recalculado tras finalización | Media | [producto] |
| C4 | Cron sin percentileScope final | Media | [ahora] (ADR fase 3) |
| D1 | Suelos duros del cron (300M/250k) invisibles | Media | [producto] + exponer |
| C6 | Compact preview posiblemente sin las 48 sesiones recientes | Media | [ahora] tras verificación |
| B1 | MIC no mapeado descarta en silencio | Media | [ahora] observabilidad |
| B2 | Resolución shadow a 25 ISINs/mercado | Media | [producto/ops] |
| F1 | "Sin dato" = rechazo en filtros asimétricos | Media | [producto] |
| E1-E4 | Huecos conceptuales W/M (volumen en stage, EPS trimestral, grupo real, sponsorship) | Media | [producto], tras Camino A |
| C5 | weakness pre/post percentil según pipeline | Media | ADR consolidación |
| D3, A4, B3, F2-F4 | Observaciones menores | Baja | documentar |
