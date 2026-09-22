# OPS-MINI-SMOKE-1 — Mini tunnel + Playwright smoke

Comando único para verificar que el entorno local de audit (`:3300` + Postgres Mini vía `:15432`) está listo y que las rutas críticas responden.

**Ritual diario (recomendado):** al abrir sesión de caza, un solo comando — ver `docs/ops-mini-daily.md` (`npm run ops:mini:daily` / `ops:mini:check`).

## Prerrequisitos

- Mac Mini encendido en LAN (`192.168.0.116`, usuario `cristian`).
- `.env.local` con `STATSEDGE_DB_MODE=pg`, `DATABASE_URL` → `127.0.0.1:15432`, y `STATSEDGE_ACCESS_TOKEN`.
- Build presente (`npm run build`) si usas `next start`.
- Playwright instalado (`npm i` + `npx playwright install chromium` si falla `Executable doesn't exist`).

## 1) Túnel Postgres Mini (`:15432`)

`:15432` **no** es Postgres local: es un forward SSH al Mini.

```bash
# Comprobar (no toca procesos existentes si el puerto ya escucha)
node scripts/ops/mini-tunnel.mjs

# Arrancar solo si :15432 está cerrado (no mata túnel existente)
node scripts/ops/mini-tunnel.mjs --start

# Equivalente manual documentado en ENV-DATA-ACCESS-1
ssh -f -N -L 15432:127.0.0.1:5432 cristian@192.168.0.116
nc -zv 127.0.0.1 15432
```

Variables opcionales: `STATSEDGE_MINI_SSH_HOST`, `STATSEDGE_MINI_SSH_USER`, `STATSEDGE_MINI_TUNNEL_PORT`.

## 2) Next aislado (`:3300`)

No pisar el dev del dueño en `:3000`.

```bash
PORT=3300 ./node_modules/.bin/next start -p 3300 >> /tmp/statsedge-3300.log 2>&1 &
curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:3300/
```

## 3) Smoke Playwright headless

```bash
# Falla rápido si :15432 o :3300 no están (sin colgar)
node scripts/ops/ops-mini-smoke.mjs

# Intentar levantar túnel y luego smoke
node scripts/ops/ops-mini-smoke.mjs --start-tunnel

# Solo túnel
node scripts/ops/ops-mini-smoke.mjs --tunnel-only
```

Salida:

| Artefacto | Ruta |
|-----------|------|
| Resumen JSON | `research/ops-mini-smoke-1/smoke-summary.json` |
| PNG home US | `research/ops-mini-smoke-1/home-us.png` |
| PNG Caza | `research/ops-mini-smoke-1/caza.png` |
| PNG review AAPL | `research/ops-mini-smoke-1/review-aapl.png` |

Si el store del repo no es escribible, cae a `/tmp/statsedge-ops-mini-smoke-1/`.

### Checks

1. **Home US** — truth line con mesa real (no `0/0`).
2. **Caza** — sparks/SVG en cinta (`huntTapeSpark` en HuntTape; mesa Auditoría usa `miniSparkline`). Requiere `sparks > 0` o `svgs > 0` tras hydrate chart-preview (no basta truth line sola).
3. **`/review?symbol=AAPL`** — chart sale de «Cargando histórico…» (canvas o estado vacío explícito, no loading infinito).

Timeout global: `SMOKE_TIMEOUT_MS` (default 180000). Precheck HTTP: `SMOKE_PRECHECK_MS` (default 4000).

## Errores típicos

| Síntoma | Causa | Acción |
|---------|-------|--------|
| `Mini tunnel not listening` | `:15432` cerrado | `node scripts/ops/mini-tunnel.mjs --start` |
| `Next app not listening` | `:3300` caído | `next start -p 3300` |
| Home `0/0` con túnel OK | DB sin scan materializado | verificar `DATABASE_URL` y mesa US en Mini |
| Review stuck loading | `/api/chart` lento o caído | revisar logs Next + red |

Ver también: `ENV_DATA_ACCESS_1_REPORT.md`, `docs/evidence/ops-mini-1-gha-rpc-2026-09-06.md`.
