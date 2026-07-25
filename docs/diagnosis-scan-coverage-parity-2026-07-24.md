# Diagnóstico — paridad de `scanCoverageBreakdown` y reloj de frescura (2026-07-24)

## Veredicto

**HIPÓTESIS CONFIRMADA, con una precisión importante.**

El agregador legacy sí depende del reloj real del proceso. La función pública
`summarizeScanCoverageBreakdown` acepta un `nowMs` fijo, pero no lo propaga a
`rowShape` ni a `priceFreshness`; cuando una fila no trae
`priceFreshnessDays`, `priceFreshness` calcula la edad con `Date.now()`.

La precisión es que `latestScanAt` no participa en el cálculo de frescura. En
este fixture, el dato que cruza el umbral es
`CCC.metrics.lastDate = "2026-07-07"`. `latestScanAt =
"2026-07-09T11:00:00.000Z"` se deriva de `created_at` y solo se devuelve en el
payload.

El fallo es un problema de determinismo de la referencia legacy usada por los
tests. Este diagnóstico no demuestra un cálculo incorrecto en el path caliente
del GET: el GET consume la RPC agregada y le pasa un `p_now` explícito.

Checkout auditado:

- Ref: `codex/statsedge-ui-polish`
- Commit: `a8abc2f4755987540695b098b895dafa5504a056`
- Worktree: `/tmp/coverage-parity-audit` (detached, porque la rama ya estaba
  asociada a `/private/tmp/tenancy-audit`)

## 1. Línea exacta del umbral de frescura

En este commit no existe `lib/scanCoverageBreakdown.js`. La referencia legacy
está dentro de `app/api/scan-coverage/route.js`.

`app/api/scan-coverage/route.js:57-65`:

```js
function priceFreshness(row = {}, maxDays = DEFAULT_MAX_PRICE_FRESHNESS_DAYS) {
  const stored = metric(row, "priceFreshnessDays");
  if (Number.isFinite(stored)) return { days: stored, ok: stored <= maxDays };
  const lastDate = metricText(row, "lastDate");
  const timestamp = Date.parse(lastDate);
  if (!Number.isFinite(timestamp)) return { days: null, ok: false };
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  return { days, ok: days <= maxDays };
}
```

Las comparaciones contra el umbral son:

- Línea 59: si existe `priceFreshnessDays`, compara directamente
  `stored <= maxDays`; esta rama no depende del reloj.
- Línea 63: si no existe ese campo, calcula los días con
  `Date.now() - Date.parse(lastDate)`.
- Línea 64: declara fresca la fila con `days <= maxDays`.

Los campos derivados se encadenan en
`app/api/scan-coverage/route.js:79-99`:

```js
const freshness = priceFreshness(item, maxPriceFreshnessDays);
const qualityOk = freshness.ok
  && (!Number.isFinite(coverage) || coverage >= minCoverage);
const rankingEligible = qualityOk
  && (!Number.isFinite(objectiveScore) || objectiveScore >= 45);
// ...
priceFresh: freshness.ok,
qualityOk,
rankingEligible,
actionable: rankingEligible,
```

Por tanto, un único cambio de `freshness.ok` puede cambiar simultáneamente
`fresh`, `qualityOk`, `rankingEligible` y `actionable`.

## 2. Fuente real del “ahora”

`summarizeScanCoverageBreakdown` declara un reloj inyectable en
`app/api/scan-coverage/route.js:237`:

```js
export function summarizeScanCoverageBreakdown(
  rows = [],
  {
    maxPriceFreshnessDays = DEFAULT_MAX_PRICE_FRESHNESS_DAYS,
    minCoverageScore = DEFAULT_MIN_COVERAGE,
    includeTop = false,
    nowMs = Date.now(),
  } = {},
) {
```

Sin embargo, la línea 238 llama:

```js
rowShape(row, maxPriceFreshnessDays, minCoverageScore)
```

No pasa `nowMs`. A su vez, `rowShape` llama a `priceFreshness` sin ningún
reloj (`app/api/scan-coverage/route.js:80`), y `priceFreshness` no tiene
parámetro `nowMs`. El identificador `nowMs` declarado en la línea 237 no vuelve
a aparecer dentro del cuerpo.

**Respuesta binaria:** la rama de fallback por `lastDate` usa el
`Date.now()` real del sistema. El `nowMs` fijo pasado por los tests queda
ignorado.

## 3. Fixture fijo y cruce temporal

El test unitario sí intenta fijar el “ahora”:

- `tests/scanCoverageBreakdown.test.js:26`:
  `NOW = Date.parse("2026-07-10T12:00:00.000Z")`.
- Líneas 43 y 70: pasa `{ nowMs: NOW }` a las dos llamadas del agregador.

La fila sensible es `CCC`, en
`tests/scanCoverageBreakdown.test.js:36`:

```js
{
  symbol: "CCC",
  metrics: { lastDate: "2026-07-07" },
  raw: { country: "JP", sector: "Technology" },
  created_at: "2026-07-09T08:00:00.000Z",
}
```

`CCC` no tiene `priceFreshnessDays`, por lo que necesariamente entra en la
rama de `Date.now()` de la línea 63. Tampoco tiene coverage ni score finitos;
las reglas de las líneas 84-85 aceptan ambos valores ausentes siempre que la
fila sea fresca. Por eso `CCC` pasa de:

```text
fresh=true, qualityOk=true, rankingEligible=true, actionable=true
```

a:

```text
fresh=false, qualityOk=false, rankingEligible=false, actionable=false
```

La aritmética exacta observada fue:

| Reloj | Edad calculada desde 2026-07-07T00:00:00Z | Resultado con máximo 5 días |
|---|---:|---|
| `NOW` del fixture: 2026-07-10T12:00:00Z | 3 días | fresca |
| Reloj real de la ejecución: 2026-07-24T17:12:56.835Z | 17 días | no fresca |

Con `Math.floor(...) <= 5`, el primer instante no fresco es
`2026-07-13T00:00:00.000Z`.

`latestScanAt` sigue siendo `"2026-07-09T11:00:00.000Z"` en ambos resultados
porque se calcula por separado a partir del máximo `created_at`
(`app/api/scan-coverage/route.js:242,252`). No es la fecha comparada en la
frescura.

## 4. Prueba causal ejecutada

Se ejecutó únicamente la suite focal en el worktree auditado.

### 4.1 Reloj real

Comando:

```sh
npm test -- --run tests/scanCoverageBreakdown.test.js --reporter=verbose
```

Resultado:

```text
Test Files  1 failed (1)
Tests       2 failed | 3 passed (5)
```

Mismatch observado:

```text
fresh:            expected 3, received 2
qualityOk:        expected 2, received 1
rankingEligible:  expected 1, received 0
actionable:       expected 1, received 0
CCC.fresh:        expected true, received false
```

### 4.2 Mismo código, `Date.now()` fijado al `NOW` del fixture

Se precargó temporalmente, fuera del repo:

```js
Date.now = () => 1783684800000; // 2026-07-10T12:00:00.000Z
```

Comando:

```sh
NODE_OPTIONS=--import=/tmp/statsedge-fixed-date-now-20260710.mjs \
  npm test -- --run tests/scanCoverageBreakdown.test.js --reporter=verbose
```

Resultado:

```text
Test Files  1 passed (1)
Tests       5 passed (5)
```

No cambió ninguna línea del repositorio entre ambas ejecuciones. La única
variable fue la respuesta de `Date.now()`. Esto confirma causalidad, no solo
correlación.

## 5. Por qué cambian los agregados y el orden

El orden de grupos legacy se define en
`app/api/scan-coverage/route.js:130-154`:

```js
.sort((a, b) =>
  b.uniqueSymbols - a.uniqueSymbols
  || b.actionable - a.actionable
  || a.key.localeCompare(b.key)
);
```

Cuando `CCC` es fresca:

- `JP` tiene `actionable = 1` y encabeza `byCountry`.
- `Technology` tiene `actionable = 1` y encabeza `bySector`.

Cuando `CCC` pasa a stale:

- Todos los países del fixture quedan con `actionable = 0`; el desempate
  alfabético produce `AU, DE, JP, US`.
- `Energy` y `Technology` quedan con dos símbolos y `actionable = 0`; el
  desempate alfabético pone `Energy` antes de `Technology`.

Por tanto, el cambio de orden de `byCountry` y `bySector` es un efecto
secundario determinista de la caída de `rankingEligible/actionable`, no una
segunda causa.

Para `topSymbols`, la frescura no participa en el comparador:
`app/api/scan-coverage/route.js:118-127` ordena por `objectiveScore` y solo
proyecta `fresh` como un atributo. En este fixture el orden interno sigue
siendo `AAA, CCC`; el mismatch real es `CCC.fresh: true → false`.

Existe una divergencia de desempate separada, no activada por este fixture:
el legacy no añade `symbol` cuando dos `objectiveScore` empatan
(`route.js:120`), mientras la RPC sí ordena por score y después por símbolo
(`supabase/migrations/20260710112255_scan_coverage_breakdown_parity_fix.sql:114,123,142,151`).
No explica los cuatro fallos descritos aquí.

## 6. Relación con la RPC real

La RPC no tiene el mismo defecto de inyección:

- `supabase/migrations/20260710112255_scan_coverage_breakdown_parity_fix.sql:19`
  recibe `p_now`.
- Líneas 79-83 calculan la edad con `p_now - e.last_date`.
- El test real fija `NOW_ISO/NOW_MS` en
  `tests/integration/scan-coverage-breakdown.real.test.mjs:38-39`.
- Pasa `p_now: NOW_ISO` a la RPC en las líneas 121 y 135.
- Pasa `nowMs: NOW_MS` al legacy en las líneas 113 y 127, pero ese valor es el
  que el legacy ignora.

Así se explican los cuatro fallos documentados:

1. Dos tests unitarios del legacy fallan contra sus expectativas fijas.
2. Los dos tests de paridad real comparan una RPC fijada al 10-07 contra un
   legacy que usa el reloj real; ambos divergen sin y con `includeTop`.

La suite de integración fue invocada en este worktree, pero los tres tests
quedaron `skipped` porque no había `.env.local` ni variables
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. No se ejecutaron hooks, inserts,
deletes ni RPCs contra Supabase. La conclusión sobre esos dos tests de paridad
se basa en el flujo literal de parámetros y en la prueba causal unitaria, no
en una ejecución externa nueva.

## Conclusión final

La receta exacta del fallo no es “`latestScanAt` fijo sin fijar ahora”, sino:

```text
lastDate fijo
+ nowMs fijo pasado por el test
+ nowMs no propagado
+ Date.now() real en priceFreshness
= test dependiente de la fecha de ejecución
```

No se modificó código, no se aplicaron fixes, no se ejecutó SQL y no se tocó
Supabase. El único cambio persistente de este worktree es este informe.
