# Ticket activo — UX-EMPTY-HONEST-1

**Estado:** `prep`  
**Ticket:** `docs/tickets/UX-EMPTY-HONEST-1.md`  
**Rama prog:** `cursor/ux-empty-honest-a41e`  
**Base:** `codex/statsedge-ui-polish` @ `8d1ccac`  
**Modelo:** Composer / herencia del chat Agent

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md @docs/tickets/UX-EMPTY-HONEST-1.md

Rama: `cursor/ux-empty-honest-a41e` desde `codex/statsedge-ui-polish` (ff-only a HEAD).
Modelo: Composer (o el indicado en el chat).

Alcance (S–M): empty/loading/error humanos en Caza + mesa (patrón FICHA-BRIEF / truth honesty).
1) Caza sparks/cola — HuntTapeSparkline + resolveHuntTapeSparkStatus + HuntTapeView (no `–` mudo / pending eterno / titles lab).
2) Mesa truth/empty — buildScreenerTruthLine + MesaEmptyCard / mesaEmptyState + resultsEmptyLabel (distinguir sin-escaneo vs 0-filtro).
3) HuntCardRail pending si hace falta feedback humano.
4) Review + ficha solo residual obvio (grep); no Astra rewrite.

No: FIRDS, scoring, auth, hydrateRs cold, chart-preview batch.
Tests + ./vfc si aplica. Sin commit ni push. Devuelve plantilla de retorno del ticket.
```

## Notas orquestador

- Cola fricción: #1 ENTRY (#52) · #2 COLD (#53) **hechos** → **#4 este** → #5 Review/Astra residual (prep paralelo) · MH Mini RPC ops.
- Idle tip previo: `8d1ccac`. No implementar en este hilo.
