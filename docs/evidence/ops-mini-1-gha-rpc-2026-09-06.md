# OPS-MINI-1 — evidencia (2026-09-06)

## Fase A — GHA

`Scan universe (US, nightly)` → `disabled_manually` (dueño, desde portátil).

Nocturno US queda en launchd Mini (`com.statsedge.scan-universe-us`).

## Fases B + C — código

| RPC pg | Implementación |
|---|---|
| `leaderboard_publishable_rows` | SQL inline ≡ `20260814150000` (filtro publishable antes de LIMIT) |
| `scan_finalize_inputs` | `SELECT public.scan_finalize_inputs(...)` |
| `finalize_scan_results` | `SELECT * FROM public.finalize_scan_results(...)` |

Archivos: `lib/pgPostgrestAdapter.js`, tests pg adapter.

## Verificación orquestador (código)

- `npm test -- tests/pgPostgrestAdapter.test.js tests/pgAdapterSupabaseServer.test.js` → **43 passed**
- `./vfc` tocados → tests/lint OK

## Smoke Mini PG (2026-09-06 ~21:05 CET)

| Pieza | Valor |
|---|---|
| Túnel | `ssh -N -L 15432:127.0.0.1:5432 cristian@192.168.0.116` (portátil) |
| `DATABASE_URL` | `…@127.0.0.1:15432/statsedge` (`.env.local`) |
| PG | Postgres 17.11 Homebrew · DB `statsedge` · owner `personal` |

### `leaderboard_publishable_rows`

Vía `pgRpc` · `p_owner_id=personal` · `p_max_rows=50` · `p_since_days=45`:

| Campo | Valor |
|---|---|
| `rowsRead` | 58886 |
| `rowsPublished` | 50 |
| `rowsExcluded` | 14956 |
| Sample | MATW / DKS / MEC · `parent_status=partial` · scan `9dea2716…` (US 2026-09-06) |

### Finalize (scan `test:`)

1. Insert `test:ops-mini-1-smoke:…` + 1 `scan_results` (MPT, `percentileScope=batch`).
2. `scan_finalize_inputs` → `rowsRead=1`, `inputs.length=1`.
3. `finalize_scan_results` con `{ id, metrics_patch: { percentileScope: 'final', … } }` → `updated_count=1`; metrics → `final`.
4. Soft-delete del scan `test:` (`deleted_at` set).

Nota: el patch debe usar **`metrics_patch`** (no `metrics`); firma canónica de `schema.sql`.

## Estado

**OPS-MINI-1 cerrado** — GHA off · RPC pg · smoke túnel OK.
