# Ticket activo — CAZA-CHARTPREVIEW-VIEWPORT-1

**Estado:** prep · listo para Agent chat  
**Rama base:** `codex/statsedge-ui-polish` @ `6eb6456`  
**Rama trabajo:** `cursor/caza-viewport-cap-a41e`  
**Modelo:** Composer  
**Ticket:** `docs/tickets/CAZA-CHARTPREVIEW-VIEWPORT-1.md`

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/CAZA-CHARTPREVIEW-VIEWPORT-1.md
@docs/tickets/activo.md

Eres programación StatsEdge (NO orquestador). Base polish @ 6eb6456.
Rama: cursor/caza-viewport-cap-a41e
Modelo: Composer

Ticket CAZA-CHARTPREVIEW-VIEWPORT-1 (S) — en Caza, limitar hydrate/POST
/api/scans/chart-preview a viewport visible + buffer (overscan). Hoy la
ventana llega a 80 filas; apretar a lo visible + buffer. Reusar
huntRowsForChartPreviewHydrate / computeHuntChartPreviewHydrateStart /
evento viewport. No tocar scoring, cold payload, Review brief, auth.

Tests: vitest cazaChartPreviewScrollHydrate + scansChartPreviewHydrate*
(+ ./vfc si aplica). Smoke lo hace el orquestador.

Commit+push solo en cursor/caza-viewport-cap-a41e (+ PR draft si cloud).
SIN merge a polish. Plantilla de retorno.
```

## Notas orquestador

- Residual backlog: Caza chartPreview viewport-cap (antes aparcado).
- Tras retorno: `git diff`, tests, smoke Browser Use Caza → commit polish si OK.
- No scoring / nocturno / auth → no gate dueño salvo sorpresa.
