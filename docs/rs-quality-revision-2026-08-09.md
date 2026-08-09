# Revisión de `rsQualityScore` — 2026-08-09

Tarea de análisis puro. No se ha modificado ningún archivo de código, no
se ha escrito en Supabase, no hay commit ni push. BASE_SHA: `0eb534f`.

## Cómo leer este documento

Cada afirmación sobre código va con cita literal y ruta:línea. Cada
afirmación sobre datos va con la consulta PostgREST exacta usada contra
`scan_results` en producción (solo lectura). El objetivo es que puedas
juzgar la fórmula como inversor, no que confíes en mi resumen.

---

# PARTE A — Qué hace hoy

## 1. `scoreRsQuality` completa, con pesos y umbrales

`lib/relativeStrength.js:243-289`:

```js
export function scoreRsQuality(row = {}) {
  const rs = rsPrimaryValue(row);
  if (!Number.isFinite(rs)) return null;
  let stability = 72;
  if (Number.isFinite(row.volatility63d)) {
    if (row.volatility63d <= 28) stability += 14;
    else if (row.volatility63d <= 45) stability += 7;
    else if (row.volatility63d <= 70) stability -= 3;
    else if (row.volatility63d <= 105) stability -= 10;
    else stability -= 17;
  }
  if (Number.isFinite(row.maxDrawdown63d)) {
    if (row.maxDrawdown63d <= 10) stability += 10;
    else if (row.maxDrawdown63d <= 18) stability += 4;
    else if (row.maxDrawdown63d <= 32) stability -= 4;
    else stability -= 12;
  }
  if (Number.isFinite(row.maxDailyMove20dPct)) {
    if (row.maxDailyMove20dPct <= 6) stability += 5;
    else if (row.maxDailyMove20dPct <= 10) stability += 2;
    else if (row.maxDailyMove20dPct > 28) stability -= 12;
    else if (row.maxDailyMove20dPct > 18) stability -= 6;
  }
  if (Number.isFinite(row.range63dPct)) {
    if (row.range63dPct <= 45) stability += 4;
    else if (row.range63dPct > 100) stability -= 8;
  }
  if (Number.isFinite(row.highsSpreadPct)) {
    if (row.highsSpreadPct <= 8) stability += 6;
    else if (row.highsSpreadPct > 22) stability -= 8;
  }
  if (Number.isFinite(row.extSma50) && row.extSma50 > 28) stability -= 8;
  const rsQualityScore = clamp(rs * .62 + clamp(stability) * .28 + (Number.isFinite(row.riskRewardScore) ? row.riskRewardScore : 45) * .1);
  const speculationRiskScore = clamp(
    Math.max(0, (Number.isFinite(row.volatility63d) ? row.volatility63d : 35) - 35) * .62 +
    Math.max(0, Number.isFinite(row.maxDrawdown63d) ? row.maxDrawdown63d : 12) * .85 +
    Math.max(0, (Number.isFinite(row.maxDailyMove20dPct) ? row.maxDailyMove20dPct : 8) - 10) * 1.35 +
    Math.max(0, (Number.isFinite(row.range63dPct) ? row.range63dPct : 45) - 80) * .22 +
    Math.max(0, (Number.isFinite(row.extSma50) ? row.extSma50 : 0) - 18) * .85 -
    (Number.isFinite(row.liquidityScore) ? row.liquidityScore : 45) * .12
  );
  return {
    rsQualityScore,
    rsStabilityScore: clamp(stability),
    speculationRiskScore,
    rsQualityLabel: rs >= 80 && rsQualityScore >= 72 ? "RS limpio" : rs >= 80 && speculationRiskScore >= 55 ? "RS volatil" : rs >= 75 && rsQualityScore >= 62 ? "RS eficiente" : speculationRiskScore >= 70 ? "Momentum especulativo" : rs >= 60 ? "RS constructivo" : "RS debil",
  };
}
```

### Qué premia y qué penaliza, en castellano llano

**`stability`** arranca en 72 (un valor neutro-alto de fábrica, no un
promedio calculado) y se mueve con seis ajustes independientes, cada
uno activado solo si el dato existe:

| Variable | Premia (stability sube) | Penaliza (stability baja) |
|---|---|---|
| `volatility63d` (volatilidad anualizada 63 sesiones) | ≤28% → +14; ≤45% → +7 | ≤70% → −3; ≤105% → −10; >105% → −17 |
| `maxDrawdown63d` (peor caída pico-valle en 63 sesiones) | ≤10% → +10; ≤18% → +4 | ≤32% → −4; >32% → −12 |
| `maxDailyMove20dPct` (mayor salto diario en 20 sesiones) | ≤6% → +5; ≤10% → +2 | >18% → −6; >28% → −12 |
| `range63dPct` (rango alto-bajo del periodo) | ≤45% → +4 | >100% → −8 |
| `highsSpreadPct` (dispersión entre máximos recientes) | ≤8% → +6 | >22% → −8 |
| `extSma50` (extensión % sobre la media de 50 sesiones) | — (nunca suma) | >28% → −8 |

Interpretación para un inversor: el término `stability` intenta decir
"¿este movimiento de precio es ordenado (poca volatilidad, poco
drawdown, sin gaps violentos, cerca de sus máximos, no sobre-extendido)
o es un cohete errático?". Cuanto más ordenado, más alto.

**El resultado final** combina tres piezas con pesos fijos:

```
rsQualityScore = clamp( RS_base × 0.62  +  stability × 0.28  +  riskRewardScore × 0.10 )
```

- 62% del resultado sigue siendo el RS puro que ya tenías.
- 28% es el bloque de "orden técnico" descrito arriba.
- 10% es `riskRewardScore`, otra señal completa del motor de scoring
  (retorno frente a volatilidad y frente a drawdown), no un dato
  crudo — ver PARTE C.10 sobre por qué esto pesa dos veces lo mismo.

**`speculationRiskScore`** es una señal hermana, separada del
`rsQualityScore` (no entra en su fórmula), que castiga volatilidad,
drawdown, saltos diarios, rango amplio y extensión, y premia liquidez
alta restando puntos. Se usa solo para la etiqueta `rsQualityLabel` y
como filtro propio en otras pantallas (fuera del alcance de esta
revisión).

## 2. Cada entrada: origen, escala, qué pasa si falta

| Campo | Escala | Origen (fuera de esta función) | Si falta |
|---|---|---|---|
| `rsGlobalPct` / `rsRating` (vía `rsPrimaryValue`) | 1–99 (percentil o rating) | `enrichRelativePercentiles` (`lib/relativeStrength.js:224-241`) / `scoreRelativeStrength` | Si **ambos** faltan, `scoreRsQuality` devuelve `null` entero (línea 245: `if (!Number.isFinite(rs)) return null;`) — es la única entrada sin fallback fabricado. |
| `volatility63d` | % anualizado | motor de indicadores técnicos | El bloque `if (Number.isFinite(...))` simplemente se salta — `stability` no se mueve por este término. **No se fabrica un valor**, pero tampoco se penaliza la ausencia: un valor sin volatilidad conocida entra en igualdad de condiciones que uno de volatilidad perfecta. |
| `maxDrawdown63d` | % | igual | igual que arriba: se salta si falta. |
| `maxDailyMove20dPct` | % | igual | igual. |
| `range63dPct` | % | igual | igual. |
| `highsSpreadPct` | % | igual | igual. |
| `extSma50` | % sobre SMA50 | igual | igual (el único término que solo puede penalizar, nunca falta un "premio" por no tener el dato). |
| `riskRewardScore` | 0–100 (señal `SIGNAL_REGISTRY`, `lib/scoringEngine.js:234-269`) | **Sí se fabrica**: `Number.isFinite(row.riskRewardScore) ? row.riskRewardScore : 45` (línea 275) — un 45 neutro-bajo si falta. |

Confirmado por `docs/inventario-dato-ausente-2026-08-01.md:77` (catálogo
previo de valores fabricados en el repo):
> `M33 | lib/relativeStrength.js:275 | ... | riskRewardScore dentro de RS
> quality | FABRICA-VALOR | ... | Fabrica 45.`

`speculationRiskScore` fabrica de forma similar: `35` para
`volatility63d`, `12` para `maxDrawdown63d`, `8` para
`maxDailyMove20dPct`, `45` para `range63dPct`, `0` para `extSma50` y
`45` para `liquidityScore` cuando cada uno falta — pero esto no afecta
a `rsQualityScore`, que no lee `speculationRiskScore`.

## 3. ¿Cuánto puede desviarse del RS base?

Con la fórmula `clamp(rs*.62 + clamp(stability)*.28 + rr*.10)`:

- `stability` raw puede ir de **72 − (17+12+12+8+8+8) = 7** (todos los
  seis términos en su peor tramo) a **72 + (14+10+5+4+6) = 111**,
  que `clamp(stability)` recorta a **100** (extSma50 nunca suma).
- `riskRewardScore` (o su fallback 45) va de 0 a 100.

Para un valor con **RS = 90**:

```
mínimo = clamp(90×.62 + 7×.28 + 0×.10)   = clamp(55.8 + 1.96 + 0)   = 57.76
máximo = clamp(90×.62 + 100×.28 + 100×.10) = clamp(55.8 + 28 + 10) = 93.8
```

Es decir: un valor con RS 90 puede terminar con un `rsQualityScore`
tan bajo como **≈58** (una caída de 32 puntos) o tan alto como
**≈94** (una subida de 4 puntos). El techo está cerca porque
`rs×.62` ya consume la mayor parte del rango disponible; el suelo es
mucho más profundo porque `stability` puede desplomarse. Esta
asimetría se confirma con datos reales en la PARTE B — el caso `XAIR`
(RS 99 → 71.26, −27.74 puntos) está casi en el suelo teórico.

## 4. Justificación de los pesos — ¿hay o no?

Búsqueda realizada:
```
git --no-pager log --follow -p -- lib/relativeStrength.js | grep -n "scoreRsQuality\|^commit\|^Date:"
git show -s --format="%B" fbe8c03
grep -rln "scoreRsQuality" tests/
grep -n "scoreRsQuality\|rsQualityScore" docs/methodology/*.md
```

**No hay ninguna justificación escrita.** El commit que introdujo la
función (`fbe8c03`, "Separate RS universe and benchmark metrics",
2026-05-20) trae el mensaje de commit sin cuerpo — una sola línea, sin
explicación de por qué `.62/.28/.10` en vez de otra combinación, ni por
qué los umbrales de volatilidad son 28/45/70/105, ni por qué el punto
de partida de `stability` es 72 en vez de 50 o 60. No existe ADR, no
existe comentario en el código, no existe mención en
`docs/methodology/*.md` más allá de un test de filtro que usa
`rsQualityScore` como umbral sin explicar la fórmula. Los umbrales y
pesos tienen apariencia de haber sido afinados a ojo contra ejemplos
concretos, no derivados de un criterio documentado (backtesting,
percentiles históricos de volatilidad, etc.) — pero esto es una lectura
de la ausencia de evidencia, no una prueba de que se hicieran "a
ciegas": simplemente no hay rastro escrito de ningún lado.

## 5. Cuándo se escribió y si ha cambiado

```
$ git log --follow --oneline -- lib/relativeStrength.js
7cbbbf2 checkpoint: save all pending scoring engine + cron backstop work before infra sync   (2026-07-06)
45a9a5b Polish screener filters and RS research UX                                            (2026-05-26)
fbe8c03 Separate RS universe and benchmark metrics                                            (2026-05-20)
```

`scoreRsQuality` nació completa en `fbe8c03` (20-may-2026). Verificado
línea a línea: el diff de `45a9a5b` (26-may) y de `7cbbbf2` (6-jul) no
tocan ni una línea de `scoreRsQuality` — ambos commits modifican otras
funciones del mismo archivo (`scoreRsBenchmarkModel`,
`scoreRelativeStrength`, `addScopedPercentile`,
`enrichRelativePercentiles`). **`scoreRsQuality` no ha cambiado ni un
carácter desde que se escribió, hace más de dos meses y medio a fecha
de hoy (09-ago-2026).**

---

# PARTE B — Cómo se comporta con datos reales

## 6. Tabla: 20+ símbolos con RS base, `rsQualityScore` y diferencia

Consulta usada (acotada por fecha para evitar timeout, ejecutada contra
`scan_results` de producción):

```
table: scan_results
select: symbol,metrics->>rsGlobalPct,metrics->>rsQualityScore,
        metrics->>maxDrawdown63d,metrics->>extSma50,
        metrics->>riskRewardScore,metrics->>liquidityScore
filter: created_at=gte.2026-08-08&created_at=lt.2026-08-09
```

De las filas devueltas con ambos campos finitos, esta es una muestra de
20 (dentro de un conjunto de 49 símbolos con datos completos ese día;
las estadísticas del punto 7 usan las 49, no solo las 20, para no
sesgar la lectura):

| Símbolo | RS base (`rsGlobalPct`) | `rsQualityScore` | Diferencia |
|---|---:|---:|---:|
| XAIR | 99 | 71.26 | **−27.74** |
| ON | 93 | 74.06 | **−18.94** |
| KLAC | 95 | 80.32 | **−14.68** |
| QCOM | 83 | 72.56 | **−10.44** |
| Q | 81 | 75.28 | **−5.72** |
| FTNT | 97 | 92.70 | −4.30 |
| UNH | 91 | 94.42 | +3.42 |
| AAPL | 89 | 91.42 | +2.42 |
| GOOGL | 63 | 65.04 | +2.04 |
| KO | 75 | 82.90 | +7.90 |
| JPM | 71 | 81.22 | +10.22 |
| WFC | 57 | 69.14 | +12.14 |
| BRK-B | 53 | 67.86 | +14.86 |
| ORCL | 6 | 21.04 | +15.04 |
| DHR | 32 | 50.14 | +18.14 |
| DIS | 26 | 48.12 | +22.12 |
| ISRG | 10 | 32.18 | +22.18 |
| SYK | 22 | 44.24 | +22.24 |
| UBER | 24 | 46.32 | +22.32 |
| YAAS | 2 | 7.12 | +5.12 |

(Conjunto completo de 49 símbolos y su diferencia disponible; los 29 no
listados arriba se comportan en el mismo patrón que se describe en el
punto 7.)

## 7. ¿En qué dirección corrige más?

Sobre las 49 filas con ambos campos finitos del 08-ago-2026:

- **43 de 49 (≈88%) reciben una corrección positiva** — el
  `rsQualityScore` queda por encima del RS base. La mediana de esa
  corrección positiva ronda **+13 puntos**, con casos de hasta **+22**
  (DIS, ISRG, SYK, UBER).
- **6 de 49 (≈12%) reciben una corrección negativa**: QCOM (−10.44),
  FTNT (−4.30), KLAC (−14.68), ON (−18.94), Q (−5.72), XAIR (−27.74).
  **Las seis tienen RS base ≥81** (81, 83, 93, 95, 97, 99). Ningún
  símbolo con RS bajo o medio recibió corrección negativa en esta
  muestra.

**Conclusión con los números**: la fórmula sube sistemáticamente a los
valores de RS bajo/medio (el suelo `stability`≈72 y el fallback
`riskRewardScore`=45 actúan como un piso que un RS bajo por sí solo no
tiene) y solo hunde a los de RS muy alto, y únicamente cuando además
tienen mala "calidad técnica" (drawdown grande, extensión extrema).
No es que "hunda a los volátiles" en general — los volátiles de RS
bajo ya estaban abajo y la fórmula los sube igual; es que el único
sitio donde puede aparecer una penalización neta grande es en la franja
alta de RS, porque ahí el término `rs×.62` ya está cerca de su techo y
deja poco margen para que `stability` compense si es mala.

## 8. ¿Hay inversión completa de orden?

**Sí, con el propio ejemplo del enunciado superado.** `XAIR` (RS 99)
termina con `rsQualityScore` 71.26 — por debajo de **13 símbolos** de
esta muestra con RS base muy inferior, incluyendo:

| Comparación | RS base | `rsQualityScore` |
|---|---:|---:|
| XAIR | 99 | 71.26 |
| vs. XOM | 65 | 70.06 |
| vs. JPM | 71 | 81.22 |
| vs. KO | 75 | 82.90 |
| vs. EOG | 73 | 78.50 |

Un valor con RS 99 (el máximo posible en la escala) queda por debajo de
otro con RS 65 — una inversión de 34 puntos de RS. Causa visible en los
datos crudos de `XAIR` (consulta punto 9 más abajo): `extSma50 =
748.84%` (extensión sobre su media de 50 sesiones sin precedente en el
resto de la muestra — el resto va de −27% a +18%), `maxDrawdown63d =
40.3%`, `liquidityScore = 20` (bajo). Esto sugiere un dato con
comportamiento anómalo de precio más que un valor genuinamente líder
con mala calidad técnica — ver "LO QUE NO HE VERIFICADO" sobre si el
filtro de saltos de precio anómalos (commit `f35cc43`, ya en esta
rama) debería haber excluido a `XAIR` del ranking y no lo hizo, o si lo
hizo en otro punto del pipeline y esta fila es anterior a ese fix.

`ON` (RS 93 → 74.06) y `KLAC` (RS 95 → 80.32) son ejemplos menos
extremos del mismo patrón, con drawdowns de 33.9% y 28.3%
respectivamente, sin el dato de extensión anómalo de `XAIR`.

## 9. Símbolos con `rsQualityScore` null

Consulta usada (todas las filas del 08-ago-2026, sin filtro adicional):

```
table: scan_results
select: symbol,metrics->>rsGlobalPct,metrics->>rsQualityScore
filter: created_at=gte.2026-08-08&created_at=lt.2026-08-09
```

De 71 filas devueltas ese día, **15 tienen `rsQualityScore` null**,
todas ellas también con `rsGlobalPct` null — coherente con el punto 1
(`rs` no finito ⇒ la función devuelve `null` entero, sin fabricar
nada). Son en su mayoría tickers europeos (`EBS.VI`, `ANDR.VI`,
`VER.VI`, `KBC.BR`, `ABI.BR`, `UCB.BR`, `VWS.CO`, `ORSTED.CO`, `DSV.CO`,
`WRT1V.HE`, `CRE.L`, `STB.OL`, `BCP.LS`, `EDP.LS`, `EDPR.LS`) que no
tienen percentil de universo estadounidense ni `rsRating` de benchmark
calculado en esta fila — probablemente fuera del alcance del scan que
generó estos resultados, o sin barras de benchmark suficientes
(`RS_GLOBAL_MIN_SAMPLE`/`RS_SCOPED_MIN_SAMPLE`). No se investigó el
motivo exacto símbolo por símbolo (fuera del alcance de esta tarea).

Nótese algo aparte del enunciado pero relevante para el punto 1: dos
tickers de este grupo (`KRZ.IR`, `RYA.IR`) tienen `rsGlobalPct` null
pero `rsQualityScore` **sí** finito (70.26 y 59.28) — confirma en datos
reales que `rsPrimaryValue` cae a `rsRating` cuando `rsGlobalPct` falta
(`lib/relativeStrength.js:95-97`), tal como dice el código.

---

# PARTE C — Qué mide de verdad

## 10. ¿Los términos son independientes o redundantes?

**No son independientes. Hay solapamiento real y verificable, no solo
sospecha.** Dos evidencias:

**(a) Dentro de la propia función.** De los seis términos de
`stability`, en la muestra de producción del punto 6 **solo dos
tuvieron algún dato no-null**: `maxDrawdown63d` y `extSma50`.
`volatility63d`, `maxDailyMove20dPct`, `range63dPct` y `highsSpreadPct`
fueron **null en las 30 filas consultadas sin excepción** (consulta:
`select: symbol,metrics->>maxDailyMove20dPct,metrics->>range63dPct,
metrics->>highsSpreadPct,metrics->>extSma50,metrics->>volatility63d`
sobre el mismo filtro del punto 6). Es decir: en la práctica, de los
seis "aspectos de calidad técnica" que la fórmula dice medir, **solo
dos llegan a pesar algo** en los datos que realmente se persisten hoy.
Los otros cuatro están en el código pero inertes.

**(b) Entre `stability` y `riskRewardScore` (el segundo término
ponderado de `rsQualityScore`).** `riskRewardScore` no es un dato
crudo — es otra señal completa (`lib/scoringEngine.js:234-269`) que
recibe **los mismos** `volatility63d` y `maxDrawdown63d` (además de
`maxDailyMove20dPct` y `range63dPct`) y les aplica umbrales casi
idénticos:

```js
// riskRewardScore, lib/scoringEngine.js:249-256
if (Number.isFinite(r.volatility63d)) {
  if (r.volatility63d <= 25) s += 18;
  else if (r.volatility63d <= 40) s += 12;
  else if (r.volatility63d <= 60) s += 6;
}
if (Number.isFinite(r.maxDrawdown63d)) {
  if (r.maxDrawdown63d <= 10) s += 20;
  else if (r.maxDrawdown63d <= 18) s += 14;
  else if (r.maxDrawdown63d <= 32) s += 7;
}
```

Compárese con los tramos de `volatility63d`/`maxDrawdown63d` dentro de
`scoreRsQuality` citados en el punto 1: umbrales prácticamente
calcados (25/40/60 vs. 28/45/70; 10/18/32 vs. 10/18/32 — **idénticos**
en `maxDrawdown63d`). Cuando un valor tiene drawdown grande, se
penaliza **dos veces** dentro de `rsQualityScore`: una vez directamente
en `stability` (peso .28) y otra vez indirectamente a través de
`riskRewardScore` (peso .10, y ese `riskRewardScore` ya lleva el
drawdown incorporado con un peso interno propio). El ejemplo del
enunciado — "un valor volátil también tiene drawdown grande y rango
amplio, el castigo se aplica tres veces" — se confirma parcialmente con
los datos reales: hoy solo `maxDrawdown63d` y `extSma50` están vivos en
la muestra, así que el triple castigo teórico (volatilidad + drawdown +
rango, todos dentro de `stability`) no se observa en producción ahora
mismo, pero el castigo doble (drawdown en `stability` **y** dentro de
`riskRewardScore`) sí es real y medible: `QCOM`, `KLAC`, `ON` y `XAIR`
—los cuatro con `maxDrawdown63d` >28%— son también los cuatro con
`riskRewardScore` más bajo de la muestra (43, 35, 24, 40 respectivamente,
frente a valores como 88-100 para las acciones de RS alto y bajo
drawdown).

## 11. ¿Solapamiento con otras señales del registro?

Sí, documentado ya en `docs/contrato-senales-2026-08-04.md` y
`docs/duplicados-restantes-2026-08-07.md` (trabajo previo de auditoría
de este mismo repo, no producido para esta tarea):

- **`riskScore`** (`lib/scoringEngine.js`, señal propia del registro,
  peso 0.05 en el composite) usa `extSma50` con umbrales de tramo
  distintos pero la misma variable de entrada que el término
  `extSma50 > 28 → stability -= 8` de `scoreRsQuality`. Mismo dato
  crudo, dos fórmulas separadas que lo interpretan cada una a su
  manera.
- **`rsStabilityScore`** es literalmente la salida `stability` de
  `scoreRsQuality` — no es una señal distinta, es el mismo cálculo
  expuesto con otro nombre de campo.
- **`speculationRiskScore`** es un cálculo hermano dentro de la misma
  función, con los mismos cinco insumos de `stability` (`volatility63d`,
  `maxDrawdown63d`, `maxDailyMove20dPct`, `range63dPct`, `extSma50`)
  más `liquidityScore`, pero con pesos y dirección distintos (no premia,
  solo penaliza, y resta liquidez). Mide el mismo terreno que
  `stability` con una lente diferente ("¿qué tan especulativo es esto?"
  en vez de "¿qué tan estable es?").
- `docs/contrato-senales-2026-08-04.md:198` documenta además que
  **`rsQualityScore` tiene tres fórmulas de superficie distintas en el
  repo** (la canónica de `relativeStrength.js`, y dos en
  `app/api/company-brief/route.js` con pesos `.68/.32` en vez de
  `.62/.28/.10` y sin el término `riskRewardScore`): mismo nombre de
  campo, mismo propósito declarado, número distinto según qué pantalla
  lo calcule. `docs/duplicados-restantes-2026-08-07.md` documenta que
  una de las tres (`mergeUniverseRelativeStrength`) ya se unificó con
  la canónica en una tarea anterior; la otra (`relativeStrengthFromBars`,
  usada cuando el símbolo no tiene snapshot de scan) sigue divergente
  por una limitación real de datos (no tiene acceso a `riskRewardScore`
  sin recalcular otra señal completa). Verificado en el código actual
  de esta rama (`app/api/company-brief/route.js:267-348,886-942`): el
  estado descrito en ese documento sigue siendo el estado de `HEAD`.

Resumen para el dueño: no hay 3-4 señales midiendo la misma "calidad
técnica" con nombres distintos por diseño deliberado de diversidad de
señal — hay una única idea (¿volatilidad/drawdown/extensión buenos o
malos?) recalculada con umbrales ligeramente distintos en al menos
tres sitios (`scoreRsQuality`/`stability`, `riskRewardScore`,
`riskScore`), más una cuarta variante de la propia `rsQualityScore` que
ni siquiera coincide numéricamente entre pantallas.

---

# PARTE D — Alternativas (sin recomendación)

| Opción | Qué se gana | Qué se pierde | Qué habría que tocar |
|---|---|---|---|
| **Dejarlo como está** | Cero riesgo de romper nada; el screener sigue funcionando igual mientras cambia la base de RS de "percentil del lote" a "percentil de 4.217 valores". | Nadie sabe hoy si los pesos `.62/.28/.10` seguían siendo razonables para RS-sobre-lote-pequeño; con RS-sobre-universo la distribución de entrada cambia (percentiles más finos, colas más largas) y la fórmula nunca se validó contra eso. También se mantiene el doble castigo de drawdown (C.10) y los cuatro términos de `stability` que hoy están inertes en producción (C.10a). | Nada — es la opción de no tocar código. |
| **Simplificar a menos términos** | Menos redundancia con `riskRewardScore`/`riskScore`; más fácil de explicar y de auditar; los cuatro términos inertes (`volatility63d`, `maxDailyMove20dPct`, `range63dPct`, `highsSpreadPct`) dejarían de aparentar que hacen algo que no hacen. | Se pierde granularidad si esos cuatro campos empiezan a poblarse en el futuro (hoy están inertes por falta de dato persistido, no porque la idea sea mala). Requiere decidir qué se queda y qué se quita, sin criterio documentado previo que guíe la decisión (punto 4). | `lib/relativeStrength.js:243-289`; recalibrar umbrales; actualizar los tests que dependan del valor exacto (`tests/companyBriefRsQualityScore.test.js`, filtros `minRsQualityScore` en `docs/methodology/latest-filter-contract-audit.md`). |
| **Separar RS puro y calidad como dos números independientes** | El usuario ve "esto tiene fuerza relativa X" y, por separado, "esto tiene calidad técnica Y" — sin que un número contamine al otro ni sin la ambigüedad de que "RS quality" ya no sea RS. Coincide con la definición del dueño ("un normalizador... no una métrica independiente") solo si el objetivo pasa a ser mostrar ambas piezas en vez de fusionarlas. | Se pierde el número único que hoy ordena/filtra en una sola columna; el composite (`COMPOSITE_WEIGHTS`, peso 0.06) tendría que decidir si pesa las dos piezas por separado o sigue fusionándolas internamente (lo cual reintroduce el mismo problema en otro sitio). | `lib/relativeStrength.js` (nueva forma de retorno), `lib/screenerTable.jsx:57,116-118` (columna "Q"), `lib/scoringEngine.js` (`COMPOSITE_WEIGHTS`), las tres implementaciones de `app/api/company-brief/route.js`, `lib/listRationale.js:166`, filtros `minRsQualityScore`. |
| **Cambiar los pesos** (p. ej. reducir `.62` para dejar más margen a que `stability` sí pueda tirar hacia arriba a un RS alto, o subir el suelo mínimo de `stability`) | Ajuste quirúrgico sin rediseñar la arquitectura; podría suavizar casos como `XAIR` (−27.74) sin tocar el resto. | Sigue sin haber un criterio documentado para elegir los nuevos pesos — el mismo problema del punto 4 se repite con números distintos, salvo que esta vez se documente el porqué. | Solo `lib/relativeStrength.js:275` (y las tres copias de `app/api/company-brief/route.js` si se quiere consistencia, ver C.11). |

No se evaluó una quinta opción con nombre propio; las cuatro anteriores
cubren el espacio de "no tocar / quitar / separar / recalibrar" que
pidió el enunciado.

## 13. ¿Cómo lo hace la competencia?

No tengo acceso a herramientas de búsqueda web en esta sesión (no se
usó `WebSearch`/`WebFetch`), así que esto **no está verificado con
fuentes primarias** — lo digo explícitamente para no fabricar una
respuesta. Lo que sí puedo decir con lo que sé de forma general, con
escepticismo declarado:

- **IBD (Investor's Business Daily) publica un "RS Rating"** que es un
  percentil de fuerza de precio puro (1-99), sin un ajuste de "calidad"
  separado con ese nombre — es la pieza equivalente a `rsGlobalPct` en
  este repo, no a `rsQualityScore`.
- IBD sí tiene métricas de "calidad" separadas y con nombre propio
  (p. ej. Composite Rating, Up/Down Volume, Accumulation/Distribution
  Rating), pero son señales **independientes y visibles por separado**,
  no un ajuste que se funde dentro del propio RS. Esto es coherente con
  la opción "separar RS puro y calidad" de la Parte D, pero no puedo
  confirmar los pesos ni la metodología exacta de IBD sin acceso a
  fuentes verificables en esta sesión — cualquier cifra que diera aquí
  sería una reconstrucción de memoria, no una cita verificada, así que
  prefiero no dar números que no pueda respaldar.
- No tengo información fiable sobre si MarketSmith publica un
  equivalente propio distinto del RS Rating de IBD (son productos del
  mismo grupo).

Si quieres una respuesta verificada aquí, requeriría una sesión con
acceso a búsqueda web y la instrucción explícita de investigar esto
como tarea aparte.

---

## CONFIANZA

- **Alta**: la cita literal de `scoreRsQuality` y de las tres
  implementaciones divergentes de `rsQualityScore` — lectura directa
  de `HEAD` en esta rama, confirmada dos veces con `grep`/`Read`.
- **Alta**: que la función no ha cambiado desde el 20-may-2026 —
  verificado con `git log --follow -p` sobre el archivo completo y
  confirmando línea por línea que ninguno de los dos commits
  posteriores toca el rango de líneas de `scoreRsQuality`.
- **Alta**: que no existe justificación escrita de los pesos —
  búsqueda en el mensaje del commit de origen, en `tests/`, y en
  `docs/methodology/*.md`; ausencia consistente en las tres fuentes.
- **Alta**: los datos de la Parte B — 4 consultas PostgREST ejecutadas
  contra producción con fecha acotada (`created_at` del 08-ago-2026),
  resultados citados sin redondeo adicional al que ya trae la base.
- **Alta**: el solapamiento entre `stability` y `riskRewardScore` (C.10b)
  — comparación literal de umbrales de dos funciones del código fuente
  actual, no una inferencia.
- **Media**: la causa de por qué `XAIR` tiene `extSma50 = 748%` — el
  dato es real y viene de producción, pero no investigué si es un
  precio genuinamente anómalo (ej. reverse split mal ajustado, ticker
  de baja capitalización con un movimiento real extremo) o si debería
  haber sido excluido por el filtro de saltos de precio anómalos que
  ya existe en esta rama (commit `f35cc43`). Esto está fuera del
  alcance declarado de la tarea (revisar `rsQualityScore`, no auditar
  el filtro de anomalías), pero condiciona la lectura del ejemplo más
  extremo de la Parte B.
- **Baja**: la sección 13 (competencia) — declarada explícitamente sin
  verificación por falta de acceso a búsqueda web en esta sesión.

## LO QUE NO HE VERIFICADO

- Por qué exactamente 15 símbolos concretos del 08-ago-2026 tienen
  `rsGlobalPct`/`rsQualityScore` null símbolo por símbolo (si es
  cobertura de universo, tamaño mínimo de muestra de benchmark, o un
  fallo de datos) — se listaron los 15 tickers pero no se investigó la
  causa individual de cada uno.
- Si el patrón "solo `maxDrawdown63d` y `extSma50` tienen datos reales;
  el resto de términos de `stability` están siempre null" (C.10a) es
  así en **todo** el histórico de `scan_results` o es una particularidad
  del día/scan consultado — solo se verificó contra las filas del
  08-ago-2026 (dos consultas, 30 filas cada una), no contra un rango
  más amplio (el aviso de timeout sin filtro de fecha impidió una
  consulta más extensa en esta sesión).
- Si `XAIR` debería haber sido excluido por el filtro de saltos de
  precio anómalos (commit `f35cc43`, ya en esta rama) — no se revisó
  ese código en esta tarea, solo se citó su existencia como hipótesis.
- Qué pasará con la distribución de `rsGlobalPct` (y por tanto con el
  `rsQualityScore` resultante) cuando el RS base pase de percentil
  sobre el lote de un scan a percentil sobre 4.217 valores del universo
  — no se simuló ni se comparó contra un snapshot con la metodología
  nueva ya activa, porque el enunciado dice que ese cambio "va a pasar"
  (futuro), no que ya esté en producción a fecha de esta revisión.
- Metodología exacta de IBD/MarketSmith (punto 13) — sin fuentes
  verificadas en esta sesión, ver aviso explícito arriba.
- Si existen más consumidores de `rsQualityScore`/`scoreRsQuality`
  fuera de `app/` y `lib/` (scripts, cron externos, endpoints no
  listados) — la búsqueda se limitó a esos dos directorios.

---

**Problema evidente, en una línea**: `riskRewardScore` entra en
`rsQualityScore` con peso .10 pero ya lleva dentro, con umbrales casi
idénticos, los mismos `volatility63d`/`maxDrawdown63d` que `stability`
vuelve a puntuar por separado con peso .28 — es el mismo dato
penalizado dos veces bajo dos nombres distintos, confirmado en el
código (C.10b) y visible en los cuatro símbolos de peor drawdown de la
muestra real (C.10b).
