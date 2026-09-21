# OPS-MINI-HARDEN-1 — blindar Mini como hábito diario

**Estado:** prep → programación cloud  
**Rama base:** `codex/statsedge-ui-polish` @ `3da0081`  
**Modelo:** Composer 2.5 (o Terra)  
**Prerreq:** OPS-MINI-SMOKE-1 cerrado (`28fa1ab`) — no reescribir desde cero.

## Por qué

Plan item 1: sin Mini/túnel `:15432` no hay mesa fiable. Ya existe smoke Playwright; falta **un ritual diario a prueba de despistes**: un comando, fallos en castellano claros, preflight rápido sin colgar 3 min si el túnel está caído.

## Alcance (closable S–M)

1. **Entrypoint único** `npm run ops:mini:daily` (y opcional `ops:mini:check` = solo preflight sin Playwright).
2. **Preflight ordenado** con exit ≠0 y mensajes humanos (ES):
   - `:15432` escuchando (reusar `mini-tunnel.mjs`; flag `--start` solo si se pide / `ops:mini:daily --start-tunnel`).
   - Hint si `DATABASE_URL` / modo PG no apunta a Mini cuando se pueda leer env sin secretos en logs.
   - `:3300` HTTP OK (no arrancar Next automáticamente salvo doc; si falta, mensaje con comando exacto).
3. **Smoke diario** reutiliza `ops-mini-smoke.mjs`: `/` (mesa US no 0/0), Caza, `/review?symbol=AAPL` — mismos artefactos o carpeta `research/ops-mini-harden-1/`.
4. **Docs** `docs/ops-mini-smoke.md` (o `docs/ops-mini-daily.md` corto): «Al abrir sesión de caza → un comando»; tabla fallos; no pedirle al dueño computer-use.
5. Tests focalizados si extraes helpers puros (parse env / mensajes); `./vfc` o vitest del ticket verde.

## No tocar

- Nocturno prod / scoring / auth / Supabase Pro.
- No activar FIRDS ni Twelve Data.
- No depender de MCP Vercel ni computer-use Mac.
- No matar túneles/procesos ajenos al `--start` documentado.

## Verify orquestador

- Diff + tests; si hay Mac/Mini UP: una corrida `ops:mini:check` / daily (si no hay Mini en cloud, LO QUE NO VERIFIQUÉ explícito — OK).
