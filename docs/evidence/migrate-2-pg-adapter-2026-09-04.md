# MIGRATE-2 — evidencia adaptador pg (2026-09-04)

## Alcance

`STATSEDGE_DB_MODE=pg` + `DATABASE_URL` → lecturas GET vía `lib/pgPostgrestAdapter.js` detrás de `supabaseRequest` / `supabaseCount`. Sin flag → PostgREST intacto.

## Smoke dueño (MacBook → Mini)

| Check | Resultado |
|---|---|
| Túnel | `localhost:15432` → Postgres Mini |
| Mesa US | **3315** filas (OK) |
| Ficha AAPL | chart / `daily_bars` OK |
| RLS | rol local con **BYPASSRLS** (ops Mini; no en código app) |

## Tests (orquestador)

```bash
npm test -- tests/pgPostgrestAdapter.test.js tests/pgAdapterSupabaseServer.test.js
# 13 passed
```

## Gaps documentados (OK para cierre 2a)

- RPC (`rpc/*`) → error `PG_RPC_UNSUPPORTED`
- Writes no-GET → `PG_WRITE_UNSUPPORTED`
- `select` embebido PostgREST (joins) → no soportado

## Archivos

- `lib/pgPostgrestAdapter.js`
- `lib/supabaseServer.js`
- `next.config.js` (`serverExternalPackages: pg`)
- `package.json` / lock (`pg`)
- `.env.example`
- tests adaptador
