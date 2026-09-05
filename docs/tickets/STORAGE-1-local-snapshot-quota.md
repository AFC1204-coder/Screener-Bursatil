# STORAGE-1 — Snapshot local: dejar de fallar con 3k+ filas

**Estado:** Cerrado 2026-09-05 (verify orquestador · smoke `:3000`)  
**Rama:** `codex/statsedge-ui-polish`  
**Síntoma:** Banner rojo recurrente «No cabe el snapshot local; la copia en nube sigue disponible» al cargar mesa US (~3315 filas).  
**Previo:** MIGRATE-2 `4703817`.  
**Evidencia:** `docs/evidence/storage-1-local-snapshot-2026-09-05.md`

## Problema

`localStorage` tiene ~5–10 MB. El snapshot completo del screener (clave `statsedge.scans.v1`, presupuesto 4,5 MB en `lib/localState.js`) **no cabe** con el universo US actual. `fitScansForBrowser` / `safeWrite` fallan → `StorageAlert` en cada sesión. El usuario ve alarma aunque la mesa y la nube/Mini están bien.

No es un fallo de Postgres ni de MIGRATE-2.

## Objetivo producto

1. **Con persistencia remota disponible** (PostgREST o `STATSEDGE_DB_MODE=pg`): no depender de guardar el snapshot completo en `localStorage`. Fuente de verdad = servidor; local solo criterios/sesión ligeros si hace falta.
2. **Sin remoto**: degradación silenciosa o mensaje **una vez**, no banner rojo permanente en uso normal.
3. Tras el fix: arrancar mesa US **sin** banner de cuota (salvo modo privado / cuota realmente agotada por otras claves).

## Alcance propuesto

- Inventariar escrituras a `STORAGE_KEYS.scans` (`lib/screenerPipeline.js`, `lib/cloudSyncClient.js`, `lib/localState.js`).
- Estrategia (elegir la mínima que pase smoke):
  - **A (preferida):** si `configured`/remoto OK → no persistir filas completas; guardar como mucho `local_id` / meta del scan activo.
  - **B:** IndexedDB para el snapshot grande (más trabajo; solo si A no basta para offline).
  - **C:** subir presupuesto no es solución — la cuota del navegador no crece.
- Ajustar copy del aviso si queda un caso residual (menos alarmista).
- Tests: cuota simulada + «remoto OK ⇒ no QuotaExceeded en camino feliz».
- Smoke Browser Use: hard-reload `/` mesa US → **sin** banner «No cabe el snapshot local».

## Fuera

- MIGRATE-3 / cutover Mini.
- SHELL-A…D.
- Reescribir sync de favoritos/alerts (salvo si bloquean el mismo presupuesto).

## Criterios de aceptación

1. Mesa US 3k+ filas: reload sin banner de snapshot local.
2. Ficha `/stock/AAPL` y cola de revisión siguen funcionando.
3. Tests del ticket + `./vfc`.
4. Sin commit/push por el agente de programación.
