# Ticket activo — REVIEW-MODAL-ABSENCE-1

**Estado:** `prep`  
**Ticket:** `docs/tickets/REVIEW-MODAL-ABSENCE-1.md`  
**Rama prog:** `cursor/review-modal-absence-a41e`  
**Base:** `codex/statsedge-ui-polish` @ `22a9805`+ (post close UX-EMPTY)  
**Modelo:** Composer / herencia del chat Agent

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md @docs/tickets/REVIEW-MODAL-ABSENCE-1.md

Rama: `cursor/review-modal-absence-a41e` desde `codex/statsedge-ui-polish` (ff-only a HEAD).
Modelo: Composer (o el indicado en el chat).

Alcance (S): Vista rápida — ausencia honesta (fricción #5).
1) QuickReviewModal: cola RS + fila «RS» de «El valor» → `reviewRsCell(canonicalRs(row))` (mismo copy que `/review`). Cero `"-"`/`–` mudos en RS.
2) Negocio del modal: sin inventar «opera en…» si no hay summary usable; empty corto alineado a FICHA Negocio / `companyBriefSummaryText`. Actividad/Mercado sin guion mudo.
3) Stretch si cabe: ChartIdentityCard Absent de RS → copy corto (no rediseñar tarjeta).
4) Tests focalizados + ./vfc si aplica.

No: company-brief en `/review`, scoring, nocturno, auth, unificar colas modal↔review, métricas no-RS salvo trivial.
Sin commit ni push. Devuelve plantilla de retorno del ticket.
```

## Notas orquestador

- Cola fricción: #1 ENTRY (#52) · #2 COLD (#53) · #4 UX-EMPTY (#54 / `9e39b88`) **hechos** → **#5 este** → MH-MINI-RPC (ops).
- Inventario: store `internal/review-astra-residual-2026-09-23.md`.
- Tip polish: post-`22a9805` + este activate. Feat UX-EMPTY: `9e39b88`. No implementar en este hilo.
