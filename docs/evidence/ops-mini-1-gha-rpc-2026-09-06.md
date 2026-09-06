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

## Verificación orquestador

- `npm test -- tests/pgPostgrestAdapter.test.js tests/pgAdapterSupabaseServer.test.js` → **43 passed**
- `./vfc` tocados → tests/lint OK
- **Smoke Mini PG:** no hecho — túnel Postgres `:15432` no abierto (dueño no en Mini). `:13000` es solo Next.

## Pendiente

Cuando haya `ssh -N -L 15432:127.0.0.1:5432 …`: smoke `leaderboard_publishable_rows` + una tanda finalize sobre scan `test:` (o soft-delete).
