# Ticket activo — MH-MINI-RPC-1

**Estado:** `prep`  
**Ticket:** `docs/tickets/MH-MINI-RPC-1.md`  
**Rama prog:** `cursor/mh-mini-rpc-a41e`  
**Base:** `codex/statsedge-ui-polish` @ `becf696` (tip idle · feat Review modal `167f51d`)  
**Modelo:** Composer / herencia del chat Agent

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md @docs/tickets/MH-MINI-RPC-1.md

Rama: `cursor/mh-mini-rpc-a41e` desde `codex/statsedge-ui-polish` (ff-only a HEAD).
Modelo: Composer (o el indicado en el chat).

Alcance (S–M): RPC/persistencia honesta MH en Mini — `upsert_app_setting_newer_wins` en pg local.
1) `lib/pgPostgrestAdapter.js`: añadir `upsert_app_setting_newer_wins` a `PG_RPC_SUPPORTED` + impl ≡ `supabase/schema.sql` (newer-wins; devolver filas).
2) Callers ya listos: `writeMarketHealthCache` / `writeMarketHealthSeries` en `app/api/market-health/route.js`; UI Actualizar → `?refresh=1` + `cacheWritten` (`16abe65`).
3) Tests adapter (+ route si hace falta). Write fallido → `cacheWritten=false` honesto.
4) Vitest focalizado + `./vfc` si aplica.

No: FIRDS, scoring, nocturno scan, rediseño UI Mercado, fricción 1·2·4·5.
Sin commit ni push. Devuelve plantilla de retorno del ticket.
```

## Notas orquestador

- Cola fricción UI **cerrada**: ENTRY (#52) · COLD (#53) · UX-EMPTY (#54) · Review modal (#55 / `167f51d`).
- Residual ops: este ticket. FIRDS / Twelve Data siguen aparcados.
- Tip polish: `becf696`. Precheck smoke prog: `nc -zv 127.0.0.1 15432` (túnel Mini).
- No implementar en este hilo.
