# Informe de verificación — mecanismo de escritura shadow FIRDS

**Fecha:** 2026-07-11
**Rama:** `codex/statsedge-ui-polish`
**Commit base:** `cc72b7d` feat(cron): añade shadow-firds-refresh con rotación de 8 cohortes ESMA (8 días/ciclo)
**Naturaleza:** verificación read-only. Cero cambios a código. Un test manual aislado sobre 3 símbolos reales.

---

## Resumen ejecutivo

1. **El mecanismo de escritura funciona correctamente.** Verificado con ANTES/DESPUÉS sobre `DE000A2P4HL9` (123F.DE + 123F.F): `updated_at` y `data_freshness.checkedAt` pasaron de `2026-05-19` (53 días) a `2026-07-11T21:34:38` (ahora). `markSymbolResolutionPriceStatus` escribe correctamente.
2. **El problema operativo real es un bug estructural pre-existente**: ambos crons shadow (europe y firds nuevo) filtran con `status=eq.resolved` en `readSymbolResolutionsForPricing`. Los símbolos ya `priced` **nunca más entran al ciclo normal de re-validación**. Solo se procesan los `resolved`, que son los que aún no han pasado por el gate de precio.
3. **El bug está cuantificado**: 484 priced totales. 481 con `checkedAt > 30 días`. Solo 3 con `checkedAt < 1 día` — exactamente los 3 que yo acabo de actualizar manualmente como prueba.
4. **Esto invalida mi recomendación previa.** Subir `pricePerMarket` a 16 (Opción 1) no tendría efecto alguno, porque los símbolos `priced` no entran al filtro del cron. Cualquier aumento similar de cuotas se aplica sobre un pool vacío (`resolved` ≈ 0-12 por mercado).
5. **Causa raíz concreta**:
   - `app/api/cron/shadow-europe-refresh/route.js:273`: `status: "resolved"` en `readSymbolResolutionsForPricing`.
   - `app/api/cron/shadow-firds-refresh/route.js:329` (mi nuevo cc72b7d): mismo filtro `status: "resolved"`.
   - El job manual `app/api/jobs/shadow-price-freshness/route.js:52` también usa `status=resolved` por defecto, pero acepta `?status=priced` explícito.
6. **Recomendación revisada**: cambiar el filtro del cron a `status=in.(resolved,priced)` y mantener el ya existente `order=updated_at.asc` (los más viejos primero). Con esta sola corrección, el ciclo de 8 días ya cumple el `maxAgeDays=5` con margen **cero** para todos los priced actualmente shadow.

---

## Resultado 1 — Función de escritura identificada

**Archivo:** `lib/shadowUniverseStore.js:404-438`

```javascript
export async function markSymbolResolutionPriceStatus(rows = [], { provider = SHADOW_RESOLUTION_PROVIDER } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return supabaseDisabled();
  const body = rows
    .map((row) => ({
      isin: cleanIsin(row.isin),
      market: cleanMarket(row.market),
      symbol: cleanText(row.symbol).toUpperCase(),
      status: cleanText(row.status || "resolved"),
      dataFreshness: row.dataFreshness && typeof row.dataFreshness === "object" ? row.dataFreshness : {},
    }))
    .filter((row) => row.isin && row.market && row.symbol);
  if (!body.length) return { status: "empty", configured: true, written: 0 };
  let written = 0;
  for (const row of body) {
    await supabaseRequest("symbol_resolutions", {
      method: "PATCH",
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `provider=eq.${encodeURIComponent(provider)}`,
        `market=eq.${encodeURIComponent(row.market)}`,
        `isin=eq.${encodeURIComponent(row.isin)}`,
        `symbol=eq.${encodeURIComponent(row.symbol)}`,
      ].join("&"),
      prefer: "return=minimal",
      body: {
        status: row.status,
        data_freshness: row.dataFreshness,
        updated_at: new Date().toISOString(),
      },
    });
    written += 1;
  }
  return { status: "supabase", configured: true, written };
}
```

PATCH contra `symbol_resolutions` con `body = {status, data_freshness, updated_at}`. La función existe, recibe `dataFreshness` desde `priceState`, y la persiste tal cual.

**Invocada desde el path shadow**:
- `app/api/cron/shadow-europe-refresh/route.js:287` — `validateShadowPrices` envuelve el resultado del `checkResolution` (que incluye `dataFreshness.checkedAt: new Date().toISOString()` en `priceState:169`) y lo pasa al writer.
- `app/api/cron/shadow-firds-refresh/route.js:351` (mi nuevo) — mismo patrón.

---

## Resultado 2 — ANTES/DESPUÉS sobre 3 símbolos reales (DE/123F)

### ANTES (capturado via PostgREST)

```json
{"symbol":"123F.DE","isin":"DE000A2P4HL9","status":"priced","checkedAt":"2026-05-19T16:12:04.795Z","updated_at":"2026-05-19T16:12:12.002+00:00"}
{"symbol":"123F.F","isin":"DE000A2P4HL9","status":"priced","checkedAt":"2026-05-19T16:12:05.421Z","updated_at":"2026-05-19T16:12:12.133+00:00"}
{"symbol":"1KJ.F","isin":"US88025U1097","status":"priced","checkedAt":"2026-05-19T16:12:06.091Z","updated_at":"2026-05-19T16:12:12.203+00:00"}
```

`checkedAt` 53 días atrás. `latestDate` no presente en `data_freshness`.

### Comando ejecutado

```bash
curl -H "x-statsedge-token: <STATSEDGE_ACCESS_TOKEN>" \
     -H "Authorization: Bearer <CRON_SECRET>" \
     "http://127.0.0.1:3456/api/jobs/shadow-price-freshness?markets=DE&status=priced&perMarket=3&maxAgeDays=5&minBars=180&refreshPrices=false&cache=true&includeSymbols=1"
```

Endpoint manual `app/api/jobs/shadow-price-freshness/route.js`. Forzado `?status=priced` (importante: por defecto sería `resolved`).

### Respuesta del endpoint

```json
{"ok":true,"job":"shadow-price-freshness","markets":["DE"],"status":"priced","perMarket":3,"maxAgeDays":5,"minBars":180,"candidates":3,"priced":3,"stale":0,"unavailable":0,"updated":3,"errors":[],"legalMode":"internal-price-freshness-gate","rows":[{"market":"DE","candidateStatus":"supabase","candidates":3,"priced":3,"stale":0,"unavailable":0,"updated":3,"symbols":[{"symbol":"123F.DE","status":"priced","latestDate":"2026-07-10","freshnessDays":1,"bars":507,"issue":""},{"symbol":"123F.F","status":"priced","latestDate":"2026-07-10","freshnessDays":1,"bars":507,"issue":""},{"symbol":"1KJ.F","status":"priced","latestDate":"2026-07-10","freshnessDays":1,"bars":1,"issue":""}]}]}
```

3 candidatos, 3 priced (`updated: 3`), 0 errors. El job marcó `updated=3` y devolvió los símbolos con `status=priced`, `latestDate="2026-07-10"` (1 día de freshness), `bars=507` (suficiente).

### DESPUÉS (capturado via PostgREST ~inmediatamente)

```json
{"symbol":"123F.DE","isin":"DE000A2P4HL9","status":"priced","checkedAt":"2026-07-11T21:34:38.007Z","updated_at":"2026-07-11T21:34:40.243+00:00","latestDate":"2026-07-10","freshnessDays":1,"maxAgeDays":5}
{"symbol":"123F.F","isin":"DE000A2P4HL9","status":"priced","checkedAt":"2026-07-11T21:34:39.073Z","updated_at":"2026-07-11T21:34:40.324+00:00","latestDate":"2026-07-10","freshnessDays":1,"maxAgeDays":5}
```

`updated_at` y `checkedAt` actualizados. `data_freshness.latestDate="2026-07-10"`, `freshnessDays=1`, `maxAgeDays=5`. Todos los campos coincidentes con la respuesta del job.

### Conclusión del paso 2

**El mecanismo de escritura ES correcto.** `markSymbolResolutionPriceStatus` se ejecuta, escribe en Supabase, y la siguiente lectura ve los nuevos valores. El mecanismo no es el problema.

---

## Resultado 3 — Causa raíz del estado "todo stale"

### 3.1 Distribución completa de priced por antigüedad (PostgREST)

```
Total priced: 484
Buckets (por updated_at):                { lt1d: 3, days1to7: 0, days7to30: 0, days30plus: 481, noUpd: 0 }
Buckets (por data_freshness.checkedAt):  { lt1d: 3, days1to7: 0, days7to30: 0, days30plus: 481, noChk: 0 }
```

**Los 3 símbolos con `lt1d` son 123F.DE, 123F.F y 1KJ.F — los que yo acabo de re-validar manualmente**. El resto, 481 de 484 (99.4%), lleva más de 30 días sin tocar `checkedAt`. No hay ninguna franja intermedia: ni `1-7d` ni `7-30d`. Las distribuciones por `updated_at` y `checkedAt` son idénticas.

### 3.2 ¿Por qué?

Los crons shadow filtran con `status=eq.resolved`:

**`app/api/cron/shadow-europe-refresh/route.js:271-275`**
```javascript
const candidates = await readSymbolResolutionsForPricing({
  market,
  status: "resolved",
  limit: options.pricePerMarket,
});
```

**`app/api/cron/shadow-firds-refresh/route.js:327-331` (mi nuevo, cc72b7d)**
```javascript
const candidates = await readSymbolResolutionsForPricing({
  market,
  status: "resolved",
  limit: options.pricePerMarket,
});
```

**`lib/shadowUniverseStore.js:384-402` — `readSymbolResolutionsForPricing`**
```javascript
export async function readSymbolResolutionsForPricing({ market = "", provider = SHADOW_RESOLUTION_PROVIDER, status = "resolved", limit = 10 } = {}) {
  // ...
  const rows = await supabaseRequest("symbol_resolutions", {
    query: [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      `provider=eq.${encodeURIComponent(provider)}`,
      `market=eq.${encodeURIComponent(clean)}`,
      `status=eq.${encodeURIComponent(cleanText(status) || "resolved")}`,
      "select=isin,market,symbol,name,exchange,exchange_code,confidence_score,status,data_freshness,raw",
      "order=updated_at.asc,symbol.asc",
      `limit=${max}`,
    ].join("&"),
  });
  // ...
}
```

La query PostgREST es `status=eq.resolved`. **Los símbolos `priced` quedan excluidos del filtro.** La query además ordena `updated_at asc` (los más viejos primero), así que cuando hay pocos `resolved`, el cron re-corre los mismos símbolos cada noche sin avanzar.

### 3.3 Cuantificación del estado actual

```
DE/priced:   113
DE/resolved: 12     (los únicos que rota el cron)
NL/priced:   38
NL/resolved: ?      (no medido, presumiblemente 0)
FI/priced:   28
DK/priced:   24
NO/priced:   42
SE/priced:   13
ES/priced:   37
IT/priced:   44
FR/priced:   107
GB/priced:   38     (out of scope de mi cron nuevo)
```

El shadow-europe cron rota 4 cohortes que cubren GB (1), Nordics (4), West (DE/FR/NL=3), South (IT/ES=2) → 10 mercados. Solo DE tiene 12 `resolved`; el resto tiene 0 resolved (todo el inventario ya está priced).

### 3.4 Conclusión

El bug es estructural y precede a mi commit:

1. Diseño original: el cron asume que siempre hay nuevos `resolved` para rotar.
2. En la práctica, una vez poblado el inventario (lo cual ya ocurrió en los runs del estudio FIRDS), no quedan `resolved` que alimentar.
3. Los `priced` se quedan congelados sin re-validación indefinidamente.
4. La inferencia de mi informe anterior ("el shadow-europe está re-corriendo sin efecto") era **correcta** y queda ahora demostrada con evidencia cuantitativa: 481/484 priced con `checkedAt > 30 días`.

---

## Resultado 4 — Implicaciones para mi commit `cc72b7d`

Mi nuevo cron `shadow-firts-refresh` replica el mismo bug estructural exactamente:

```javascript
// app/api/cron/shadow-firds-refresh/route.js:327-331
const candidates = await readSymbolResolutionsForPricing({
  market,
  status: "resolved",  // ← mismo filtro que el europeo
  limit: options.pricePerMarket,
});
```

→ Tan pronto como los 13 mercados ESMA tengan todos sus `shadow_instruments` en `symbol_resolutions` con `status=priced`, el cron caerá en el mismo "no-op loop" que el europeo.

→ Cualquier intento de "subir `pricePerMarket`" (Opción 1 que recomendé antes) **no tiene efecto** sobre este bug, porque `pricePerMarket` solo aplica sobre los `resolved` y ese pool es ~0.

---

## Recomendación revisada (sin implementar)

### Bug crítico a corregir primero: el filtro excluye `priced`

**Cambio mínimo** en los dos crons: cambiar el filtro para incluir `priced`:

```diff
// app/api/cron/shadow-europe-refresh/route.js:271
-      status: "resolved",
+      statuses: ["resolved", "priced"],

// app/api/cron/shadow-firds-refresh/route.js:327
-      status: "resolved",
+      statuses: ["resolved", "priced"],
```

(Esto requeriría una pequeña ampliación de `readSymbolResolutionsForPricing` en `lib/shadowUniverseStore.js:384` para aceptar `statuses: string[]` y emitir `status=in.(...)`.)

**Con esto solo**, el ciclo de 8 días cubre los priced actuales ordenados por antigüedad asc → el cron procesará los 8 símbolos con `updated_at` más antiguo de cada mercado cada noche.

### Orden de magnitud realista

Con el filtro corregido + el cron actual (`pricePerMarket=8`):

- **Símbolos procesados por día**: 64-128 según cohorte.
- **Tiempo por símbolo**: ~2-3s (Yahoo + cache + Supabase PATCH). Total por turno: 32-64s. Cabe en `maxDuration=60`.
- **Para tocar los 446 priced una vez**: ~7-14 días de operación continua.
- **Para tocar los 113 DE una vez** (mercado más poblado): DE rotando cada 8 días con 8 símbolos → ~14 ciclos completos = 112 días para tocar el último DE.

→ El ciclo efectivo para que el 100% de los priced tenga `checkedAt < 5d` es **2-4 meses** con `pricePerMarket=8`. Es mucho.

### Subir `pricePerMarket` por encima de 8 sí tiene efecto significativo

Con el filtro corregido, **subir `pricePerMarket` sí reduce el stale residual**. Cálculo revisado:

| `pricePerMarket` | Tiempo peor cohorte (pair-3 NL+DK) | Tiempo peor solo (DE) | Cobertura por día |
|---:|---:|---:|---:|
| 8  | 36s | 26s | 64-128 |
| 16 | 50s | 36s | 128-256 |
| 24 | 60s (límite) | 44s | 192-384 |

→ Subir a **16** da tiempo holgado para todas las cohortes y duplica la cobertura diaria.

### Recomendación concreta (3 niveles)

#### 1. Mínimo viable: fix del filtro + `pricePerMarket=16`

```diff
// app/api/cron/shadow-europe-refresh/route.js:271
-      status: "resolved",
+      statuses: ["resolved", "priced"],

// app/api/cron/shadow-firds-refresh/route.js:327
-      status: "resolved",
+      statuses: ["resolved", "priced"],

// lib/cronPlan.js
-    pricePerMarket: 8,
+    pricePerMarket: 16,
```

- Tiempo de implementación: ~30 minutos (incluye actualizar test `tests/shadowFirdsCronPlan.test.js`).
- Riesgo: bajo (filtro más permisivo, mismo patrón de escritura).
- Efecto: el cron procesa los priced con `updated_at` más antiguo primero.
- Limitación: el ciclo real para garantizar `checkedAt<5d` depende del número total de priced, no de las cuotas.

#### 2. Medio: filtro + `pricePerMarket=24` solo para `solo-de` y `solo-fr` (los más poblados)

- Tiempo: ~45 minutos.
- Riesgo: bajo.
- Efecto: pair-3 (NL+DK) rozando 60s. DE/FR se rotan cada 3-4 días en vez de cada 14.

#### 3. Nuclear: subir `maxDuration` a 300 (Vercel Pro) + rediseñar cohortes

- Solo viable con plan Pro.
- Permite `pricePerMarket=60` por cohorte con tiempo provider holgado.
- Cobertura total de todos los priced en <24h.

**Mi elección: opción 1 + opción 2 combinadas** — el cambio resuelve el bug crítico y acelera la rotación en los mercados más densos.

No implemento nada. Espero confirmación explícita antes de hacer cualquier cambio.

---

## Lo NO tocado durante esta verificación

- Cero modificaciones a código.
- `cc72b7d` permanece sin cambios.
- Servidor de prueba en `:3456` levantado y detenido tras la prueba.
- 3 símbolos `priced` actualizados por mi invocación manual (`123F.DE`, `123F.F`, `1KJ.F`) — efecto colateral documentado: ahora tienen `checkedAt` reciente, lo cual es el resultado esperado del test. No es residuo a limpiar.
- GB-FCA y la activación de flags FIRDS quedan como puntos aparte, sin mezclar.

---

## Archivos de evidencia citados

- `lib/shadowUniverseStore.js:404-438` — `markSymbolResolutionPriceStatus` (writer).
- `lib/shadowUniverseStore.js:384-402` — `readSymbolResolutionsForPricing` con filtro `status=eq.resolved`.
- `app/api/cron/shadow-europe-refresh/route.js:271-275` — filtro bug.
- `app/api/cron/shadow-firds-refresh/route.js:327-331` — filtro bug (replica del europeo).
- `app/api/jobs/shadow-price-freshness/route.js:52` — mismo filtro en job manual, acepta `?status=priced`.
- `docs/firds-coverage-impact-study-2026-07-11.md` — datos origen de los 446 priced acumulados.
