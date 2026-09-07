# Ticket activo — idle (IPO-UX-D2 código cerrado; ops backfill pendiente)

**Estado:** idle orquestador  
**Rama:** `codex/statsedge-ui-polish`  
**Último cerrado:** IPO-UX-D2 (ancla persistida en proyección + script dry-run)  
**Siguiente:** ops `--write` / nocturno (si dueño OK) → smoke % · luego **IPO-UX-E**

Sin ticket de programación activo.

## Ops pendiente

```bash
node --env-file=.env.local --loader ./scripts/loader.mjs scripts/backfill-ipo-anchor.mjs
# OK dueño:
node --env-file=.env.local --loader ./scripts/loader.mjs scripts/backfill-ipo-anchor.mjs --write
```

Sin write, la mesa sigue con «—» en D hasta un nocturno nuevo.
