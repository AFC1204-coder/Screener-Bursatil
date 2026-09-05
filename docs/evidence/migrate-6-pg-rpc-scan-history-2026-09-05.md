# MIGRATE-6 — evidencia RPC pg scan_symbol_history (2026-09-05)

## Alcance

`STATSEDGE_DB_MODE=pg` + `DATABASE_URL` → RPC **`scan_symbol_history_latest_v1`** vía SQL directo (equivalente a `supabase/migrations/20260729130755_scan_symbol_history.sql`). POST `scan_symbol_history` con `change_reasons text[]`. Otras RPC siguen `PG_RPC_UNSUPPORTED`.

## Inventario firma SQL

```sql
scan_symbol_history_latest_v1(p_owner_id text, p_mic_codes text[] default null)
  → setof scan_symbol_history
```

Lógica: `DISTINCT ON (owner_id, mic_code, symbol)` ordenado por `observed_at DESC, id DESC`, filtro MIC opcional (`null`, vacío o `= ANY(p_mic_codes)`).

**Uso JS:** `lib/scanHistory.js` → `writeScanSymbolHistory` llama:

```js
supabaseRpc("scan_symbol_history_latest_v1", {
  p_owner_id: ownerId,
  p_mic_codes: micCodes.length ? micCodes : null,
});
```

Luego POST batch a `scan_symbol_history` con `on_conflict=owner_id,source_scan_id,mic_code,symbol` + `resolution=ignore-duplicates`.

## Cambios

| Pieza | Detalle |
|---|---|
| `lib/pgPostgrestAdapter.js` | `buildScanSymbolHistoryLatestSql`, `pgRpc`, `isPgRpcSupported`; arrays JS → `text[]` en INSERT (no `::jsonb`) |
| `lib/supabaseServer.js` | `supabaseRpc` delega a `pgRpc` en modo `pg` |
| Tests | `tests/pgPostgrestAdapter.test.js`, `tests/pgAdapterSupabaseServer.test.js` |

### RPC soportadas (pg)

| RPC | Estado |
|---|---|
| `scan_symbol_history_latest_v1` | **Implementada** |
| `finalize_scan_results`, `leaderboard_publishable_rows`, etc. | `PG_RPC_UNSUPPORTED` |

### POST scan_symbol_history

Soportado vía adaptador existente (MIGRATE-4) tras fix de `change_reasons` (`text[]`, no jsonb).

## Tests (MacBook, sin LAN Mini)

```bash
npm test -- tests/pgPostgrestAdapter.test.js tests/pgAdapterSupabaseServer.test.js
# 30 passed

./vfc lib/pgPostgrestAdapter.js lib/supabaseServer.js
```

## Smoke Mini (orquestador, 2026-09-05 ~16:41)

```bash
STATSEDGE_SCAN_UNIVERSE_LIMIT=10 STATSEDGE_SCAN_UNIVERSE_SIN_RETENCION=1 \
  ./scripts/run-scan-universe-us.sh
```

| Campo | Valor |
|---|---|
| `local_id` | `test:materialized:US:2026-09-05:t144108:o0:l10` |
| Historia | **10 de 10** observaciones · 1 tanda · sin `FALLÓ` |
| `scan_symbol_history` | **10** filas `source_scan_id=2d10d30b-…` |
| Post-smoke | soft-delete del scan `test:` |

## LO QUE NO VERIFIQUÉ

- PostgREST sin flag `pg` (sin cambio de código en esa ruta; no re-ejecutado)
- Leaderboards / finalize / coverage RPC (fuera de alcance)
- Corrida full nocturno con historia (launchd 05:00)
