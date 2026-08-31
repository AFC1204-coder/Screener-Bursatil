# Ticket activo — MET-4e (backfill + verify persistencia)

## Estado orquestador

- Probe: nocturno US **sin** `weeksAboveSma*` (0/200).
- Script listo: `scripts/patch-scan-trend-support.mjs` (dry-run por defecto).
- **Gate datos:** hace falta tu **OK --write** para parchear `scan_results`; luego smoke MET-4c/4d.

## Prompt (si delegas el write a Agent chat)

```
@docs/tickets/activo.md
@docs/tickets/MET-4e-verify-persistencia.md
@scripts/patch-scan-trend-support.mjs

Rama: codex/statsedge-ui-polish
MIGRATE fuera.
Solo si el dueño dijo OK --write: ejecuta el patch con --write sobre el nocturno US,
luego resume cobertura (withField / above8). Sin commit/push.
Smoke visual lo hace el orquestador.
```

Si el dueño solo dice **OK write** en este chat, el orquestador ejecuta el write y el smoke.
