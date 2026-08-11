# Diagnóstico: orden de `rank_index` y `sectorScore` repetido

Escaneo auditado: `scan_id = ef9199b5-cc4d-41a5-8100-f9dd626258c6` (primer escaneo nocturno completo, 5.605 símbolos analizados, 97 pasan el preset `balanced`). Tarea puramente diagnóstica — **no se ha tocado ningún archivo de código ni se ha escrito en Supabase**.

**Resumen para el dueño (en una frase cada una):**
- **Observación 1 (orden):** no es un bug. `rank_index` ordena por un campo real llamado `objectiveScore`, no por `total_score` — y ese es también el orden por defecto que usa la pantalla del screener. El nombre del campo en la interfaz ("Score compuesto") es confuso porque suena igual que "Composite" (que sí es `total_score`), pero son dos campos distintos y ambos existen a propósito.
- **Observación 2 (sectorScore repetido):** no es un bug. `sectorScore` es, por diseño, un valor de **grupo temático** (varios sectores/industrias parecidos agrupados), no de la acción individual — así que compartirlo entre varias filas es exactamente lo esperado. Lo comprobé con datos: todas las filas que comparten `sectorScore` comparten el mismo grupo temático, aunque a veces tengan sectores GICS distintos (eso también es intencional, lo cito abajo).

---

## PARTE A — El orden

### 1. Cómo se asigna `rank_index` en el camino del escaneo materializado (el nocturno)

En `lib/materializedScanner.js`, dentro de `runMaterializedScan`:

```
lib/materializedScanner.js:1614-1619
  const passedBase = analyzed.filter((item) => item.ok).map((item) => item.row);
  const sectorized = sectorize(passedBase);
  const filterResult = applyScreenerFilters(sectorized, options.screenerFilters);
  const rows = filterResult.rows
    .sort((a, b) => (b.objectiveScore ?? b.totalScore ?? 0) - (a.objectiveScore ?? a.totalScore ?? 0))
    .slice(0, Math.max(Number(options.maxSavedRows || 500), 1));
```

`rows` (ya ordenado) es lo que luego se le pasa a `writeMaterializedScan`, que asigna el número de fila así:

```
lib/materializedScanner.js:1560-1565
  for (let i = 0; i < rows.length; i += 300) {
    await supabaseRequest("scan_results", {
      method: "POST",
      prefer: "return=minimal",
      body: rows.slice(i, i + 300).map((row, offset) => scanResultPayload(row, saved.id, config.ownerId, i + offset, scan.settings || {})),
    });
  }
```

Y `scanResultPayload`:

```
lib/materializedScanner.js:1352
    rank_index: index + 1,
```

Es decir: `rank_index` es literalmente **la posición en el array después de ordenar por `objectiveScore`**. No hay ningún paso posterior que lo recalcule por `total_score`.

(Dato aparte, para que quede documentado: el escaneo interactivo — el que lanza el usuario a mano, `lib/serverScanRunner.js:364-372` — asigna `rank_index` de una forma todavía más débil: es simplemente el orden en que cada símbolo termina de procesarse en paralelo [`state.insertedCount + index + 1`], sin ordenar por ningún score. No es el camino auditado hoy, pero conviene saberlo: en ningún escaneo — ni el nocturno ni el interactivo — `rank_index` es "el ranking oficial por `total_score`".)

### 2. ¿Por qué campo ordena? ¿En qué se diferencia de `total_score`?

Ordena por **`objectiveScore`**, un campo distinto de `total_score`/`compositeScore` que se calcula en el mismo sitio (`sectorize()`, dentro de `materializedScanner.js`):

```
lib/materializedScanner.js:328-330
    const objectiveScore = scoreCompositeValue({ setupQualityScore: objectiveSetupScore, rsAnchor, rsQualityScore, demandScore, adProxyScore, growthScore, epsAnchor, sectorScore, riskRewardScore, riskScore: row.riskScore, momentumScore: row.momentumScore });
    const composite = computeCompositeWithCoverage({ setupQualityScore, rsAnchor, rsQualityScore, demandScore, adProxyScore, growthScore, epsAnchor, sectorScore, riskRewardScore, riskScore: row.riskScore, momentumScore: row.momentumScore });
    const compositeScore = composite.value;
```

Ambos usan **exactamente la misma fórmula matemática** (`scoreCompositeValue` y `computeCompositeWithCoverage` son, literalmente, el mismo cálculo interno):

```
lib/scoringEngine.js:857
export const scoreCompositeValue         = computeComposite;
```

```
lib/scoringEngine.js:812-814
export function computeComposite(args) {
  return computeCompositeDetailed(args).value;
}
```

La única diferencia entre los dos es **qué "calidad de setup" reciben como ingrediente**:
- `objectiveScore` recibe `objectiveSetupScore` (una medida de la calidad del patrón/base calculada de forma puramente objetiva, sin las reglas de "veredicto" que sí entran en la otra).
- `total_score`/`compositeScore` recibe `setupQualityScore` (la versión que sí incorpora esas reglas de veredicto/metodología).

Todo lo demás del cálculo (fuerza relativa, sector, riesgo, momentum, crecimiento…) es idéntico en los dos. En la práctica esto hace que casi siempre estén muy cerca mutuamente (como se ve en los datos de abajo, la diferencia suele ser de 1-4 puntos), pero no son el mismo número, y cuando el orden de dos filas está muy ajustado, ese pequeño desfase basta para invertir el orden — que es justo lo que se ve entre GEO/CON/HALO.

Explicado en llano: son "dos formas ligeramente distintas de calcular la misma nota final", y el escaneo nocturno ordena por una de ellas (`objectiveScore`), mientras que la columna que salta más a la vista en la base de datos (`total_score`) es la otra.

### 3. ¿Es coherente con lo que ordena la interfaz?

Sí. El selector "Ordenar" del screener, por defecto, también ordena por `objectiveScore`:

```
lib/screenerPipeline.js:86-88
function defaultSortForSettings(set = {}) {
  return set.setupMode === "weakness" ? "weaknessScore" : "objectiveScore";
}
```

Y el propio estado inicial de la pantalla arranca con el preset `balanced`:

```
app/page.jsx:168
  const [settings, setSettings] = useState(settingsForPreset("balanced"));
```

Así que, salvo que el usuario esté en modo "Deterioro técnico" (`weakness`), el orden por defecto que ve en pantalla **coincide con el criterio (`objectiveScore`) que ya usó el escaneo nocturno para asignar `rank_index`**. Es coherente, no es una casualidad.

Ahora bien — el nombre en el menú desplegable es una fuente de confusión real, y merece decirse aunque no sea un bug de datos:

```
app/components/screener/ResultFilterBar.jsx:87-99
        <select className="select resultFilterSelect resultSortSelect" value={sort} onChange={(e) => onSort(e.target.value)} aria-label="Ordenar resultados" data-active={sort !== "objectiveScore" ? "true" : "false"}>
          <option value="objectiveScore">Ordenar: Score compuesto</option>
          <option value="decisionPriority">Ordenar: Calidad decisión</option>
          <option value="totalScore">Ordenar: Composite</option>
          ...
```

La opción por defecto (`objectiveScore`) se llama en pantalla **"Score compuesto"**, y hay OTRA opción distinta, más abajo en el mismo menú, llamada **"Composite"** (`totalScore`, el mismo campo que la columna `total_score` de la base de datos). Son dos nombres casi sinónimos en castellano para dos campos que NO son el mismo número. Esto no es un bug de datos — es una etiqueta del menú que puede confundir a cualquiera que intente relacionar lo que ve en pantalla con la columna `total_score` que se ve al consultar la base de datos directamente (como hizo el dueño para detectar esta observación).

### 4. Si `rank_index` y el orden de la interfaz difieren, ¿qué ve el usuario? (explicado en llano)

En el caso del escaneo nocturno concreto que se está auditando: **no difieren**, con una matización.

- El campo `rank_index` que queda grabado en la base de datos, y el orden por defecto que la pantalla del screener aplica al abrir un escaneo, usan el mismo criterio (`objectiveScore`). Así que, con el "Ordenar" por defecto, lo que ve el usuario en pantalla ya sale correctamente ordenado de mejor a peor según ese criterio — el desorden que se ve al mirar `total_score` en una consulta SQL directa **no llega a la pantalla del usuario en el caso normal**.
- Importante: la pantalla NO confía ciegamente en `rank_index` para decidir el orden que muestra — vuelve a ordenar las filas ella misma, en el navegador, cada vez que se cargan o se cambia el criterio (`lib/screenerPipeline.js:90-93`, `sortRowsForMode`). Así que aunque `rank_index` estuviera "mal" para otro criterio, el usuario seguiría viendo el orden correcto para el criterio que tenga seleccionado en cada momento — **con una excepción real que sí conviene apuntar** (ver más abajo).
- Si el usuario cambia el desplegable a **"Composite"** (`totalScore`), en pantalla verá el orden correcto por `total_score` (la pantalla reordena localmente), aunque el número de fila `rank_index` grabado en la base de datos siga reflejando el orden de `objectiveScore`. Es decir: el número `rank_index` en sí mismo nunca fue pensado para leerse como "la posición 1, 2, 3… por `total_score`" — solo es así cuando el criterio activo es `objectiveScore` (el que viene por defecto).

**Matiz técnico que sí vale la pena que el dueño conozca, aunque no aplica a este escaneo de 97 filas:** la ruta que carga los escaneos guardados (`app/api/scans/route.js:443`) pide las filas de `scan_results` ya ordenadas por `rank_index` y con un límite (`rowsLimit`, 5.000 por defecto). Con solo 97 filas eso da igual — llegan todas. Pero si algún día un escaneo nocturno completo guardara más de 5.000 filas y el usuario eligiera un criterio de orden distinto de `objectiveScore`, la pantalla solo tendría en el navegador el "top 5.000 por `objectiveScore`" para reordenar — no el universo completo de filas guardadas — y el resultado de ese otro criterio podría no ser exactamente el verdadero top de ese criterio. No es el caso hoy (97 << 5.000) y no es una de las dos observaciones que se pidió auditar, así que lo dejo apuntado como nota, no como hallazgo.

### 5. DATOS — con qué campo queda ordenado `rank_index`

Consulta:
```
tabla: scan_results
select: symbol,rank_index,total_score,metrics->objectiveScore,metrics->compositeScore,metrics->rsGlobalPct,metrics->rsRating
filter: scan_id=eq.ef9199b5-cc4d-41a5-8100-f9dd626258c6
order: rank_index.asc
limit: 20
```

Resultado (primeras 20 filas):

| rank_index | symbol | total_score | objectiveScore | rsGlobalPct | rsRating |
|---|---|---|---|---|---|
| 1 | GEO | 87.111 | 86.261 | 92 | 77 |
| 2 | CON | 87.679 | 85.979 | 90 | 81 |
| 3 | HALO | 88.302 | 85.636 | 90 | 78 |
| 4 | LLY | 86.430 | 85.387 | 80 | 71 |
| 5 | HNGE | 86.411 | 84.518 | 96 | 82 |
| 6 | PBYI | 86.211 | 82.981 | 90 | 81 |
| 7 | BBVA | 83.711 | 82.858 | 84 | 75 |
| 8 | ABNB | 84.997 | 82.843 | 84 | 73 |
| 9 | ATI | 83.849 | 82.836 | 95 | 88 |
| 10 | CARE | 84.715 | 82.831 | 88 | 80 |
| 11 | EXEL | 84.694 | 82.611 | 74 | 68 |
| 12 | JAZZ | 83.363 | 82.513 | 89 | 80 |
| 13 | APGE | 84.132 | 82.432 | 97 | 91 |
| 14 | ZD | 82.287 | 81.520 | 88 | 79 |
| 15 | TILE | 84.348 | 81.118 | 82 | 70 |
| 16 | SLF | 81.555 | 80.705 | 75 | 68 |
| 17 | SBLK | 81.489 | 80.639 | 75 | 71 |
| 18 | PH | 81.499 | 80.572 | 74 | 68 |
| 19 | ALL | 81.371 | 80.250 | 76 | 67 |
| 20 | MFC | 80.901 | 80.051 | 70 | 66 |

**`objectiveScore` es estrictamente decreciente en las 20 filas** (86.261 → 85.979 → 85.636 → … → 80.051, sin ninguna subida). **`total_score` NO lo es** (sube de 87.111 a 87.679 a 88.302 entre las filas 1-3, exactamente el patrón que reportó el dueño). `rsGlobalPct` y `rsRating` tampoco son monótonos. Confirmado: el campo que ordena `rank_index` es `objectiveScore`.

---

## PARTE B — El `sectorScore`

### 6. Cómo se calcula. ¿Es del sector o del valor individual?

Es un valor de **grupo**, no de la acción individual. Se calcula así:

```
lib/screenerComposite.js:67-73
function groupingKeyForRow(row = {}) {
  const theme = typeof row.theme === "string" ? row.theme.trim() : "";
  if (theme) return theme;
  const sector = typeof row.sector === "string" ? row.sector.trim() : "";
  if (sector) return sector;
  return "Sin grupo";
}
```

```
lib/screenerComposite.js:93-105
export function sectorScoreForGroup(group = []) {
  const rows = Array.isArray(group) ? group : [];
  const groupSize = rows.length;
  const avg3 = avg(rows.map((row) => row.perf3m || 0));
  const avg6 = avg(rows.map((row) => row.perf6m || 0));
  const leaders = rows.filter(isLeader).length;
  const raw = clamp(groupSize * 10, 0, 25)
    + clamp(Number.isFinite(avg3) ? avg3 : 0, 0, 20)
    + clamp(Number.isFinite(avg6) ? avg6 / 2 : 0, 0, 20)
    + clamp(leaders * 7, 0, 15);
  return clamp(raw, 0, 100);
}
```

```
lib/screenerComposite.js:117-129
export function computeSectorScoresForRows(rows = []) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = groupingKeyForRow(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const scores = new Map();
  for (const [key, group] of groups) {
    scores.set(key, sectorScoreForGroup(group));
  }
  return scores;
}
```

Dato clave y no evidente: la agrupación **no es por el campo `sector` (el GICS clásico: "Healthcare", "Industrials"…), es por `theme`** — un campo distinto y más fino, calculado aparte (`businessThemeKey`), que agrupa empresas por negocio real (p. ej. "Autos / movilidad", "Internet / plataformas") y que **puede mezclar varios sectores GICS dentro del mismo grupo**. Solo cae a `sector` como respaldo si una fila no tiene `theme`.

En llano: `sectorScore` mide "qué tan fuerte está el grupo de negocio al que pertenece esta acción esta noche" (cuántas acciones hay en el grupo, cuánto han subido en promedio a 3 y 6 meses, cuántas son líderes técnicos) — es normal, esperado y **por diseño** que todas las acciones del mismo grupo compartan el número exacto, sea cual sea su sector GICS.

### 7. Comprobación con datos: ¿los que comparten `sectorScore` comparten sector?

Consulta:
```
tabla: scan_results
select: symbol,sector,theme,metrics->sectorScore
filter: scan_id=eq.ef9199b5-cc4d-41a5-8100-f9dd626258c6
order: rank_index.asc
limit: 100
```
(devuelve las 97 filas completas)

Comprobación específica sobre el ejemplo que reportó el dueño (los 10 primeros por `rank_index`):

| symbol | sector (GICS) | theme | sectorScore |
|---|---|---|---|
| CON | Healthcare | Medtech / biotech | 74.554447... |
| HALO | Healthcare | Medtech / biotech | 74.554447... |
| LLY | Healthcare | Medtech / biotech | 74.554447... |
| HNGE | Healthcare | Medtech / biotech | 74.554447... |
| PBYI | Healthcare | Medtech / biotech | 74.554447... |
| BBVA | Financial Services | Finanzas | 53.957008... |
| CARE | Financial Services | Finanzas | 53.957008... |

Los cinco primeros comparten `sector` (Healthcare) Y `theme` (Medtech / biotech). BBVA y CARE comparten `sector` (Financial Services) Y `theme` (Finanzas). En este ejemplo concreto, `sector` y `theme` coinciden, así que a simple vista parece "comparten sectorScore porque comparten sector" — pero es una coincidencia de esta muestra de 10, no la regla real (ver punto siguiente).

Prueba de que la regla real es `theme`, no `sector` — casos dentro de las 97 filas donde `sector` **difiere** pero `theme`/`sectorScore` son iguales:

| symbol | sector (GICS) | theme | sectorScore |
|---|---|---|---|
| GEO | Industrials | Automatizacion | 52.084663... |
| SBLK | Industrials | Automatizacion | 52.084663... |
| ALNT | **Technology** | Automatizacion | 52.084663... |
| AVNT | **Basic Materials** | Automatizacion | 52.084663... |
| ATI | Industrials | Autos / movilidad | 51.652746... |
| TX | **Basic Materials** | Autos / movilidad | 51.652746... |
| ZD | Communication Services | Internet / plataformas | 57.419335... |
| ETSY | **Consumer Cyclical** | Internet / plataformas | 57.419335... |
| SCSC | **Technology** | Internet / plataformas | 57.419335... |
| FA / UHAL | **Industrials** | Internet / plataformas | 57.419335... |
| SPB | **Consumer Defensive** | Consumo / marca | 50.326529... |
| TILE/ABNB/… | Consumer Cyclical | Consumo / marca | 50.326529... |
| AVT | **Technology** | Semis / fotonica | 60 |
| QUAD | **Industrials** | Semis / fotonica | 60 |
| ALL | Financial Services | Inmobiliario / REIT | 47.893708... |
| CXW | **Industrials** | Inmobiliario / REIT | 47.893708... |
| PK / EFC | **Real Estate** | Inmobiliario / REIT | 47.893708... |
| BZH | **Consumer Cyclical** | Inmobiliario / REIT | 47.893708... |
| KOP | **Basic Materials** | Inmobiliario / REIT | 47.893708... |

### 8. Veredicto: ¿bug o correcto?

**Correcto. No hay nada que arreglar.** Comprobado con datos: cada fila que comparte `sectorScore` comparte también `theme` (el campo real de agrupación) — sin ninguna excepción entre las 97. Que además comparta o no comparta `sector` GICS depende de si ese grupo temático mezcla sectores GICS distintos (varias veces sí lo hace, por ejemplo el grupo "Inmobiliario / REIT" reúne acciones de Financial Services, Industrials, Real Estate, Consumer Cyclical y Basic Materials — 5 sectores GICS distintos, mismo `theme`, mismo `sectorScore`). Eso es exactamente el comportamiento documentado en el propio código (`lib/materializedScanner.js:299-307`, comentario sobre `sectorize()`): el score de grupo es "100% basado en datos reales del grupo", y el grupo es el `theme`, no el sector GICS.

### 9. ¿Cuántos valores distintos de `sectorScore` hay en las 97 filas?

**12 valores distintos de `sectorScore`, y exactamente 12 grupos temáticos (`theme`) distintos** — correspondencia 1 a 1, ninguna coincidencia numérica accidental entre grupos distintos:

| theme | sectorScore | filas en el grupo |
|---|---|---|
| Medtech / biotech | 74.554448 | 30 |
| Finanzas | 53.957008 | 14 |
| Consumo / marca | 50.326529 | 11 |
| Internet / plataformas | 57.419335 | 9 |
| Automatizacion | 52.084663 | 7 |
| Energia / red | 45.245334 | 7 |
| Inmobiliario / REIT | 47.893708 | 6 |
| Software / IA | 70.424349 | 6 |
| Autos / movilidad | 51.652746 | 3 |
| Semis / fotonica | 60 | 2 |
| Basic Materials (sin theme mapeado, cae a sector) | 40 | 1 |
| Defensa / aeroespacial | 51.164382 | 1 |

Suma: 30+14+11+9+7+7+6+6+3+2+1+1 = **97**, cuadra exactamente con las filas del escaneo.

---

## PARTE C — Coherencia general (otros campos repetidos)

Revisé estos campos adicionales en las 97 filas (consulta acotada por `scan_id`, `select` con varias claves de `metrics`):
```
tabla: scan_results
select: symbol,weinstein_score,minervini_score,risk_score,rs_rating,metrics->riskRewardScore,metrics->dataCoverageScore,metrics->technicalCoverageScore,metrics->priceFreshnessDays,metrics->benchmarkSymbol,metrics->volatility63d,metrics->lastDate
filter: scan_id=eq.ef9199b5-cc4d-41a5-8100-f9dd626258c6
order: rank_index.asc
limit: 100
```

Campos que se repiten mucho, y mi lectura de cada uno:

- **`benchmarkSymbol` = "SPY" en las 97 filas.** Normal, no es un bug: las 97 son acciones estadounidenses, y el benchmark de fuerza relativa para EE.UU. es siempre SPY — es correcto que sea idéntico para todo el mercado US.

- **`metrics->lastDate` = "2026-08-07" en las 97 filas, y `priceFreshnessDays` = 4 en las 97 filas.** Normal — es un escaneo por lotes: todos los símbolos se leyeron en el mismo momento, así que comparten la misma "última sesión disponible". **Sí vale la pena una nota aparte, no como bug de este diagnóstico pero como algo a vigilar:** si el escaneo se ejecutó el 2026-08-11 (martes) y la última sesión que tiene es la del viernes 2026-08-07, faltaría la sesión del lunes 2026-08-10 — indicio de que `refresh-bars.mjs` podría no haberse ejecutado (o no haber terminado) justo antes de este escaneo nocturno. Con 4 días de antigüedad todavía pasa el filtro de frescura (el umbral son 5 días), así que no invalida las 97 filas, pero es un dato que el dueño quizá quiera confirmar por su cuenta.

- **`weinstein_score` = 100 en 95 de las 97 filas.** Parece sospechoso a primera vista, pero es un techo legítimo de la fórmula, no un valor copiado:
  ```
  lib/scoringEngine.js:162-176
    weinsteinScore: {
      ...
      compute: (r) => {
        let s = 0;
        if (gt(r.price, r.sma150)) s += 18;
        if (gt(r.sma150, r.sma200)) s += 18;
        if (gt(r.sma200Slope, 0)) s += 18;
        if (gt(r.price, r.sma50)) s += 14;
        if (gt(r.sma50, r.sma150)) s += 14;
        if (gte(r.distance52w, -25)) s += 10;
        if (gt(r.perf6m, 0)) s += 8;
        return clamp(s);
      },
    },
  ```
  Son 7 condiciones de tendencia que suman exactamente 100 si se cumplen todas. Como las 97 filas ya pasaron el preset `balanced` (que exige tendencia alcista fuerte), es esperable que la mayoría cumpla las 7 condiciones y sature en 100 — es un techo de la fórmula, no un dato repetido por error.

- **`metrics->technicalCoverageScore` clusteriza mucho alrededor de 97 (y algunas en 100).** También es legítimo, no copiado: es un porcentaje sobre una lista fija de 33 campos técnicos:
  ```
  lib/dataCoverageShared.js:117-152 (fragmento)
    const technicalCoverageScore = coveragePct([
      [freshness.priceFreshnessOk ? 100 : null, "priceFreshness"],
      [Number.isFinite(row.chartBarsCount) && row.chartBarsCount >= 180 ? row.chartBarsCount : null, "chartBarsCount"],
      ... (33 campos en total)
    ]);
  ```
  32 de 33 campos presentes = 96,97% → redondea a 97. Como muchísimas acciones comparten exactamente el mismo campo ausente (típicamente `shortPercentOfFloat`, que Yahoo no siempre reporta), es normal que compartan el mismo porcentaje — es un checklist discreto, no una medida continua por acción.

- **`riskRewardScore`, `risk_score`, `minervini_score`, `volatility63d`, `rs_rating`, `total_score`:** estos SÍ varían fila a fila, sin agrupamientos sospechosos — son las señales que se calculan por acción individual y se comportan como se espera.

### 11. Distinción — qué es normal que se repita y qué no

**Es normal que se repita** (todo verificado con código o con el propio diseño del dato):
- `sectorScore` / `groupStrengthScore` — valor de grupo temático, por diseño.
- `benchmarkSymbol` — un único benchmark por mercado (SPY para EE.UU.).
- `metrics->lastDate` / `priceFreshnessDays` — todas las filas se leyeron en el mismo lote, comparten la última sesión de mercado disponible.
- `weinstein_score` (clusteriza en 100) — techo aritmético de una suma de condiciones booleanas, agravado porque el preset `balanced` ya preselecciona tendencias fuertes.
- `technicalCoverageScore` / `dataCoverageScore` (clusteriza en unos pocos valores) — son porcentajes sobre un checklist fijo de campos, no mediciones continuas; muchas acciones comparten exactamente los mismos campos ausentes.

**Debería variar por acción, y de hecho varía** (comprobado, sin patrones de repetición sospechosos): `total_score`, `objectiveScore`, `riskRewardScore`, `risk_score`, `minervini_score`, `volatility63d`, `rs_rating`, `rsGlobalPct`.

No encontré ningún campo que debiera variar por acción y que, en cambio, apareciera repetido sin una explicación legítima en el código — es decir, **no encontré ningún caso del "patrón de dato repetido" real (bug) que el dueño mencionó haber visto antes en este repo**, dentro de las 97 filas revisadas.

---

## CONFIANZA

**Alta**, con matices:

- Observación 1 (orden): alta confianza. La cita de código (`materializedScanner.js:1614-1619`, `1560-1565`, `1352`) es directa y sin ambigüedad, y los datos de las 20 primeras filas confirman monotonicidad exacta de `objectiveScore` y no-monotonicidad de `total_score`, coincidiendo con el ejemplo que reportó el dueño.
- Observación 2 (sectorScore): alta confianza. Comprobé las 97 filas completas (no solo una muestra), y encontré varios ejemplos limpios de filas con `sector` GICS distinto pero mismo `theme`/`sectorScore` — la explicación de "agrupa por `theme`, no por `sector`" está confirmada tanto por el código como por los datos.
- Parte C (coherencia general): confianza media-alta. Revisé un conjunto razonable de campos (11 columnas/claves adicionales) sobre las 97 filas, pero no es una auditoría campo-por-campo de las ~90 claves que tiene el JSON `metrics` — ver más abajo.

## LO QUE NO HE VERIFICADO

- No revisé las ~90 claves del JSON `metrics` una por una en busca de repeticiones — solo un subconjunto razonado (scores principales, coverage, riesgo, frescura, benchmark). Podría haber otro campo repetido que no elegí mirar.
- No comprobé si el resto del universo (los 5.508 símbolos que NO pasaron el preset `balanced`) tiene el mismo patrón de `lastDate`/`priceFreshnessDays` uniforme — solo miré las 97 filas guardadas.
- No confirmé directamente si `scripts/refresh-bars.mjs` se ejecutó (y con qué resultado) antes de este escaneo nocturno — la sospecha de "falta la sesión del lunes 10 de agosto" es una inferencia a partir de `lastDate`, no una verificación del log de esa corrida.
- No revisé el escaneo interactivo con datos reales (solo cité su código) — no hay ningún `scan_id` de un escaneo interactivo reciente que haya consultado para contrastar si su `rank_index` (orden de llegada, sin score) produce en la práctica el mismo tipo de desorden frente a `total_score`.
- No verifiqué si existen otros escaneos nocturnos previos (antes de este "primer escaneo completo") con los que comparar si este patrón de `sectorScore`/orden es consistente corrida a corrida.
