# OPS-MINI-1 — Apagar GHA scan-universe + RPC pg (leaderboards + finalize percentil)

**Estado:** listo para Agent (fases B–C) · fase A orquestador  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2 / GPT-5.6 Terra  
**Contexto:** cutover Mini hecho (MIGRATE-1…6 historia). Hoy desde **portátil** si hay red al PG del Mini; si no, código+tests en MacBook y smoke RPC cuando haya SSH/túnel.  
**Patrón:** `docs/tickets/MIGRATE-6-pg-rpc-scan-history.md` + `lib/pgPostgrestAdapter.js` (`PG_RPC_SUPPORTED` hoy solo `scan_symbol_history_latest_v1`).

## Por qué

1. **GHA `scan-universe`** sigue `active` y escribe (o intenta) contra secretos viejos / duplica el nocturno que ya corre en **launchd Mini** (`com.statsedge.scan-universe-us` 05:00 local). Hay que **apagario**.  
2. En `pg`, leaderboards y finalización de percentiles siguen en `PG_RPC_UNSUPPORTED` → listas derivadas / percentil `final` degradados en Mini.

## Fases

### A — Apagar GHA `Scan universe (US, nightly)` (orquestador / dueño)

```bash
gh workflow disable "Scan universe (US, nightly)"
# verificar:
gh api repos/AFC1204-coder/Screener-Bursatil/actions/workflows/332077080 --jq '{name,state}'
```

Esperado: `state: disabled`. **No** borrar el YAML (queda para reactivar / histórico).  
Opcional doc: una línea en `docs/evidence/` o backlog.  
**No** apagar `refresh-bars` ni RS privados en este ticket salvo orden explícita.

### B — `leaderboard_publishable_rows` en modo pg

Firma canónica: `supabase/migrations/20260710180000_leaderboard_publishable_rows.sql`  
Uso: `lib/leaderboards.js` → `readScanRows`.

1. Inventariar params (`p_owner_id`, `p_max_rows`, `p_since_days`) y retorno jsonb `{ rows, rowsRead }`.  
2. En `lib/pgPostgrestAdapter.js`: builder SQL + rama en `pgRpc`; añadir a `PG_RPC_SUPPORTED`.  
3. Tests contrato en `tests/pgPostgrestAdapter.test.js` / `pgAdapterSupabaseServer.test.js` (mismo estilo MIGRATE-6).  
4. Smoke (si `DATABASE_URL` Mini alcanzable): llamada RPC o job leaderboards con 1 mercado; sin eso, documentar LO QUE NO VERIFIQUÉ.

### C — Finalize percentil en modo pg

Usado por `lib/scanPercentileFinalization.js`:

| RPC | Rol |
|---|---|
| `scan_finalize_inputs` | Lectura paginada thin-raw (`p_offset` / `p_max_rows`) — migraciones `*scan_finalize_inputs*` |
| `finalize_scan_results` | Escritura patches metrics + `percentileScope: final` — `supabase/schema.sql` ~302 |

1. Implementar **ambas** en el adaptador pg (sin ellas el finalize no cierra).  
2. Preferir SQL equivalente fiel al PL/pgSQL / SQL de migraciones (merge `metrics || patch`, guard owner/scan).  
3. Tests unitarios con pool mock / builders; si hay Mini: smoke acotado **sin** `--nocturno-real` o soft-delete tras verify.  
4. **No** cambiar umbrales de scoring ni semántica de percentil — solo disponibilidad RPC en `pg`.

## Fuera de alcance

- LOOK-B / piel UI · tape producto  
- Coverage RPC (`coverage_scan_summary`, …) salvo que caigan como dependencia mínima de B/C (entonces mencionar y no expandir)  
- Apagar otros workflows GHA  
- Commit/push desde el Agent de programación  
- Corrida full nocturno US (launchd) en este ticket

## Criterios de aceptación

| Fase | Criterio |
|---|---|
| A | Workflow `332077080` / «Scan universe (US, nightly)» → `disabled` |
| B | `isPgRpcSupported("leaderboard_publishable_rows")` true; tests verdes; PostgREST sin `pg` intacto |
| C | `scan_finalize_inputs` + `finalize_scan_results` soportadas en pg; tests verdes |
| Gates | `./vfc` archivos tocados; **sin commit** programación; orquestador + OK dueño (nocturno/datos) antes de commit |

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## Fase A (GHA)
## Smoke Mini / LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
