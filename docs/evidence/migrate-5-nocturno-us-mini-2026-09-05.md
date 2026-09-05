# MIGRATE-5 — evidencia nocturno US en Mini (2026-09-05)

## Alcance

`scripts/scan-universe.mjs --write` contra Postgres local del Mini (`STATSEDGE_DB_MODE=pg` + `DATABASE_URL` en `.env.local`), wrapper launchd y smoke acotado. Sin RPC historia/leaderboards.

## Cambios (repo, sin commit en esta sesión)

| Pieza | Path |
|---|---|
| Wrapper | `scripts/run-scan-universe-us.sh` |
| Plist plantilla | `scripts/com.statsedge.scan-universe-us.plist` |

### Wrapper

- `node --env-file=.env.local` (no `source .env.local`).
- Logs: `logs/scan-universe-us.log`, `logs/scan-universe-us.out.log`, `logs/scan-universe-us.err.log`.
- Overrides opcionales para smoke/manual:
  - `STATSEDGE_SCAN_UNIVERSE_LIMIT`
  - `STATSEDGE_SCAN_UNIVERSE_NOCTURNO_REAL=1`
  - `STATSEDGE_SCAN_UNIVERSE_SIN_RETENCION=1`
  - `STATSEDGE_SCAN_UNIVERSE_CONCURRENCY` (default 4)

### launchd (Mini)

| Pieza | Path |
|---|---|
| Plist instalado | `~/Library/LaunchAgents/com.statsedge.scan-universe-us.plist` |
| Script (repo) | `~/Statsedge-v0.1/scripts/run-scan-universe-us.sh` |
| Schedule | **05:00** hora local Mini (≈ **03:00 UTC**, alineado a GHA `scan-universe.yml`) |
| No solapa | universe-refresh **22:05**, scan-refresh **22:20** (mismos LaunchAgents MIGRATE-3/4) |

Instalación:

```bash
cp scripts/com.statsedge.scan-universe-us.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.statsedge.scan-universe-us.plist
```

## Verificación `scan-universe.mjs` + pg (Mini)

| Check | Resultado |
|---|---|
| Dry-run `--limit=5` | OK · población US leída vía adaptador pg |
| Ajustes al script | **Ninguno** — MIGRATE-4 ya cubre writes |

## Smoke `--write` acotado (Mini, 2026-09-05)

Comando:

```bash
cd ~/Statsedge-v0.1
STATSEDGE_SCAN_UNIVERSE_LIMIT=75 \
STATSEDGE_SCAN_UNIVERSE_NOCTURNO_REAL=1 \
STATSEDGE_SCAN_UNIVERSE_SIN_RETENCION=1 \
./scripts/run-scan-universe-us.sh
```

| Campo | Valor |
|---|---|
| Duración wall | **~11 s** (`10:46:54Z` → `10:47:05Z` en `logs/scan-universe-us.log`) |
| Duración script | 1.7 s scan+write (75 símbolos; extrapola ~0.8 min / ~5.6k) |
| `local_id` | `materialized:US:2026-09-05:t104656:o0:l75` |
| `scan_id` | `7f4e2e8f-bdd8-4652-b23d-c0466b7949d5` |
| Analizados | 75 |
| Pasaron cribado base | 43 |
| `row_count` / `scan_results` | **43** / **43** |
| Pasan preset balanced | 1 (completas) + 42 ligeras |
| Historia | **FALLÓ** (esperado): `RPC scan_symbol_history_latest_v1` no en pg |
| Retención | Saltada (`--sin-retencion`) |
| Exit | **0** |

### Corrección orquestador (mismo día)

`--nocturno-real` + `--limit=75` escribió un `materialized:US:…` **publishable** (`progress.status=complete`) que `readNightlyUsScan` tomaría como fuente diaria (43 filas) delante del US **3315** del 2026-09-03.

Acción: soft-delete (`deleted_at=now()`) de:

- `7f4e2e8f-bdd8-4652-b23d-c0466b7949d5` (`…t104656:o0:l75`)
- `81347a43-7b3c-4495-b927-ea8947a3f35c` (`…migrate4-smoke`)

Nocturno activo otra vez: `materialized:US:2026-09-03:t080211:o0:l5605` · **3315**.

**Regla:** smokes acotados **sin** `--nocturno-real` (prefijo `test:`) o soft-delete inmediato tras verify. Launchd full no usa esos overrides.

Consulta Postgres (mismo día):

```sql
SELECT local_id, row_count,
       (SELECT count(*) FROM scan_results WHERE scan_id = scans.id) AS result_rows
FROM scans
WHERE local_id LIKE 'materialized:US:2026-09-05%'
ORDER BY created_at DESC;
```

## Corrida nocturna full (documentada, no ejecutada en ticket)

Duración estimada en Mini: **~1–10 min** de scan (smoke extrapola &lt;1 min; GHA/medidas previas ~3.5 min) + margen Yahoo/red.

Comando manual o launchd sin overrides:

```bash
cd ~/Statsedge-v0.1
./scripts/run-scan-universe-us.sh
```

Equivalente directo:

```bash
node --env-file=.env.local --loader ./scripts/loader.mjs \
  scripts/scan-universe.mjs --write --concurrency=4
```

Población esperada: **~5.605** símbolos US investables → `materialized:US:YYYY-MM-DD:t<HHMMSS>:o0:l5605` (retención 7 noches automática).

## Gaps conscientes (fuera MIGRATE-5)

- `scan_symbol_history` / RPC leaderboards — ticket aparte.
- Mesa US en UI: smoke escribió **75 símbolos** del día; mesa “completa” requiere corrida full nocturna.
- US previo en producción/cloud seguía en **2026-09-03** antes de este smoke.

## Próximo paso dueño

- Dejar correr launchd **05:00** o lanzar full manual una noche.
- Tras full: validar mesa US con fecha del día (orquestador Browser Use).
- Opcional: desactivar GHA `scan-universe.yml` cuando Mini sea fuente única del nocturno US.
