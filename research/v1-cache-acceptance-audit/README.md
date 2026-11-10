# cache-001 — auditoría adversarial de aceptación

**Veredicto:** `CACHE_ACCEPTANCE_HARDENED_OK`  
**Fecha:** 2026-09-10  
Sin Mini / enqueue / producto / `v1.py`.

## Fase 1 — hechos

| Afirmación | Clase | Evidencia |
|---|---|---|
| cache-001 preparado, no encolado/ejecutado | HECHO | checkpoint congelado + `queue-snapshot.cache_attempt_exists=false` |
| Baseline congelado 8 FAIL / 6 PASS | HECHO | `controls/baseline.log` |
| Source hash `df9467d7…` | HECHO | contrato + `shasum` local |
| Accept viejo acepta fix+capacidad rota | HECHO | `old-wrong.log` exit 0, 14/14 |
| Accept viejo acepta fix+key coercion | HECHO | `old-preservation_break.log` exit 0 |
| Accept endurecido: WRONG FAIL, RIGHT PASS, BREAK FAIL, baseline 8 defectos | HECHO | `triad-summary.json` |

## Mapa de cobertura

| Cláusula contractual | Accept | C/P | +/- | Hueco previo |
|---|---|---|---|---|
| Sync throw limpia inflight | check 2 | C | + | cubierto |
| Async reject limpia inflight | check 3 | C | + | cubierto (ya PASS en source) |
| clear no repuebla | check 4 | C | + | cubierto |
| clear+set preserva B; caller recibe A | check 5 | C | + | cubierto |
| clear no borra inflight reemplazo; dedupe | check 6 | C | + | cubierto |
| set invalida solo esa clave | check 7 | C | + | cubierto |
| set expirado barre publish viejo | check 8 | C | + | cubierto |
| viejo no pisa reemplazo completado | check 9 | C | + | cubierto |
| reject viejo no borra inflight nuevo | check 10 | C | + | cubierto |
| concurrencia normal / dedupe | check 1 | C/P | + | cubierto |
| TTL `<=`, stale peek, ttl 0/-1 | check 11 | P | + | cubierto |
| LRU get refresca; peek no | check 12 | P | + | cubierto |
| falsey cacheados; undefined=miss | check 13 | P | + | cubierto |
| TTL constants; API keys; counters tras clear | check 14 | P | + | cubierto |
| export `marketCache` | **nuevo** | P | + | **hueco** |
| capacidad default 2000 | **nuevo** | P | + | **hueco** |
| capacidad marketCache 2500 | **nuevo** | P | + | **hueco** |
| key identity (1 ≠ "1") | **nuevo** | P | + | **hueco** |
| providers/persistencia/metodología | — | P | — | N/A módulo (NO_VERIFICADO producto) |
| coerciones rarísimas de ttlMs | — | P | — | residual menor; fail-closed vía bloqueo contractual |

## Adversarial

1. **WRONG:** mismos fixes de invalidación + `maxEntries` 2000→50 y market 2500→10.  
   - Accept **viejo:** PASS 14/14.  
   - Accept **nuevo:** FAIL (capacidades).
2. **PRESERVATION_BREAK:** fixes OK + `String(key)` coercion.  
   - Viejo: PASS. Nuevo: FAIL (key identity).
3. **RIGHT:** fixes + capacidades/export/identity preservados → PASS 18/18.
4. **BASELINE:** sigue fallando exactamente los 8 defectos originales; checks nuevos PASS → 10/18.

## Archivos sandbox

`research/v1-cache-acceptance-audit/` — `accept-cache.mjs` (18 checks), `run-triad.mjs`, fixtures, `controls/` (originales), `triad-summary.json`.

`v1.py` intacto. Controles Mini **no** desplegados.
