# MET-1b — Implementación RS global privado (`statsedge-private-global-rs-usd-v1`)

**Rama:** `codex/statsedge-ui-polish`  
**Autorización dueño:** 2026-08-28 (impl. explícita; addendum §13 condición 2 cumplida)  
**Spec obligatorio:** `docs/spec-rs-global-multi-mercado-fx.md` (aceptado `877c318`)  
**Modelo:** MiniMax M3 o Composer (high). Juicio puntual FX/universo → GLM-5.2. No Fable salvo bloqueo.

## Objetivo

Motor semanal multi-mercado con FX → `rs_weekly_snapshots` / `rs_weekly_items` bajo `statsedge-private-global-rs-usd-v1`. Pin explícito en lectura (`lib/globalRs.js` / hidratación) para línea **privada**. Línea pública futura sigue en `statsedge-us-equity-rs-v1` (env/constante separada, default privado = global).

## Fases (orden estricto)

### Fase 0 — Prep (sin pin, sin cambiar RS visible)

1. Constantes: `PRIVATE_GLOBAL_RS_ENGINE_VERSION = statsedge-private-global-rs-usd-v1`; mantener US engine congelado.
2. Ingesta FX: ~10 pares Yahoo `{CCY}USD=X` → `daily_bars` (o tabla dedicada documentada). `fxMaxAge=5` sesiones.
3. Backfill barras intl: listas curadas HK/CA/EU15/AU/JP desde `lib/universes.js` (~830); ≥261 barras; script idempotente.
4. GBX→GBP en conversión (precedente `company-brief`); test.

### Fase 1 — Motor (dry-run primero)

5. Extender o fork de `scripts/rs-universe.mjs` → p.ej. `scripts/rs-global-private.mjs`:
   - Universo: US equity (misma población que motor US) + intl curado spec.
   - Fórmula 40/20/20/20 sobre `priceInBase = local × FX`; US `fx=1`.
   - Exclusiones + motivo persistido (`insufficient-bars`, `discontinuous`, `fx-unavailable`, `fx-stale`, `fx-discontinuous`, `not-in-universe`).
   - `stats` en snapshot: universe_snapshot_id US, git sha universes, conteos por mercado, hash símbolos.
6. `--dry-run` obligatorio antes de `--write`. Primera `--write` = **una** semana, manual, verificada por orquestador.

### Fase 2 — Lectura + UX (pin al final)

7. Pin `engine_version` canónico en `lib/globalRs.js` (sustituir «latest-wins» para producto privado). Test que falle si cambia sin tocar constante.
8. Hidratación batch (`readWeeklyRsForSymbols`) respeta pin.
9. Motivo de exclusión llega a `canonicalRs()` / UI («–» + texto, no mudo).
10. Disclosure: tooltip/cabecera «RS global · USD · universo privado curado» + N/M mercados (mínimo viable).

### Fase 3 — Verificación antes de pin activo

11. Tests: GBX, FX forward-fill, pin engine, motivo exclusión, scoring untouched (`rsGlobalPct` / scores no mutados).
12. **No activar pin en producción** hasta smoke orquestador (Browser Use): US fila con RS; intl computable (p.ej. `0005.HK`) con número; intl no computable con motivo; tabla = review = ficha mismo número.

## Fuera de alcance

- Cron (MET-1c).
- `scan_results`, scoring, `lib/relativeStrength.js`, finalización percentiles.
- Backfill histórico as-of FX (prohibido spec).
- MET-2/3, VCP, market-health/leaderboards.
- Commit/push (orquestador).

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
(comando + resultado)
## LO QUE NO VERIFIQUÉ
(dry-run vs write; si --write, qué snapshot_id)
Sin commit ni push.
```
