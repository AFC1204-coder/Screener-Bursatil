# Ticket activo — CAZA-CHARTPREVIEW-ENTRY-1

**Estado:** prep · listo para Agent chat  
**Rama base:** `codex/statsedge-ui-polish` @ `ae1438a`  
**Rama trabajo:** `cursor/caza-entry-batch-a41e`  
**Modelo:** Composer  
**Ticket:** `docs/tickets/CAZA-CHARTPREVIEW-ENTRY-1.md`

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/CAZA-CHARTPREVIEW-ENTRY-1.md
@docs/tickets/activo.md

Eres programación StatsEdge (NO orquestador). Base polish @ ae1438a.
Rama: cursor/caza-entry-batch-a41e
Modelo: Composer

Ticket CAZA-CHARTPREVIEW-ENTRY-1 (S) — residual #51: al ENTRAR a Caza
aún puede haber POST chart-preview de 80 (unión mesa/pagedRows o carrera
sin viewport). Scroll ya acota ~38. En modo Caza el plan de hydrate no
debe unir pagedRows/quickReview; primera pasada = viewport+buffer (o
default ~25 sin medida). Touch: page.jsx plan + scansChartPreviewHydrate
(+ HuntTapeView solo si hace falta emitir default a tiempo).
No scoring, cold, Review brief, auth, FIRDS.

Tests: vitest cazaChartPreviewScrollHydrate + scansChartPreviewHydrate*
(+ ./vfc si aplica). Smoke lo hace el orquestador.

Commit+push solo en cursor/caza-entry-batch-a41e (+ PR draft si cloud).
SIN merge a polish. Plantilla de retorno.
```

## Notas orquestador

- Residual smoke VIEWPORT-1 (#51): entry batch 80; scroll OK.
- Tras retorno: `git diff`, tests, smoke Browser Use cold entry Caza → commit polish si OK.
- No scoring / nocturno / auth / FIRDS → no gate dueño salvo sorpresa.
