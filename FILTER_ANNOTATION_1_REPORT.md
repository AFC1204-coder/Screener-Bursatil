# FILTER-ANNOTATION-1 — Memo incremental de `__screenerAnnotation`

**Fecha:** 2026-09-13  
**Dataset:** `materialized:US:2026-09-13:t030356:o0:l5608` · **3.576 filas** · `:3300`  
**Evidencia:** `research/filter-cpu-1/annotation-cache-benchmark.json`

---

## Inputs de cache key

| Componente | Detalle |
|---|---|
| **Identidad** | `symbol` (uppercase) |
| **Settings** | `setupMode` (única clave de `activeSettings` que afecta annotate hoy) |
| **Fila** | Fingerprint hash (djb2) de ~60 campos en `ANNOTATION_ROW_*_FIELDS` en `lib/screenerAnnotationCache.js` |

Clave final: `{symbol}|{setupMode}|{hash}`

**Invalida:** cambio de `setupMode`, cualquier campo de anotación (scores, coverage, freshness, qualityGate, objectiveMetricAudit, providerMeta, arrays de reasons/risks, flags setup/methodology).

**No invalida:** sort, perfPeriod, view filters (country/theme/sector), paginación, `maxSymbols`, `minRS`, intensidades de filtro que no cambian `setupMode`.

---

## Estrategia

1. Extraer anotación a `lib/screenerAnnotationCache.js` (`buildScreenerAnnotation`, `annotateScreenerRow`, `annotateScreenerRows`).
2. LRU en memoria (8.192 entradas) keyed por `buildAnnotationInputKey`.
3. Fast-path por fila: si `row.__screenerAnnotationInputKey` coincide → devolver la misma referencia de fila (sin spread).
4. Cache hit global: reutilizar `__screenerAnnotation` almacenada; solo spread de fila (sin recomputar explain/audit/health).
5. `useResultViewModel` y `research/filter-cpu-1/view-model-phases.mjs` consumen el módulo compartido.

---

## Calls before / after (Node, 3.576 filas US)

| Escenario | Pasan | Antes (misses) | Después warm | Cache hits | Misses |
|---|---:|---:|---:|---:|---:|
| Líderes E2 frío | 560 | 560 | 62–86 ms | 0 | 560 |
| Líderes E2 2.º pase | 560 | 560 | **52 ms** | **560** | **0** |
| Cerca pivot (prewarm) | 26 | 26 | **3 ms** | **26** | **0** |
| Momentum OFF | 979 | 979 | 106–162 ms | 0 | 979 |
| Vuelta Líderes E2 | 560 | 560 | **49 ms** | **560** | **0** |

**Baseline FILTER-CPU-1:** `vm.annotateRows` warm ≈ **43 ms** (560 pasan), sin memo entre gestos.

**Ganancia medible:** 2.º pase / toggle-back → **0 misses**, annotate **~40–45 % más rápido** vs frío en el mismo preset (86 → 49–52 ms). Hunt pivot prewarm: **26/26 hits**, 3 ms.

---

## React / long-task before / after

| Medida | Antes (FILTER-CPU-1 / PERF-REAL-1) | Después |
|---|---|---|
| Hunt cache hit browser | ~315 ms feedback, LT 0 ms filter | *No medido en browser esta sesión* |
| Annotate CPU en cache hit | ~2 ms (26 filas) / ~43 ms (560) | **3 ms** (26) / **49–52 ms** (560 reutilizado) |

**Browser smoke:** `:3300` exige token; `:3000` no disponible; CDP sin sesión logueada. **No se midieron long tasks en browser en esta sesión.** La reducción de CPU annotate debería bajar el LT residual proporcionalmente en hunt-cache-hit y toggle-back.

---

## Tests

```bash
npm test -- tests/screenerAnnotation.test.js tests/screenerHuntCardApply.test.js
SCREENER_ANNOTATION_PERF=1 npm test -- tests/screenerAnnotationCache.perf.test.js
```

Cobertura nueva: cache hit, invalidación setupMode/campo, igualdad canónica, no leakage por símbolo, batch reuse.

---

## Riesgos / residuales

1. **Mantenimiento de campos:** si una función de annotate empieza a leer un campo no listado en `ANNOTATION_ROW_*_FIELDS`, puede haber stale cache → ampliar lista + test de igualdad.
2. **Solo `setupMode` en settings:** contrato documentado; si otro setting afecta annotate, hay que añadirlo a la clave.
3. **Browser LT:** React commit (~100–200 ms) sigue dominando tras annotate; este ticket no lo toca.
4. **Memoria:** LRU 8k × ~1 annotation/fila ≈ acotado; sin persistencia (correcto).

---

## Archivos

| Archivo | Cambio |
|---|---|
| `lib/screenerAnnotationCache.js` | Nuevo módulo memo + clave |
| `app/components/screener/useResultViewModel.js` | Usa `annotateScreenerRows` |
| `research/filter-cpu-1/view-model-phases.mjs` | Usa módulo compartido |
| `tests/screenerAnnotation.test.js` | Tests hit/invalidación/igualdad |
| `tests/screenerAnnotationCache.perf.test.js` | Benchmark real (opt-in) |
| `tests/screenerHuntCardApply.test.js` | Assert actualizado |
