# MH-MINI-RPC-1 — Persistencia MH honesta en Mini (`app_settings` / RPC)

**Estado:** `prep`  
**Prioridad:** P2 (ops residual · fricción UI 1·2·4·5 ya cerrada)  
**Tamaño:** S–M closable  
**Rama prog:** `cursor/mh-mini-rpc-a41e`  
**Base:** `codex/statsedge-ui-polish` @ `becf696` (tip idle post Review modal #55 · feat `167f51d`)  
**Modelo:** Composer  
**Tipo:** market-health · pg local / túnel Mini `:15432` · sin FIRDS · sin scoring  
**Origen:** residual MH refresh/caché (`16abe65`) · backlog «Residual MH (ops)» · OPS-MINI-1 (RPC scan OK; settings RPC pendiente)

## Problema

El gesto **Actualizar** en `/market-health` ya pide `?refresh=1` y el route intenta persistir caché/serie vía RPC `upsert_app_setting_newer_wins` → `app_settings`. En modo **pg local** (Mini vía túnel `:15432`) esa RPC **no está** en `PG_RPC_SUPPORTED`: el write falla con `PG_RPC_UNSUPPORTED` → `freshness.cacheWritten=false` (y serie igual). Sin túnel Mini, la persistencia ni siquiera está reachable.

La UI de refresh/caché (`16abe65`) está hecha; falta **ops/adapters** para que el upsert sea honesto en el entorno real (Mini).

## Inventario (HEAD `becf696`)

| Pieza | Dónde | Qué hace |
|---|---|---|
| Botón **Actualizar** | `app/market-health/page.jsx` → `refreshAll` → `load({ refresh: true })` | Fuerza refresh de salud + liderazgo; también re-fetch news/social/methodology/coverage |
| Path API MH | `lib/marketHealthFetch.js` → `marketHealthApiPath({ refresh })` | `refresh` → `/api/market-health?refresh=1`; sin refresh → `/api/market-health` |
| Liderazgo refresh | `page.jsx` `load` | Con refresh: `/api/market-leadership?refresh=1` |
| `cacheWritten` | `app/api/market-health/route.js` → `annotateCache` / respuesta live | Tras `computeMarketHealth`, `writeMarketHealthCache` → `freshness.cacheWritten` (+ `cacheWriteError`) |
| Upsert caché | `writeMarketHealthCache` · `setting_type=market_health_cache` | `supabaseRpc("upsert_app_setting_newer_wins", …)` |
| Upsert serie | `writeMarketHealthSeries` · `setting_type=market_health_series` | Misma RPC (ring ≤13 sem) |
| Contrato tests | `tests/marketHealthRoute.test.js` · `tests/marketHealthFetch.test.js` | refresh=1 · `cacheWritten` true/false |
| RPC pg allowlist | `lib/pgPostgrestAdapter.js` `PG_RPC_SUPPORTED` | Solo: `scan_symbol_history_latest_v1`, `leaderboard_publishable_rows`, `scan_finalize_inputs`, `finalize_scan_results` — **sin** `upsert_app_setting_newer_wins` |
| Schema canónico | `supabase/schema.sql` ~1144 | Firma: `(p_owner_id, p_setting_type, p_setting_key, p_value, p_updated_at)` → `setof app_settings` |
| Otros callers RPC | `app/api/settings/route.js` POST · `app/api/company-brief/route.js` (caché brief) · `scripts/seed-default-settings.mjs` | Mismo agujero en pg local |
| Túnel Mini | `scripts/ops/mini-tunnel.mjs` · preflight `:15432` | Sin túnel → PG down; con túnel pero RPC missing → live OK, persistencia no |

### Qué falla sin Mini / sin RPC

| Condición | Efecto observable |
|---|---|
| Túnel `:15432` DOWN / `STATSEDGE_DB_MODE` sin PG | Lectura/escritura `app_settings` no disponible; Mercado degrada o sirve sin caché durable |
| Mini UP + RPC settings **no** en adapter | `refresh=1` puede recalcular live; `cacheWritten=false` / `cacheWriteError` con `PG_RPC_UNSUPPORTED` o mensaje equivalente; próximo cold vuelve a stale o recompute |
| PostgREST remoto (legacy) | Fuera de alcance: Pro cancelado; verdad = Mini pg |

## Alcance (cuando se programe)

1. **Habilitar** `upsert_app_setting_newer_wins` en modo pg (`lib/pgPostgrestAdapter.js`): allowlist + implementación equivalente a `schema.sql` (newer-wins por `updated_at`; devolver fila(s) como hoy espera `settingSyncSummary`).
2. **Tests** adapter (+ route MH si hace falta) que fallen sin el RPC y pasen con él; no inventar PostgREST.
3. **Honestidad:** si write falla, seguir exponiendo `cacheWritten=false` + error usable (no mentir éxito).
4. **Verify:** vitest focalizado · `./vfc` si aplica. Smoke orquestador: túnel UP → Actualizar → `cacheWritten=true` (o evidencia SQL de fila nueva en `app_settings`).

Stretch opcional (solo si cabe sin hinchar): mismo path beneficia settings/brief cache — no es gate de cierre si MH cache+serie OK.

## Fuera de alcance (NO)

| Tema | Motivo |
|---|---|
| FIRDS / Twelve Data / Hito 1B | Aparcado dueño |
| Scoring / régimen / umbrales / nocturno scan | Otro track |
| Reabrir fricción UI 1·2·4·5 | Cerrada (#52–#55) |
| Rediseño `/market-health` UI | Solo persistencia |
| Commit/push desde programación | Orquestador cierra |

## Criterios de aceptación (orquestador)

1. Con túnel Mini `:15432` UP + env pg: `GET /api/market-health?refresh=1` → `freshness.cacheWritten === true` (o evidencia SQL `market_health_cache` / serie actualizada).
2. Sin RPC / write fallido: `cacheWritten=false` + error no vacío (contrato tests vigente).
3. Vitest adapter/route OK · `./vfc` si toca paths del gate.
4. Sin cambios de scoring/FIRDS/copy de fricción UI.

## Prompt para Agent chat (copiar tal cual)

Ver bloque en `docs/tickets/activo.md` (misma rama `cursor/mh-mini-rpc-a41e`).

Sin commit ni push.
