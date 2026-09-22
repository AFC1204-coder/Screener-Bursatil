# EUROPA-SCAN-SECONDARY-DEPTH-1 — más profundidad de lote en secundarios EU

**Estado:** prep → programación cloud  
**Rama base:** `codex/statsedge-ui-polish` @ `c0b3ca9`  
**Modelo:** Composer 2.5  
**Contexto:** Truth + aviso curated + shadow-europe thin ya cerrados. FIRDS **on** sigue siendo gate dueño/datos — este ticket **no** activa flags.

## Alcance (closable S)

1. En `SCAN_CRON_GROUPS`, subir `limit`/`perMarket` de `EUROPE_SECONDARY_MARKETS` de 24 → **36** (o documentar otro techo medido ≤48 si hay evidencia en docs/cron). Priority markets se quedan como están salvo comentario.
2. Tests en cronPlan / scan groups: secundarios en 36; priority sin cambio accidental.
3. Comentario breve: profundidad de lote curated/scan ≠ activar ESMA_FIRDS.
4. `./vfc` o vitest del ticket.

## No tocar

- `ESMA_FIRDS_ENABLED` / `FCA_FIRDS_ENABLED`
- SHADOW_FIRDS caps agresivos
- Nocturno US, scoring, auth
