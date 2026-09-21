# Ritual diario Mini — un comando al abrir caza

Antes de confiar en la mesa o en Caza, verifica que el entorno local apunta al Mac Mini y que Next aislado responde.

## Al abrir sesión de caza → un comando

```bash
npm run ops:mini:daily
```

Equivale a: **preflight rápido** (túnel `:15432`, hints de `.env.local`, HTTP `:3300`) + **smoke Playwright** (home US, Caza, review AAPL). Falla en segundos si el túnel o Next no están — no espera 3 min de timeout.

### Solo preflight (sin Playwright)

```bash
npm run ops:mini:check
```

Útil para comprobar túnel + env + `:3300` antes de arrancar el navegador.

### Si el túnel SSH está cerrado

```bash
npm run ops:mini:daily -- --start-tunnel
```

Solo intenta `ssh -f -N` cuando `:15432` no escucha; **no mata** túneles existentes.

## Prerrequisitos (una vez)

| Pieza | Qué |
|-------|-----|
| Mac Mini | Encendido en LAN (`192.168.0.116`, usuario `cristian`) |
| `.env.local` | `STATSEDGE_DB_MODE=pg`, `DATABASE_URL` → `127.0.0.1:15432`, `STATSEDGE_ACCESS_TOKEN` |
| Build | `npm run build` si usas `next start` |
| Next `:3300` | Instancia aislada (no pisar `:3000` del dueño) |
| Playwright | `npx playwright install chromium` si falta el binario |

Arrancar Next aislado (manual):

```bash
PORT=3300 ./node_modules/.bin/next start -p 3300 >> /tmp/statsedge-3300.log 2>&1 &
```

## Artefactos del smoke diario

| Artefacto | Ruta |
|-----------|------|
| Resumen JSON | `research/ops-mini-harden-1/smoke-summary.json` |
| PNG home US | `research/ops-mini-harden-1/home-us.png` |
| PNG Caza | `research/ops-mini-harden-1/caza.png` |
| PNG review AAPL | `research/ops-mini-harden-1/review-aapl.png` |

Si el repo no es escribible, cae a `/tmp/statsedge-ops-mini-harden-1/`.

## Errores típicos

| Síntoma | Causa | Acción |
|---------|-------|--------|
| `Túnel Postgres del Mini no escucha` | `:15432` cerrado | `npm run ops:mini-tunnel:start` o `npm run ops:mini:daily -- --start-tunnel` |
| `STATSEDGE_DB_MODE no es «pg»` | Modo Supabase activo | En `.env.local`: `STATSEDGE_DB_MODE=pg` |
| `DATABASE_URL usa puerto 5432` | Apunta a Postgres local, no al túnel | `…@127.0.0.1:15432/statsedge` |
| `Next aislado no escucha en :3300` | `next start` no corrido | Comando que imprime el preflight (`PORT=3300 … next start -p 3300`) |
| Home `0/0` con preflight OK | Mesa sin materializar en Mini | Revisar scan nocturno / `DATABASE_URL` en el Mini |
| Review stuck loading | `/api/chart` lento | Logs en `/tmp/statsedge-3300.log` |

## Comandos relacionados

| Comando | Uso |
|---------|-----|
| `npm run ops:mini:check` | Preflight sin Playwright |
| `npm run ops:mini:daily` | Ritual completo |
| `npm run ops:mini-smoke` | Smoke directo (sin capa daily) |
| `npm run ops:mini-tunnel` | Solo comprobar `:15432` |

Detalle del smoke original: `docs/ops-mini-smoke.md`.
