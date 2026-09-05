# MIGRATE-6 — RPC pg mínima: historia de símbolos (nocturno)

**Estado:** Activo  
**Depende:** MIGRATE-4 writes · MIGRATE-5 nocturno US (historia falla hoy con aviso)  
**Anti-colisión:** un escritor; `git status` al empezar (Grok Bot puede empujar chart/etc.)

## Problema

En modo `pg`, `supabaseRpc` lanza `PG_RPC_UNSUPPORTED`. El nocturno US escribe `scans`/`scan_results` OK pero **historia** falla:

`RPC scan_symbol_history_latest_v1 no disponible en modo pg local`

Sin eso, «qué cambió» / deltas por símbolo siguen degradados en Mini.

## Objetivo

Implementar en el camino `pg` la RPC **`scan_symbol_history_latest_v1`** (y el POST a `scan_symbol_history` si aún falla) usada por `writeScanSymbolHistory` en `lib/scanHistory.js`, suficiente para que el nocturno US deje de avisar fallo de historia.

## Alcance

1. Inventariar firma real de `scan_symbol_history_latest_v1` (SQL en migraciones Supabase / dumps / usos en `lib/scanHistory.js`).
2. En `lib/supabaseServer.js` / `pgPostgrestAdapter` (o módulo hermano): cuando `STATSEDGE_DB_MODE=pg`, ejecutar SQL equivalente (no PostgREST). Otras RPC siguen `PG_RPC_UNSUPPORTED` explícito.
3. Confirmar POST `scan_symbol_history` con adaptador writes (MIGRATE-4) o ampliar columnas/jsonb si hace falta.
4. Tests de contrato (mock pool o SQL builder) + smoke Mini: `scan-universe` con `--limit` **sin** `--nocturno-real` (prefijo `test:`) o soft-delete tras verify; historia `saved=True` o filas en `scan_symbol_history`.
5. Evidencia `docs/evidence/migrate-6-….md`.

## Fuera

- `leaderboard_publishable_rows` / finalize / coverage RPC (ticket aparte)  
- CLEAN / chart RS smoke (aparte)  
- Apagar GHA · túnel móvil  

## Criterios

- Nocturno (o smoke acotado) escribe historia sin `PG_RPC_UNSUPPORTED` para `scan_symbol_history_latest_v1`
- PostgREST sin flag `pg` intacto  
- Tests + `./vfc` tocados  
- Sin commit/push desde programación  
