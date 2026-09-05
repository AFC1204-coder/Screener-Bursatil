# MIGRATE-3 — evidencia cutover Mini (2026-09-05)

## Destino

- Host: `Christians-Mac-mini` · user `cristian` · LAN `192.168.0.116`
- App: `~/Statsedge-v0.1`
- DB: Postgres 17 local · `STATSEDGE_DB_MODE=pg` · `DATABASE_URL=…@127.0.0.1:5432/statsedge`

## Proceso Next (persistente)

| Pieza | Path |
|---|---|
| Plist | `~/Library/LaunchAgents/com.statsedge.next.plist` |
| Script | `~/Statsedge-v0.1/scripts/run-next-prod.sh` |
| Bind | `127.0.0.1:3000` (`npm run start`) |
| Logs | `~/Statsedge-v0.1/logs/next.{out,err}.log` |

Verificado: `launchctl` **running** (KeepAlive). Tras boot del Mini: `RunAtLoad` + Postgres Homebrew.

**Nota:** no hacer `source .env.local` en el script (valores con espacios rompen bash). Next carga `.env.local` solo.

## Cron de prueba (launchd)

| Pieza | Path |
|---|---|
| Plist | `~/Library/LaunchAgents/com.statsedge.cron-universe-refresh.plist` |
| Script (repo) | `scripts/run-cron-universe-refresh.sh` |
| Plantilla plist | `scripts/com.statsedge.cron-universe-refresh.plist` |
| Schedule | diario **22:05** local + `RunAtLoad` |
| Endpoint | `GET/POST` `http://127.0.0.1:3000/api/cron/universe-refresh` + Bearer/`x-cron-secret` = `CRON_SECRET` |

### Smoke cron (2026-09-05)

```
http=200  ok=True  count=9686
last exit code = 0  (kickstart + manual)
```

Cache write en modo pg: `written: false` / `supabase-skip` (POST no soportado en adaptador — esperado MIGRATE-2). El cron **autentica y completa** el cálculo de universo.

Jobs que **escriben** scans (`scan-refresh`, leaderboards RPC) siguen fallando en pg write/RPC hasta ampliar el adaptador. No bloquean el criterio «un cron de prueba OK».

## Smoke datos (API + DB)

| Check | Resultado |
|---|---|
| Túnel MacBook | `ssh -N -L 13000:127.0.0.1:3000 cristian@192.168.0.116` → `http://127.0.0.1:13000` |
| HTML `/` vía túnel | 200 |
| `GET /api/chart?symbol=AAPL` + `x-statsedge-token` | **401** barras · sin error |
| Mesa US (Postgres) | `materialized:US:2026-09-03…` · **3315** filas |
| AAPL `daily_bars` | **401** |
| `STATSEDGE_DB_MODE` | `pg` (camino activo local) |

## Smoke UI

- Dueño (2026-09-05 ~12:12): login en túnel `13000` → **OK** (mesa usable).
- Fecha de datos en UI: última mesa US en DB = **2026-09-03** (`materialized:US:2026-09-03…`, 3315). No hay scan `2026-09-04` en Postgres. Ver nota abajo.
- Automation tab del agente seguía en AuthGate (sesión distinta); smoke UI = confirmación dueño.

## Checklist cancelación / no renovar Pro

Proyecto nube: `dzovggfbcoymjgikkbno`. Billing: org ya en **Free** / cuota excedida (riesgo read-only). Cutover Mini es el camino activo.

1. **Backup:** dump fresco en MacBook + copia fuera del Mini (Time Machine / disco). Dump de referencia: `~/statsedge-backups/statsedge-2026-09-03.dump` (~704 MB) en MacBook y Mini.
2. **No renovar Pro** — ya cancelado / Free; no reactivar salvo emergencia.
3. **No borrar** el proyecto Supabase **≥14 días** tras smoke Mini estable (rollback dump + posible lectura residual).
4. Confirmar uso diario desde Mini (túnel o pantalla) **sin** depender de `SUPABASE_URL` en el camino activo (`STATSEDGE_DB_MODE=pg`).
5. Solo entonces valorar pausar/archivar proyecto nube.

## Nota fecha «vieja» en UI (esperado hoy)

Hoy es **2026-09-05**. El nocturno US más reciente restaurado/corrido es **2026-09-03**. No hay filas `scans` del 4 sep. Motivo: el nocturno cloud ya no es el camino activo; el Mini corre `universe-refresh` pero **aún no escribe** materializados US (`scan-refresh` → POST pg no soportado). La mesa del 3 sep con 3315 es la fuente correcta hasta el siguiente nocturno local (ampliar writes pg o runner CLI).

## Gaps conscientes (post-MIGRATE-3)

- Escrituras PostgREST / RPC en modo pg → aún no (nocturno completo de scans necesita ampliar adaptador o scripts SQL/`scan-universe.mjs` contra `DATABASE_URL`).
- Más plists de cron (scan-refresh, leaderboards, shadow) → siguiente oleada cuando writes pg existan o haya runner CLI.
- Auth multi-user / Vercel→Mini → fuera de alcance.

## Archivos tocados en repo (orquestador)

- `scripts/run-cron-universe-refresh.sh`
- `scripts/com.statsedge.cron-universe-refresh.plist`
- este evidence
