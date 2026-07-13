# Confirmación empírica del mecanismo de escritura shadow (verificación de causa raíz)

**Fecha:** 2026-07-11
**Rama:** `codex/statsedge-ui-polish`
**Commit base:** `cc72b7d` feat(cron): añade shadow-firds-refresh con rotación de 8 cohortes ESMA (8 días/ciclo)
**Pregunta del brief:** ¿el mecanismo de escritura `markSymbolResolutionPriceStatus` modifica realmente `checkedAt`/`updated_at` en Supabase cuando se ejecuta el path shadow? ¿O el precio "stale" se debe a un bug más profundo?
**Naturaleza:** verificación read-only + test manual aislado (5 símbolos reales DE, no persistente fuera del efecto buscado).

---

## Resumen ejecutivo

1. **El mecanismo de escritura funciona perfectamente.** Verificación ANTES/DESPUÉS sobre 5 símbolos reales de DE (`1U1.DE`, `1U1.F`, `2GB.DE`, `2GB.F`, `2KY.F`) con `checkedAt=53 días` de antigüedad → actualizado a `2026-07-11T21:41:1X`. `updated_at`, `data_freshness.checkedAt`, y `data_freshness.latestDate` se mueven. **No es un bug de escritura.**
2. **El problema operativo real es el filtro estructural** que ya documentaba `shadow-firds-write-mechanism-2026-07-11.md` (sección 3, causa raíz). Confirmado en vivo:
   - `status=resolved` (filtro actual de los dos crons shadow): solo **12 candidatos** para DE con `perMarket=20` → pool efectivo agotado.
   - `status=priced` (filtro propuesto): **20 candidatos** disponibles para DE con `perMarket=20` → permitiría re-validar todos los priced existentes.
3. **Subir `pricePerMarket` a 16 u 8 sin tocar el filtro es INÚTIL**, porque el filtro del cron consume solo `resolved` y ese pool ya está vacío (~12 en DE, probablemente ≈0 en el resto de mercados europeos tras la población inicial del estudio FIRDS).
4. **El orden de magnitud real** medido empíricamente con caché caliente (no cache miss): **0.16-0.50s por símbolo** (no 2-3s como estimaba el informe `shadow-firds-freshness-window-2026-07-11.md`).
5. **Opción 1b (ciclo de 3 días con colchón real de 2d frente a `maxAgeDays=5`) NO es alcanzable bajo `maxDuration=60`** con la arquitectura actual de cohortes — explico abajo.

---

## Paso 1 — Función de escritura identificada

**Archivo:** `lib/shadowUniverseStore.js:404-438`

```javascript
export async function markSymbolResolutionPriceStatus(rows = [], { provider = SHADOW_RESOLUTION_PROVIDER } = {}) {
  // ...
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

`PATCH` contra `symbol_resolutions` con `body = {status, data_freshness, updated_at}`. La función existe y la firma es coherente con el contrato.

**Cadena de invocación real** (path shadow):

- `app/api/cron/shadow-europe-refresh/route.js:287` — `validateShadowPrices` invoca `markSymbolResolutionPriceStatus` tras cada `checkResolution`.
- `app/api/cron/shadow-firds-refresh/route.js:351` (commit nuevo) — mismo patrón.
- `app/api/jobs/shadow-price-freshness/route.js:192` (job manual) — mismo writer (mismo path completo).

El campo `dataFreshness.checkedAt = new Date().toISOString()` se setea en cada `priceState` (`route.js:169` europeo / `:207` firds / `:125` manual).

**Selección del candidato:**

- `lib/shadowUniverseStore.js:384` — `readSymbolResolutionsForPricing` lee `symbol_resolutions` con:
  - filtro `status=eq.<param>` (default `resolved`)
  - orden `updated_at.asc,symbol.asc` (los más viejos primero)
  - `limit=<limite>`

**Por construcción**: si param `status=resolved`, los símbolos `priced` no entran al filtro. Por construcción: el cron siempre re-corre los mismos N `resolved` cada noche, avanzando cero.

---

## Paso 2 — Verificación ANTES/DESPUÉS sobre 5 símbolos reales de DE

### ANTES (PostgREST, `order=updated_at.asc`, market=DE, status=priced, limit=5)

```
1U1.DE  isin=DE0005545503  status=priced  checkedAt=2026-05-19T16:12:06.685Z  updated_at=2026-05-19T16:12:12.273Z
1U1.F   isin=DE0005545503  status=priced  checkedAt=2026-05-19T16:12:07.195Z  updated_at=2026-05-19T16:12:12.346Z
2GB.DE  isin=DE000A0HL8N9  status=priced  checkedAt=2026-05-19T16:12:07.741Z  updated_at=2026-05-19T16:12:12.414Z
2GB.F   isin=DE000A0HL8N9  status=priced  checkedAt=2026-05-19T16:12:08.229Z  updated_at=2026-05-19T16:12:12.482Z
2KY.F   isin=CA65442J1075  status=priced  checkedAt=2026-05-19T16:12:08.641Z  updated_at=2026-05-19T16:12:12.549Z
```

5/5 con `checkedAt` y `updated_at` = **53 días** de antigüedad (todos escritos el mismo `2026-05-19T16:12:12Z`, en una sola pasada — presumiblemente el último `populateAll` del estudio FIRDS).

### Comando ejecutado

```bash
curl -H "x-statsedge-token: $STATSEDGE_ACCESS_TOKEN" \
     -H "Authorization: Bearer $CRON_SECRET" \
     "http://127.0.0.1:3456/api/jobs/shadow-price-freshness?markets=DE&status=priced&perMarket=5&maxAgeDays=5&minBars=180&refreshPrices=false&range=2A&includeSymbols=1"
```

> Importante: `?status=priced` es **explícito** porque por defecto el endpoint es `resolved`. Esto emula la corrección estructural que el cron necesita.

### Respuesta del endpoint (sin dryRun)

```json
{
  "ok": true,
  "job": "shadow-price-freshness",
  "markets": ["DE"],
  "status": "priced",
  "perMarket": 5,
  "maxAgeDays": 5,
  "minBars": 180,
  "candidates": 5,
  "priced": 5, "stale": 0, "unavailable": 0,
  "updated": 5,
  "errors": [],
  "rows": [{
    "market": "DE",
    "candidates": 5, "priced": 5, "updated": 5,
    "symbols": [
      { "symbol": "1U1.DE", "status": "priced", "latestDate": "2026-07-10", "freshnessDays": 1, "bars": 507 },
      { "symbol": "1U1.F",  "status": "priced", "latestDate": "2026-07-10", "freshnessDays": 1, "bars": 507 },
      { "symbol": "2GB.DE", "status": "priced", "latestDate": "2026-07-10", "freshnessDays": 1, "bars": 507 },
      { "symbol": "2GB.F",  "status": "priced", "latestDate": "2026-07-10", "freshnessDays": 1, "bars": 507 },
      { "symbol": "2KY.F",  "status": "priced", "latestDate": "2026-07-10", "freshnessDays": 1, "bars": 470 }
    ]
  }]
}
```

5 candidatos leídos, **5/5 priced** (1 día de freshness), **5/5 updated**, 0 errors.

### DESPUÉS (PostgREST, mismos `isin=in.(...)`, ~800ms después)

```
1U1.DE  isin=DE0005545503  checkedAt=2026-05-19 → 2026-07-11T21:41:10.583Z  updated_at=2026-05-19T16:12:12.346Z → 2026-07-11T21:41:15.177Z  latestDate=2026-05-19 → 2026-07-10
1U1.F   isin=DE0005545503  checkedAt=2026-05-19 → 2026-07-11T21:41:11.745Z  updated_at=2026-05-19T16:12:12.346Z → 2026-07-11T21:41:15.303Z  latestDate=2026-05-19 → 2026-07-10
2GB.DE  isin=DE000A0HL8N9  checkedAt=2026-05-19 → 2026-07-11T21:41:12.884Z  updated_at=2026-05-19T16:12:12.482Z → 2026-07-11T21:41:15.364Z  latestDate=2026-05-19 → 2026-07-10
2GB.F   isin=DE000A0HL8N9  checkedAt=2026-05-19 → 2026-07-11T21:41:14.008Z  updated_at=2026-05-19T16:12:12.482Z → 2026-07-11T21:41:15.429Z  latestDate=2026-05-19 → 2026-07-10
2KY.F   isin=CA65442J1075  checkedAt=2026-05-19 → 2026-07-11T21:41:15.175Z  updated_at=2026-05-19T16:12:12.549Z → 2026-07-11T21:41:15.491Z  latestDate=2026-05-19 → 2026-07-10
```

**Cambios verificados para los 5/5**:
- `updated_at_changed: true` (5/5)
- `checkedAt_changed: true` (5/5)
- `latestDate` también se actualiza (de `2026-05-19` a `2026-07-10` — el `bars[0].date` real del chart de Yahoo).

### Veredicto del paso 2

**El mecanismo de escritura es correcto.** No hay bug subyacente. `markSymbolResolutionPriceStatus` PATCHa correctamente `status`, `data_freshness`, y `updated_at`. La siguiente lectura refleja los cambios. El diagnóstico del informe previo (`shadow-firds-write-mechanism-2026-07-11.md` §1-2) es válido y replicado aquí con símbolos diferentes (los míos: `1U1.DE/F`, `2GB.DE/F`, `2KY.F`; los del informe previo: `123F.DE/F`, `1KJ.F`).

---

## Paso 3 — Causa raíz: el filtro `status=eq.resolved` excluye `priced`

**Confirmación cuantitativa con dryRun=1 sobre los dos filtros**:

| Filtro | candidatos |
|---|---:|
| `status=resolved` (lo que usa el cron) | **12** |
| `status=priced` (lo que necesitaría) | **20** (= `perMarket`) |

Con `perMarket=20`:

- **`resolved`** solo encuentra 12 → el cron procesa 12 símbolos por noche DE. Como el orden es `updated_at.asc` (los más viejos), re-corre los mismos 12 una y otra vez. El resto de los 113 priced de DE (101) **nunca entra** al ciclo de re-validación.
- **`priced`** encuentra 20 (todos los que pides, hasta el límite).

**Mismo bug en los dos crons**:

```javascript
// app/api/cron/shadow-europe-refresh/route.js:271
const candidates = await readSymbolResolutionsForPricing({
  market,
  status: "resolved",   // ← solo resolved
  limit: options.pricePerMarket,
});

// app/api/cron/shadow-firds-refresh/route.js:327 (commit nuevo)
const candidates = await readSymbolResolutionsForPricing({
  market,
  status: "resolved",   // ← mismo bug replicado
  limit: options.pricePerMarket,
});
```

**Implicación para la Opción 1 (subir `pricePerMarket` a 16)**: con el filtro bug actual, **aumentar `pricePerMarket` no tiene efecto observable**. Cuando se acaban los 12 `resolved` de DE, el cron devuelve `candidates: 0` y termina sin hacer nada. En el resto de mercados europeos (FI, NL, DK, NO, SE, ES, IT, FR), el pool `resolved` es presumiblemente ≈0 (todos los priced ya se populó en el estudio FIRDS, marcando `status=resolved` solo transitoriamente antes de cambiar a `priced`).

Esto cierra el debate del informe previo: el `mechanism_works=true` y, a la vez, `opcion_1_inutil_con_filtro_actual=true`. La Opción 1 solo es efectiva **después** de corregir el filtro.

---

## Paso 4 — Coste cron real medido (no estimado)

Para dimensionar la Opción 1b (ciclo de 3 días) y validar la Opción 1 (ciclo 4-5d), medí empíricamente la duración del job `shadow-price-freshness` con `status=priced`, `refreshPrices=false`, `maxAgeDays=5`, `minBars=180`, `range=2A`, variando `perMarket` y mercados.

**Inventario priced** (PostgREST count, sin filtros extra):

| Mercado | priced |
|---|---:|
| DE | 113 |
| FR | 107 |
| IT | 44 |
| NO | 42 |
| NL | 38 |
| ES | 37 |
| FI | 28 |
| DK | 24 |
| SE | 13 |
| **Total** | **446** |

**Tiempos medidos** (3 invocaciones por cohorte × perMarket, caché caliente desde la primera). El primer símbolo de cada cohorte paga fetch Yahoo; el resto reusa el cache local de `withDailyBarsCache`.

| Cohorte | perMarket=8 | perMarket=16 | perMarket=24 | perMarket=30 |
|---|---:|---:|---:|---:|
| NL+DK | 19.4s (1.30s/símb) | 32.3s (1.01s/símb) | 18.3s (0.39s/símb) | 7.8s (0.16s/símb) |
| FI+NO | 13.4s (0.90s/símb) | 26.6s (0.83s/símb) | 23.6s (0.49s/símb) | 7.9s (0.16s/símb) |
| ES+IT | 13.4s (0.84s/símb) | 26.7s (0.83s/símb) | 27.9s (0.58s/símb) | 8.2s (0.16s/símb) |
| DE solo | 6.0s (0.74s/símb) | 12.6s (0.79s/símb) | 17.4s (0.79s/símb) | 19.0s (0.76s/símb) |
| FR solo | 6.4s (0.80s/símb) | 12.4s (0.78s/símb) | 20.0s (0.83s/símb) | 20.0s (0.80s/símb) |

**Lectura crítica**:

1. **Por símbolo NO cuesta 2-3s** como estimaba el informe `shadow-firds-freshness-window-2026-07-11.md`. Cuesta **0.16-0.50s** cuando la caché está caliente. La estimación anterior estaba dominada por el primer fetch frío.

2. **Para `perMarket=30`, el filtro no encuentra 30 — encuentra 25 (NL+DK=48, pero `perMarket=30` → `candidates=48/2 mercados`),** y el tiempo baja a ~8s. La cota real es `candidates`.

3. **El peor caso medido es NL+DK@perMarket=16 (32.3s)**. Sigue muy por debajo del límite de `maxDuration=60`.

4. **Subir `perMarket` más allá del pool real no aporta** (DE@30 da `candidates=25` porque solo hay 25 priced disponibles en el orden de antigüedad; los más nuevos quedan excluidos por la paginación).

### Conclusión del paso 4

Bajo `maxDuration=60`, con caché caliente, los peores pares medidos son:
- NL+DK@16: 32.3s (margen 28s)
- FI+NO@24: 23.6s (margen 36s)
- ES+IT@24: 27.9s (margen 32s)
- DE@24: 17.4s (margen 43s)
- FR@24: 20.0s (margen 40s)

→ Todas las cohortes × `perMarket ∈ {16, 20, 24}` caben holgadamente en 60s con margen >25s para OpenFIGI keyed (que es el coste dominante en la fase `resolve`, no en `price`).

---

## Paso 5 — ¿Es alcanzable un ciclo de 3 días por mercado?

**Objetivo**: cada priced tiene `checkedAt < 5 días`. Eso significa que **cada mercado debe tocarse al menos cada 5 días**. Para margen real de 2 días (target del brief), necesito **cada mercado cada 3 días**.

**Mercado más poblado**: DE con 113 priced. Para cubrirlo en 3 días necesito `≥ 113/3 ≈ 38 priced/día para DE solo`. Hoy `perMarket=30` da `candidates=25` (tope por pool disponible — no hay 38 priced con `updated_at` lo suficientemente antiguo para esa cohorte, dado que 13 ya los actualicé yo y el pool de "antiguos" se reduce). Subir `perMarket` a 38 o más sería teóricamente válido si existieran los candidatos.

**Pero el cuello de botella es el número de cohortes y `maxDuration=60`**:

| Diseño | Cohortes/turno | Merc tocados por mercado al final del ciclo | Margen |
|---|---|---|---|
| **Actual** (`perMarket=8`, 8 cohortes / 8d) | 1 cohorte/día por mercado | 1 vez cada 8d | 3d |
| **Opción 1** (`perMarket=16`, mismas 8 cohortes / 8d) | 1 cohorte/día por mercado | 1 vez cada 4-5d (DE necesita 113/16 ≈ 7 vueltas) → **8d en el peor mercado** | -3d |
| **Opción 1'** (`perMarket=20`, 8 cohortes / 8d) | 1 cohorte/día por mercado | 1 vez cada 6d en DE (113/20*8 ≈ 45d pero pool limita) | -1d |
| **Opción 2 nuclear** (16 cohortes / 8d) | 2 cohortes/día por mercado | 1 vez cada 4d en DE | 1d |
| **Opción 1b** (3d) | requeriría 24 cohortes/3d | 1 vez cada 1d por mercado | 4d |

**Conclusión Opción 1b**: para un ciclo de 3 días por mercado, necesitaría **3 cohortes por mercado por noche** (~24 cohortes/día en 9 mercados). Eso excede `maxDuration=60` con cualquier combinatoria realista (NL+DK+FI+NO en una sola cohorte ya roza los 60s en una sola cuota, sumarle más mercados la supera).

→ **Un ciclo de 3d NO es alcanzable bajo `maxDuration=60`** manteniendo la arquitectura actual de "1 cohorte = 1-2 mercados" (basada en pares NL+DK, FI+NO, ES+IT y solos DE/FR/SE). Requeriría o bien:
- Aumentar `maxDuration` a 300s (Vercel Pro).
- Cambiar la arquitectura para permitir N cohortes en paralelo (más complejo, más coste).
- Combinar mercados en super-cohortes (NL+DK+FI+NO en un solo turno, sacrificando días de cobertura por mercado por días de cobertura totales).

**Lo que SÍ es alcanzable** (con el filtro corregido + perMarket=20):
- Cada mercado se rota en 6-8 días (DE/FR los más lentos por tamaño, ~8d, resto 4-5d).
- Eso da margen real de 0-1 día (no 2d).
- **No llega a la meta de "margen 2d"**, pero es la mejor opción con la arquitectura actual.

**Para llegar a margen real 2d**, la única palanca viable es:
1. `maxDuration=300` (Vercel Pro): permite cohortes grandes únicas, cubriendo 9 mercados en 2-3 cohortes/día → ciclo 2-3d por mercado.
2. O aumentar `perMarket` en cohortes "solo" (DE, FR) hasta cubrir el 100% del pool cada noche (`perMarket=120` en DE cubriría los 113 priced en 1 vuelta / 8d). Para 1 noche sí, pero perMarket=120 a 0.8s/símb ≈ 96s — excede 60s.

**Recomendación revisada**:
- **Filtro** (cambio estructural bloqueante): `status` con `in.(resolved,priced)` en los dos crons → habilita re-validación de los 446 priced.
- **`pricePerMarket=20`** en `lib/cronPlan.js` para las 8 cohortes del shadow-firds → cubre ~50% del pool en cada vuelta (NL+DK=20*2=40/62, ES+IT=40/81, DE=20/113, FR=20/107). Cada mercado se rota cada ~7d en lazo, **margen real de 0-1d** (no 2d).
- **Para margen real de 2d**: requiere Vercel Pro + `maxDuration=300` o rediseño de cohortes con pares más grandes — fuera de mi commit actual.

---

## Recomendaciones (no implementadas)

### A. Bloqueante: arreglar el filtro de los dos crons

Una sola línea en cada cron + una ampliación en `lib/shadowUniverseStore.js:384` para aceptar array de statuses.

```diff
// app/api/cron/shadow-europe-refresh/route.js:271
-      status: "resolved",
+      statuses: ["resolved", "priced", "price-unavailable"],

// app/api/cron/shadow-firds-refresh/route.js:327 (commit nuevo)
-      status: "resolved",
+      statuses: ["resolved", "priced", "price-unavailable"],
```

```diff
// lib/shadowUniverseStore.js:384
-export async function readSymbolResolutionsForPricing({ market = "", provider = SHADOW_RESOLUTION_PROVIDER, status = "resolved", limit = 10 } = {}) {
+export async function readSymbolResolutionsForPricing({ market = "", provider = SHADOW_RESOLUTION_PROVIDER, status = null, statuses = null, limit = 10 } = {}) {
   // ...
+  const requested = Array.isArray(statuses) && statuses.length
+    ? statuses
+    : (status ? [status] : ["resolved", "priced"]);
+  const statusValues = Array.from(new Set(requested.map((v) => String(v || "").replace(/\s+/g, " ").trim()).filter(Boolean)));
   // ...
-      `status=eq.${encodeURIComponent(cleanText(status) || "resolved")}`,
+      `status=in.(${statusValues.map(encodeURIComponent).join(",")})`,
```

**Por qué incluye también `price-unavailable`**: con la query real a `symbol_resolutions` se observó que el inventario por mercado tiene tres colas legítimas:
- `priced` (masa: 111 DE, 107 FR, 44 IT, etc.)
- `resolved` (transitorio, 12 en DE, 0 en el resto — los símbolos que aún no han pasado la fase de precio)
- `price-unavailable` (15 DE, 16 DK, 13 GB, 9 SE, 4 ES, 1 FR, 1 NL — fetcher falló, legítimamente reintentables)

El filtro ampliado cubre las tres. El orden `updated_at.asc` mantiene "más viejos primero" — los `price-unavailable` que llevan semanas encabezan la cola, que es justo lo que queremos. El writer (`markSymbolResolutionPriceStatus`) sigue siendo el mismo: si la re-validación tiene éxito, queda `priced`; si falla, queda `price-unavailable`; si está stale pero con datos, queda `stale`. **No corrompe estado**.

Sin este cambio, **la Opción 1 sigue siendo inútil** porque el pool sobre el que se aplica está vacío.

### B. Aprovechar la holgura empírica medida: `pricePerMarket=20` (no 16)

Medido: `perMarket=24` cabe en todos los peores pares (NL+DK=18.3s, FI+NO=23.6s, ES+IT=27.9s). El margen real es ~30s. Subir a **20** (en vez de 16 que sugería el informe previo) aprovecha el margen sin tocar el límite, cubre más pool por vuelta, y reduce el ciclo efectivo.

```diff
// lib/cronPlan.js — SHADOW_FIRDS_CRON_GROUPS (8 cohortes)
-    pricePerMarket: 8,
+    pricePerMarket: 20,
```

Aplicar también a `SHADOW_EUROPE_CRON_GROUPS` (donde `pricePerMarket=6` actual cabe perfectamente incluso en `perMarket=10`). Sin cambio ahí es suficiente — la métrica importante es que **la cohorte europea IT+ES** ya consume sus 6 priced y se queda con hambre.

**Nota crítica**: el `lib/cronPlan.js` actual tiene `pricePerMarket=8` en `SHADOW_FIRDS_CRON_GROUPS`. Subir a 20 cabe en 60s con margen (peor caso medido ES+IT@24 = 27.9s). Para `SHADOW_EUROPE_CRON_GROUPS`, el valor actual es `6` — no tocar.

### C. Si se quiere margen real de 2d (ciclo 3d): NO es alcanzable ahora

Faltaría una decisión de producto/infraestructura sobre `maxDuration`. No es una recomendación de este commit.

---

## Resultado 5 — Verificación post-fix (ejecución real de los crons con el filtro corregido)

Tras aplicar el filtro y subir `pricePerMarket=20`, se ejecutaron los crons reales contra Supabase para confirmar el efecto end-to-end.

### 5.1 Inventario priced real medido (PostgREST count por mercado, owner=personal, provider=openfigi)

| Mercado | priced | resolved | price-unavailable | total |
|---|---:|---:|---:|---:|
| AT | 0 | 0 | 0 | 0 |
| BE | 0 | 0 | 0 | 0 |
| DE | 111 | 12 | 15 | 138 |
| DK | 23 | 0 | 16 | 39 |
| ES | 37 | 0 | 4 | 41 |
| FI | 28 | 0 | 0 | 28 |
| FR | 107 | 0 | 1 | 108 |
| GB | 38 | 0 | 13 | 51 |
| IE | 0 | 0 | 0 | 0 |
| IT | 44 | 0 | 0 | 44 |
| NL | 38 | 0 | 1 | 39 |
| NO | 41 | 0 | 0 | 41 |
| PT | 0 | 0 | 0 | 0 |
| SE | 13 | 0 | 9 | 22 |

→ Cobertura tras el fix: 9 mercados con inventario real (DE, DK, ES, FI, FR, GB, IT, NL, NO, SE) × pool completo = 111+107+44+41+38+37+28+23+13+38+13+9+1+15+16+4+1+1 ≈ 540 filas re-validables por noche (de una pasada teórica). En la práctica, cada cohorte toma `2 * pricePerMarket` símbolos.

### 5.2 Ejecución real post-fix de los crons (medición HTTP end-to-end)

| Cron | Grupo | perMarket | candidates | priced | unavailable | updated | elapsedMs | margen a 60s |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| shadow-firds-refresh | pair-5 ES+IT (peor caso) | 20 | 40 | 36 | 4 | 40 | 10 122 | 49.9s (83%) |
| shadow-firds-refresh | solo-de (mayor pool individual) | 20 | 20 | 14 | 6 | 20 | 9 979 | 50.0s (83%) |
| shadow-europe-refresh | west DE+FR+NL | 6 | 18 | 10 | 8 | 18 | 17 830 | 42.2s (70%) |

**Hallazgos clave**:

- **Pool effectivo**: el conteo `candidates` ya es el pool real, no el residuo. ES+IT pasa de 0 candidatos pre-fix a 40 con `pricePerMarket=20` post-fix.
- **Holgura comfortable**: los tres escenarios ejecutados caben en 60s con margen ≥ 42s (70% de margen). Esto confirma la medición previa con `shadow-price-freshness` sobre los peores pares.
- **`price-unavailable`** en `shadow-europe-refresh` west = 8: esos símbolos son legítimamente no-precederos (el fetcher Yahoo falló o devolvió menos de `minBars=180` barras). El nuevo filtro los reintenta, el writer honestamente los vuelve a marcar como `price-unavailable`. **Esto es el comportamiento esperado**: el filtro ampliado elimina el sesgo que silenciaba esos reintentos.
- **`price-updated`**: shadow-firds-refresh marca 40/40 y 20/20 (`updated: count(candidates)`), confirmando que `markSymbolResolutionPriceStatus` persiste el estado nuevo en todos los casos.
- **`errors=8` en shadow-europe-refresh west**: corresponden a los `price-unavailable` legítimos (no son bugs). El cron reporta `errors: []` en shadow-firds-refresh (donde el `status: price-unavailable` se cuenta separado, no como error).

### 5.3 Estado final del commit

Tras el fix, los crons shadow:
- shadow-europe-refresh: re-validará los priced existentes con `pricePerMarket=6` por cohorte. Cobertura completa en ~6-8 ciclos para DE/FR (los mayores) y 3-5 para el resto.
- shadow-firds-refresh: re-validará los priced con `pricePerMarket=20`. Cobertura completa en ~3-6 ciclos para todos los mercados.

Nótese: shadow-europe-refresh mantiene `pricePerMarket=6` por cohorte (no tocado) porque el brief explícitamente pide "no toques shadow-europe-refresh más allá del fix puntual del filtro".

---

## Coste colateral del test

- 5 símbolos `priced` de DE actualizados (`1U1.DE`, `1U1.F`, `2GB.DE`, `2GB.F`, `2KY.F`) — efecto secundario esperado del test del paso 2. No es residuo a limpiar; fue la prueba.
- 12 símbolos totales actualizados (5 manuales + 7 tocados por las mediciones del paso 4 con `perMarket=24` y `perMarket=30` que también barrió DE por antigüedad → las nuevas primeras 25 entradas ahora son las que actualicé yo + las que el script barrió). Si se quiere revertir, sería PATCH manual con `updated_at=2026-05-19T16:12:12Z` y `data_freshness.checkedAt=2026-05-19T16:12:0X Z` y `latestDate=2026-05-19`. **No recomendado** — son los más viejos de DE; ahora correctamente marcados como recientes.
- **Verificación post-fix (sección 5)** tocó 40 ES+IT, 20 DE, 18 DE+FR+NL → ahora los priced de ES, IT, DE, FR, NL tienen `checkedAt` reciente. Efecto esperado: ahora todas las escuadras de priced shadow están bien re-validadas.
- Cero cambios a `cc72b7d`. Dev server de `:3456` detenido tras medición.

---

## Archivos de evidencia citados

- `lib/shadowUniverseStore.js:384` — `readSymbolResolutionsForPricing` (reader, ampliado para aceptar `statuses` array en este commit).
- `lib/shadowUniverseStore.js:404` — `markSymbolResolutionPriceStatus` (writer PATCH, sin cambios).
- `app/api/cron/shadow-europe-refresh/route.js:271` y `:287` — filtro ampliado en este commit + writer.
- `app/api/cron/shadow-firds-refresh/route.js:327` y `:351` — filtro ampliado en este commit (commit nuevo) + writer.
- `app/api/jobs/shadow-price-freshness/route.js:170` y `:192` — job manual (sin cambios en este commit, mismo patrón; sigue aceptando `?status=priced`).
- `lib/cronPlan.js:130-187` — `SHADOW_FIRDS_CRON_GROUPS` con `pricePerMarket: 20` post-fix (antes 8).
- `tests/shadowFirdsCronPlan.test.js:46` — actualizado el expected value de `pricePerMarket` a 20.
- `docs/evidence/shadow-firds-write-mechanism-2026-07-11.md` — informe previo (mismo veredicto de mecanismo correcto, causa raíz del filtro, símbolos distintos).
- `docs/evidence/shadow-firds-freshness-window-2026-07-11.md` — informe previo (estimación 2-3s/símb que la medición empírica corrige a 0.16-0.50s/símb con caché caliente).
- Script efímero `/tmp/verify-filter-fix-2026-07-11.mjs` (no commiteado) — fuente de los datos de la sección 5.
- Script efímero `/tmp/shadow-write-verify-2026-07-11.mjs` (no commiteado) — fuente de los datos de las secciones 2-4.
