> **CORREGIDO el 2026-08-04.** Las siguientes cifras de este
> documento han sido superadas por mediciones posteriores:
> - 23,1 s para ~880 y 4 min 52 s para 11.123 → **solo miden/extrapolan la descarga de barras**, no el ciclo completo; no hay una duración completa sostenida verificada, ver `bench-analyze-2026-08-04.md` y `limites-cron-2026-08-04.md`.
> - Capacidad de ≈659.405 símbolos en 6 h con margen y conclusión de que una sola corrida basta → **no válidas para el ciclo completo de producción**; producción mide 2,118 s/símbolo en lotes pequeños y se modela como ≈33,7 s fijos + ≈0,535 s marginales/símbolo, sin validación a escala de 11.123.
>
> El resto del documento sigue siendo válido.

# Benchmark de concurrencia contra Yahoo Finance — 2026-08-04

Objetivo: medir cuánta concurrencia aguanta Yahoo Finance al descargar barras
diarias, con la MISMA función que usa el escaneo real, para informar el
diseño del escaneo en GitHub Actions (ver
[docs/escaneo-github-actions-2026-08-04.md](escaneo-github-actions-2026-08-04.md)).

Esta corrida fue **deliberadamente conservadora**: máximo 8 de concurrencia,
máximo 30 símbolos por corrida, 60s de espera entre corridas, abortar al
primer 429, no reintentar corridas fallidas. No se superó ningún límite de
los indicados en la tarea.

---

## PARTE A — Preparación

### A.1 — Función de descarga real y clasificación de errores

La función real que hace el fetch HTTP a Yahoo es `fetchYahooChartDirect`
en [lib/yahoo.js:1226-1281](../lib/yahoo.js), envuelta por
`fetchYahooChart` ([lib/yahoo.js:1283-1309](../lib/yahoo.js)).

```js
async function fetchYahooChartDirect(symbol, options = {}) {
  const yahooSymbol = canonicalYahooSymbol(symbol);
  const request = chartRequestOptions(options);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${encodeURIComponent(request.yahooRange)}&interval=${encodeURIComponent(request.yahooInterval)}&includePrePost=false&events=div%2Csplits`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, next: { revalidate: request.intraday ? 60 : 21600 } });
  if (!res.ok) throw new Error(`Yahoo chart HTTP ${res.status}`);
  const data = await res.json();
  // ... parseo de bars/meta/splitEvents ...
}
```

**Manejo de 429/5xx en esta capa: ninguno.** Solo `if (!res.ok) throw new
Error(\`Yahoo chart HTTP ${res.status}\`)` — un `Error` plano, sin retry,
sin backoff. El wrapper `fetchYahooChart` captura ese error y cae
inmediatamente a fallback (Stooq, luego Alpha Vantage) sin reintentar Yahoo:

```js
export async function fetchYahooChart(symbol, options = {}) {
  // ...
  try {
    const yahoo = await fetchYahooChartDirect(symbol, options);
    if ((yahoo.bars || []).length >= (request.intraday ? 5 : 20)) return yahoo;
    return runFallbacks("Yahoo historico insuficiente");
  } catch (error) {
    return runFallbacks(error.message || "Yahoo no disponible");
  }
}
```

La clasificación tipada (`retryable`/`terminal`/`unknown`) vive en una capa
separada, [lib/scanErrors.js:27-99](../lib/scanErrors.js), usada por el scan
runner solo para telemetría — no dispara ningún reintento automático:

```js
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504, 521, 522, 523, 524]);
const TERMINAL_HTTP = new Set([400, 401, 403, 404, 410]);
```

### A.2 — Script de medición

Creado en [scripts/bench-concurrency.mjs](../scripts/bench-concurrency.mjs).

- Importa `fetchYahooChart` desde `@/lib/marketData.js` — la fachada de
  caché que usa `lib/materializedScanner.js:fetchChartForScan`, que a su
  vez es la función real del escaneo batch. No se reimplementó ninguna
  lógica de descarga.
- Usa `scripts/loader.mjs` para resolver el alias `@/` (mismo mecanismo que
  el resto de scripts de `npm run audit:*`).
- Llama con `{ refresh: true, useCache: false }` para desactivar la caché de
  memoria (`lib/marketData.js:46`) y forzar una petición HTTP real a Yahoo
  en cada llamada — no escribe en Supabase en ningún momento.
- Aborta la corrida completa (deja de lanzar nuevos workers) en cuanto
  `classifyProviderError(error).status === 429` en cualquier símbolo.
- Reporta símbolos, concurrencia, tiempo total, tiempo medio por símbolo,
  **rendimiento total** (símbolos exitosos/segundo), éxitos, 429, 5xx y
  otros errores.

---

## PARTE B — Mediciones

### B.1 — Los 30 símbolos usados (idénticos en las 4 corridas)

Obtenidos vía `supabase_query` sobre `scan_results`, filtro `country=eq.US`,
ordenados por `created_at.desc`, deduplicados:

```
AIRS, AIRJ, AAPL, MSFT, AMZN, NVDA, GOOGL, META, KO, HD, COST, BRK-B, DIS,
EOG, XAIR, WFC, TMO, VZ, UBER, SYK, RBLX, Q, PLTR, ON, LIN, FTNT, NFLX,
KLAC, JPM, ISRG
```

### B.2 — Corrida concurrencia = 2

```
Bench: 30 simbolos, concurrencia=2, cache desactivada (refresh:true)
Simbolos: AIRS, AIRJ, AAPL, MSFT, AMZN, NVDA, GOOGL, META, KO, HD, COST, BRK-B, DIS, EOG, XAIR, WFC, TMO, VZ, UBER, SYK, RBLX, Q, PLTR, ON, LIN, FTNT, NFLX, KLAC, JPM, ISRG

=== RESULTADO ===
Simbolos objetivo: 30
Simbolos intentados: 30
Concurrencia: 2
Tiempo total: 2.05s
Tiempo medio por simbolo: 0.13s
RENDIMIENTO TOTAL: 14.6128 simbolos/seg (exitosos)
Exitos: 30
429: 0
5xx: 0
Otros errores: 0
Abortado por 429: NO

=== DETALLE POR SIMBOLO ===
  AIRS: OK 333ms bars=499
  AIRJ: OK 257ms bars=499
  AAPL: OK 121ms bars=499
  MSFT: OK 133ms bars=499
  AMZN: OK 93ms bars=499
  NVDA: OK 126ms bars=499
  GOOGL: OK 85ms bars=499
  META: OK 89ms bars=499
  KO: OK 181ms bars=499
  HD: OK 131ms bars=499
  COST: OK 105ms bars=499
  BRK-B: OK 105ms bars=499
  DIS: OK 293ms bars=499
  EOG: OK 133ms bars=499
  XAIR: OK 160ms bars=499
  WFC: OK 154ms bars=499
  TMO: OK 109ms bars=499
  VZ: OK 127ms bars=499
  UBER: OK 86ms bars=499
  SYK: OK 126ms bars=499
  RBLX: OK 97ms bars=499
  Q: OK 79ms bars=191
  PLTR: OK 78ms bars=499
  ON: OK 107ms bars=499
  LIN: OK 138ms bars=499
  FTNT: OK 94ms bars=499
  NFLX: OK 84ms bars=499
  KLAC: OK 152ms bars=499
  JPM: OK 156ms bars=499
  ISRG: OK 76ms bars=499

{
  "symbolsRequested": 30,
  "symbolsAttempted": 30,
  "concurrency": 2,
  "totalMs": 2053,
  "avgPerSymbolMs": 133.6,
  "throughputPerSec": 14.612761811982464,
  "successes": 30,
  "errors429": 0,
  "errors5xx": 0,
  "errorsOther": 0,
  "aborted": false,
  "abortReason": null
}
```

*(60s de espera antes de la siguiente corrida)*

### B.3 — Corrida concurrencia = 4

```
Bench: 30 simbolos, concurrencia=4, cache desactivada (refresh:true)

=== RESULTADO ===
Simbolos objetivo: 30
Simbolos intentados: 30
Concurrencia: 4
Tiempo total: 1.47s
Tiempo medio por simbolo: 0.18s
RENDIMIENTO TOTAL: 20.4221 simbolos/seg (exitosos)
Exitos: 30
429: 0
5xx: 0
Otros errores: 0
Abortado por 429: NO

=== DETALLE POR SIMBOLO ===
  AIRS: OK 443ms bars=499
  AIRJ: OK 383ms bars=499
  AAPL: OK 393ms bars=499
  MSFT: OK 390ms bars=499
  AMZN: OK 153ms bars=499
  NVDA: OK 154ms bars=499
  GOOGL: OK 144ms bars=499
  META: OK 138ms bars=499
  KO: OK 148ms bars=499
  HD: OK 119ms bars=499
  COST: OK 137ms bars=499
  BRK-B: OK 82ms bars=499
  DIS: OK 223ms bars=499
  EOG: OK 186ms bars=499
  XAIR: OK 162ms bars=499
  WFC: OK 163ms bars=499
  TMO: OK 210ms bars=499
  VZ: OK 144ms bars=499
  UBER: OK 84ms bars=499
  SYK: OK 198ms bars=499
  RBLX: OK 117ms bars=499
  Q: OK 85ms bars=191
  PLTR: OK 91ms bars=499
  ON: OK 79ms bars=499
  LIN: OK 199ms bars=499
  FTNT: OK 83ms bars=499
  NFLX: OK 125ms bars=499
  KLAC: OK 124ms bars=499
  JPM: OK 256ms bars=499
  ISRG: OK 159ms bars=499

{
  "symbolsRequested": 30,
  "symbolsAttempted": 30,
  "concurrency": 4,
  "totalMs": 1469,
  "avgPerSymbolMs": 179.06666666666666,
  "throughputPerSec": 20.42205582028591,
  "successes": 30,
  "errors429": 0,
  "errors5xx": 0,
  "errorsOther": 0,
  "aborted": false,
  "abortReason": null
}
```

*(60s de espera antes de la siguiente corrida)*

### B.4 — Corrida concurrencia = 6

```
Bench: 30 simbolos, concurrencia=6, cache desactivada (refresh:true)

=== RESULTADO ===
Simbolos objetivo: 30
Simbolos intentados: 30
Concurrencia: 6
Tiempo total: 0.95s
Tiempo medio por simbolo: 0.17s
RENDIMIENTO TOTAL: 31.5457 simbolos/seg (exitosos)
Exitos: 30
429: 0
5xx: 0
Otros errores: 0
Abortado por 429: NO

=== DETALLE POR SIMBOLO ===
  AIRS: OK 365ms bars=499
  AIRJ: OK 300ms bars=499
  AAPL: OK 381ms bars=499
  MSFT: OK 350ms bars=499
  AMZN: OK 304ms bars=499
  NVDA: OK 371ms bars=499
  GOOGL: OK 133ms bars=499
  META: OK 159ms bars=499
  KO: OK 171ms bars=499
  HD: OK 123ms bars=499
  COST: OK 134ms bars=499
  BRK-B: OK 83ms bars=499
  DIS: OK 139ms bars=499
  EOG: OK 178ms bars=499
  XAIR: OK 105ms bars=499
  WFC: OK 182ms bars=499
  TMO: OK 176ms bars=499
  VZ: OK 147ms bars=499
  UBER: OK 93ms bars=499
  SYK: OK 147ms bars=499
  RBLX: OK 96ms bars=499
  Q: OK 71ms bars=191
  PLTR: OK 114ms bars=499
  ON: OK 85ms bars=499
  LIN: OK 133ms bars=499
  FTNT: OK 137ms bars=499
  NFLX: OK 78ms bars=499
  KLAC: OK 127ms bars=499
  JPM: OK 148ms bars=499
  ISRG: OK 98ms bars=499

{
  "symbolsRequested": 30,
  "symbolsAttempted": 30,
  "concurrency": 6,
  "totalMs": 951,
  "avgPerSymbolMs": 170.93333333333334,
  "throughputPerSec": 31.54574132492114,
  "successes": 30,
  "errors429": 0,
  "errors5xx": 0,
  "errorsOther": 0,
  "aborted": false,
  "abortReason": null
}
```

*(60s de espera antes de la siguiente corrida)*

### B.5 — Corrida concurrencia = 8 (primera pasada)

```
Bench: 30 simbolos, concurrencia=8, cache desactivada (refresh:true)

=== RESULTADO ===
Simbolos objetivo: 30
Simbolos intentados: 30
Concurrencia: 8
Tiempo total: 0.85s
Tiempo medio por simbolo: 0.19s
RENDIMIENTO TOTAL: 35.1700 simbolos/seg (exitosos)
Exitos: 30
429: 0
5xx: 0
Otros errores: 0
Abortado por 429: NO

=== DETALLE POR SIMBOLO ===
  AIRS: OK 343ms bars=499
  AIRJ: OK 281ms bars=499
  AAPL: OK 323ms bars=499
  MSFT: OK 345ms bars=499
  AMZN: OK 283ms bars=499
  NVDA: OK 318ms bars=499
  GOOGL: OK 284ms bars=499
  META: OK 303ms bars=499
  KO: OK 164ms bars=499
  HD: OK 142ms bars=499
  COST: OK 119ms bars=499
  BRK-B: OK 111ms bars=499
  DIS: OK 131ms bars=499
  EOG: OK 135ms bars=499
  XAIR: OK 87ms bars=499
  WFC: OK 227ms bars=499
  TMO: OK 173ms bars=499
  VZ: OK 175ms bars=499
  UBER: OK 157ms bars=499
  SYK: OK 153ms bars=499
  RBLX: OK 131ms bars=499
  Q: OK 128ms bars=191
  PLTR: OK 119ms bars=499
  ON: OK 219ms bars=499
  LIN: OK 221ms bars=499
  FTNT: OK 218ms bars=499
  NFLX: OK 90ms bars=499
  KLAC: OK 108ms bars=499
  JPM: OK 217ms bars=499
  ISRG: OK 83ms bars=499

{
  "symbolsRequested": 30,
  "symbolsAttempted": 30,
  "concurrency": 8,
  "totalMs": 853,
  "avgPerSymbolMs": 192.93333333333334,
  "throughputPerSec": 35.16998827667057,
  "successes": 30,
  "errors429": 0,
  "errors5xx": 0,
  "errorsOther": 0,
  "aborted": false,
  "abortReason": null
}
```

Sin incidencias y sin caída de rendimiento respecto al nivel anterior →
se procedió, según el protocolo (paso 7), a repetir el nivel 8 una segunda
vez tras 60s adicionales, para confirmar estabilidad. **No se subió de 8
en ningún momento.**

*(60s de espera antes de la repetición)*

### B.6 — Corrida concurrencia = 8 (segunda pasada, confirmación)

```
Bench: 30 simbolos, concurrencia=8, cache desactivada (refresh:true)

=== RESULTADO ===
Simbolos objetivo: 30
Simbolos intentados: 30
Concurrencia: 8
Tiempo total: 0.73s
Tiempo medio por simbolo: 0.17s
RENDIMIENTO TOTAL: 41.1523 simbolos/seg (exitosos)
Exitos: 30
429: 0
5xx: 0
Otros errores: 0
Abortado por 429: NO

=== DETALLE POR SIMBOLO ===
  AIRS: OK 323ms bars=499
  AIRJ: OK 270ms bars=499
  AAPL: OK 303ms bars=499
  MSFT: OK 298ms bars=499
  AMZN: OK 264ms bars=499
  NVDA: OK 294ms bars=499
  GOOGL: OK 298ms bars=499
  META: OK 262ms bars=499
  KO: OK 182ms bars=499
  HD: OK 172ms bars=499
  COST: OK 172ms bars=499
  BRK-B: OK 163ms bars=499
  DIS: OK 144ms bars=499
  EOG: OK 143ms bars=499
  XAIR: OK 133ms bars=499
  WFC: OK 149ms bars=499
  TMO: OK 128ms bars=499
  VZ: OK 148ms bars=499
  UBER: OK 85ms bars=499
  SYK: OK 168ms bars=499
  RBLX: OK 80ms bars=499
  Q: OK 76ms bars=191
  PLTR: OK 95ms bars=499
  ON: OK 84ms bars=499
  LIN: OK 144ms bars=499
  FTNT: OK 89ms bars=499
  NFLX: OK 86ms bars=499
  KLAC: OK 124ms bars=499
  JPM: OK 129ms bars=499
  ISRG: OK 103ms bars=499

{
  "symbolsRequested": 30,
  "symbolsAttempted": 30,
  "concurrency": 8,
  "totalMs": 729,
  "avgPerSymbolMs": 170.3,
  "throughputPerSec": 41.1522633744856,
  "successes": 30,
  "errors429": 0,
  "errors5xx": 0,
  "errorsOther": 0,
  "aborted": false,
  "abortReason": null
}
```

Nivel 8 estable en ambas pasadas: 0 errores en total sobre 4×30 + 30 = 150
peticiones reales a Yahoo (5 corridas × 30 símbolos). **No se subió de 8**,
tal como exigía el protocolo — cualquier nivel superior queda pendiente de
decisión humana con estos datos delante.

---

## Tabla comparativa (medido)

| Concurrencia | Tiempo total | Tiempo medio/símbolo | **Rendimiento total (símbolos/s)** | Éxitos | 429 | 5xx | Otros |
|---|---|---|---|---|---|---|---|
| 2 | 2.05s | 0.13s | **14.61** | 30/30 | 0 | 0 | 0 |
| 4 | 1.47s | 0.18s | **20.42** | 30/30 | 0 | 0 | 0 |
| 6 | 0.95s | 0.17s | **31.55** | 30/30 | 0 | 0 | 0 |
| 8 (1ª) | 0.85s | 0.19s | **35.17** | 30/30 | 0 | 0 | 0 |
| 8 (2ª) | 0.73s | 0.17s | **41.15** | 30/30 | 0 | 0 | 0 |

El rendimiento total mejora monótonamente en cada nivel medido — nunca hubo
razón de parada (ni 429, ni tasa de error, ni estancamiento del
rendimiento). El tiempo medio por símbolo sube ligeramente con la
concurrencia (0.13s → ~0.17-0.19s), tal como anticipaba la tarea: es
contención local (más peticiones concurrentes compitiendo por el mismo
event loop/conexión), no señal de throttling del proveedor.

**No se midió ningún nivel por encima de 8** — la tarea lo prohibía
explícitamente. Los cálculos de la Parte C para "el mejor nivel medido"
usan el nivel 8, promediando las dos pasadas: **38,16 símbolos/s**
((35.17 + 41.15) / 2).

---

## PARTE C — Interpretación

### C.1 — Cuántos símbolos caben en 6h por nivel medido, con 20% de margen

Ventana efectiva tras margen: 6h × 0,80 = 4,8h = 17.280s.

| Concurrencia | Rendimiento (símb/s) | Símbolos en 6h con 20% margen |
|---|---|---|
| 2 | 14.61 | ≈ 252.480 |
| 4 | 20.42 | ≈ 352.858 |
| 6 | 31.55 | ≈ 545.184 |
| 8 (promedio) | 38.16 | ≈ 659.405 |

**Esto es un cálculo derivado**, no una medición: extrapola una corrida de
30 símbolos (0,7-2s de duración real) a una ventana de 6h continuas. No se
midió cómo se comporta Yahoo bajo carga sostenida ni durante minutos u
horas — solo ráfagas cortas de 30 peticiones. Ver "LO QUE NO HE
VERIFICADO" más abajo.

### C.2 — Tiempo para el universo relevante (~880) y el elegible (11.123) al mejor nivel MEDIDO (concurrencia 8, 38,16 símb/s)

- Universo relevante (~880 símbolos, cifra tomada de
  [docs/universo-relevante-2026-08-04.md:218](universo-relevante-2026-08-04.md)):
  880 / 38.16 ≈ **23,1 segundos**.
- Universo elegible completo (11.123 símbolos, cifra confirmada en
  [docs/universo-relevante-2026-08-04.md:9](universo-relevante-2026-08-04.md)):
  11.123 / 38.16 ≈ **291,5 segundos ≈ 4 minutos 52 segundos**.

No se extrapola a niveles no medidos (>8). Esto es un cálculo, no una
medición directa de esos universos completos.

### C.3 — ¿Cabe el universo elegible completo (11.123) en una corrida de 6h?

**Sí, sobra margen amplísimo** según el cálculo anterior: a 38,16 símb/s
(concurrencia 8), el universo elegible completo tardaría ~4m52s — muy por
debajo de las 6h del tope de GitHub Actions, incluso sin aplicar el 20% de
margen. Con margen del 20% (ventana de 4,8h efectivas), cabrían ~659.405
símbolos, ~59× el universo elegible actual. **Una sola corrida basta**, no
hacen falta corridas adicionales, según este cálculo.

**Importante:** esta conclusión asume que el rendimiento medido en ráfagas
de 30 símbolos (0,7-2s) se sostiene sin degradación a lo largo de miles de
peticiones y minutos/horas de duración — algo que esta tarea, por diseño,
tenía prohibido verificar (máx. 30 símbolos, máx. concurrencia 8, sin
explorar más). Ver más abajo.

---

## PARTE D — Robustez

### D.1 — ¿Qué pasa si Yahoo devuelve 429 a mitad de una corrida larga?

**Hoy: el símbolo se pierde, no se reintenta, y el escaneo no se aborta.**

En el scan batch materializado (`runMaterializedScan` /
`analyzeOne`, [lib/materializedScanner.js:1319-1341](../lib/materializedScanner.js)):

```js
async function analyzeOne(symbol, benchmarks, options = {}) {
  let profile = {};
  try {
    const [chartResult, profileResult] = await Promise.allSettled([
      fetchChartForScan(symbol, options),
      fetchProfileForScan(symbol, options),
    ]);
    profile = profileResult.status === "fulfilled" ? profileResult.value : {};
    if (chartResult.status === "rejected") throw chartResult.reason;
    // ...
  } catch (error) {
    return {
      symbol,
      // ...
      ok: false,
      rejection: error.message || "scan failed",
    };
  }
}
```

Llamado dentro de `mapLimit(resolved.symbols, concurrency, (symbol) =>
analyzeOne(...))` en
[lib/materializedScanner.js:1680](../lib/materializedScanner.js). Un 429
en `fetchChartForScan` hace que `Promise.allSettled` capture el rechazo,
`analyzeOne` retorna `{ ok: false, rejection: "Yahoo chart HTTP 429..." }`
— y el `mapLimit` interno ([lib/materializedScanner.js:662-673](../lib/materializedScanner.js))
simplemente sigue con el siguiente símbolo del array:

```js
async function mapLimit(items = [], limit = DEFAULT_CONCURRENCY, worker) {
  const out = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      out[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length || 1) }, run));
  return out;
}
```

En la práctica: **el símbolo queda marcado como rechazado (`ok: false`)
para esa corrida**, no hay reintento (ni inmediato ni con backoff), y el
resto del universo se sigue procesando sin abortar. Si Yahoo empezara a
devolver 429 de forma sostenida a mitad de una corrida larga (algo que
este benchmark no reprodujo — nunca vimos un 429), el comportamiento
esperado por este código sería: cada símbolo restante falla individualmente
uno tras otro, sin pausa ni backoff entre ellos, hasta agotar el universo
o el timeout de la función. La clasificación como `retryable` en
`lib/scanErrors.js` solo alimenta telemetría (`state.kindBreakdown`), no
dispara ningún mecanismo de reintento real.

### D.2 — Qué haría falta para que un escaneo largo sea robusto frente a limitación del proveedor (enumeración, no implementación)

1. **Backoff y reintento real sobre errores `retryable`** (429/5xx) en
   `analyzeOne`/`fetchChartForScan`, usando la clasificación que ya existe
   en `lib/scanErrors.js` pero que hoy no dispara nada.
2. **Circuit breaker / pausa global**: si el ratio de 429 en una ventana
   reciente supera un umbral, pausar todo el pool de `mapLimit` (no solo el
   símbolo afectado) durante un tiempo antes de seguir, para no seguir
   golpeando un proveedor que ya está limitando.
3. **Persistencia de progreso / reanudación**: si el job de GitHub Actions
   se corta a mitad de camino (timeout de 6h, error no controlado), poder
   reanudar desde el símbolo donde quedó en vez de reprocesar desde cero.
4. **Reducción dinámica de concurrencia**: bajar la concurrencia
   automáticamente si empiezan a aparecer 429/5xx, en vez de mantenerla fija
   durante toda la corrida.
5. **Cola de reintentos diferidos**: los símbolos que fallaron por error
   `retryable` deberían quedar en una cola aparte para un segundo pase al
   final de la corrida (o en la siguiente), en vez de perderse
   definitivamente esa noche.
6. **Alertas/observabilidad**: notificación si el ratio de errores
   `retryable` supera un umbral durante una corrida en producción, para que
   un humano decida si hay que bajar la concurrencia manualmente.
7. **Fallback explícito documentado**: hoy `fetchYahooChart` ya cae a
   Stooq/Alpha Vantage en caso de fallo de Yahoo — pero ese fallback no está
   caracterizado bajo carga (¿aguanta el mismo volumen? ¿tiene sus propios
   límites?). Habría que medirlo por separado antes de confiar en él como
   red de seguridad para un escaneo completo.

Ninguno de estos puntos se implementó en esta tarea — están fuera de su
alcance (solo se permitía crear el script de bench y este documento).

---

## CONFIANZA

- **Alta**: los 5 números de rendimiento total (14.61 / 20.42 / 31.55 /
  35.17 / 41.15 símb/s) son mediciones directas y reales contra
  `query1.finance.yahoo.com`, con la función real de producción
  (`fetchYahooChart` vía `lib/marketData.js`), caché desactivada, 0 errores
  en 150 peticiones totales.
- **Alta**: la lectura del código de manejo de errores (Parte A y D.1) —
  citada línea por línea, no hay ambigüedad en que hoy no hay retry ni
  backoff real.
- **Media**: los cálculos de "cuántos símbolos caben en 6h" (Parte C) son
  extrapolaciones lineales desde ráfagas de 0,7-2 segundos de duración. Son
  aritmética simple sobre datos reales, pero **no** una medición de
  comportamiento sostenido.
- **Baja / no verificado**: si Yahoo tiene algún límite de tasa que solo se
  activa tras volumen sostenido (minutos u horas, miles de peticiones), no
  cruzado por esta tarea por diseño explícito de la propia tarea.

## LO QUE NO HE VERIFICADO

- **Comportamiento bajo carga sostenida.** Cada corrida duró menos de 2.1
  segundos. No hay ninguna medición de qué pasa si se mantiene concurrencia
  8 durante minutos u horas, que es justamente el escenario real de un
  escaneo de miles de símbolos en GitHub Actions. Es plausible que Yahoo
  limite por volumen acumulado en una ventana de tiempo, no solo por
  peticiones simultáneas — este bench no puede distinguir ambos casos.
- **Niveles de concurrencia por encima de 8.** Prohibido explícitamente por
  la tarea. No hay ningún dato sobre 10, 16, 32, etc.
- **Comportamiento del pool de fallback (Stooq, Alpha Vantage) bajo carga.**
  No se disparó ningún fallback en estas 150 peticiones (0 fallos), así que
  no hay datos de su rendimiento ni de sus propios límites.
- **Variabilidad por hora del día / carga de Yahoo.** Las 5 corridas se
  hicieron en una ventana de ~7 minutos, un único momento del día. No se
  puede descartar que Yahoo se comporte distinto en otros horarios (mayor
  tráfico global, mantenimiento, etc.).
- **Si la IP desde la que se ejecutó este bench tiene algún historial previo
  con Yahoo** que pudiera hacerla más o menos propensa a un bloqueo que la
  IP real de un runner de GitHub Actions (que cambia en cada ejecución).
- **El comportamiento de `analyzeOne` con 429 real en producción** — el
  análisis de Parte D.1 es lectura de código, no una reproducción real de
  un 429 en el pipeline completo (esta tarea nunca disparó un 429).

**Decisión que queda pendiente, tal como pedía la tarea**: cualquier
concurrencia por encima de 8 requiere una medición nueva, deliberada y
aprobada por un humano — este documento no la recomienda ni la descarta.
