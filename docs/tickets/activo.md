# Ticket activo — FILTER-SESSION-BACK-1

**Estado:** `prep`  
**Ticket:** `docs/tickets/FILTER-SESSION-BACK-1.md`  
**Rama prog:** `cursor/filter-session-back-a41e`  
**Base:** `codex/statsedge-ui-polish` @ `51f8a02` (tip idle · close MH-MINI-RPC-1 / #56)  
**Modelo:** Composer / herencia del chat Agent

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md @docs/tickets/FILTER-SESSION-BACK-1.md

Rama: `cursor/filter-session-back-a41e` desde `codex/statsedge-ui-polish` (ff-only a HEAD `51f8a02`+).
Modelo: Composer (o el indicado en el chat).

Alcance (S–M · tres síntomas dueño 2026-09-25):
1) Defaults menos agresivos en cold/reset — US primero (`DEFAULT_MARKETS`) se mantiene; suavizar núcleo/umbrales Balanceado percibidos (no reabrir opcionales UX-FILTERS-8).
2) Ficha→back: criterios de sesión sobreviven (`screenerSession` v4 · `saveSessionBeforeStockOpen` · restore sin auto-balanced no deseado). popstate hoy solo scroll.
3) Vista rápida / review queue: chartPreview del foco hidratado pronto (`chartPreviewHydratePlan` / `useReviewChartPreviewHydrate` / `RowPriceChart`) — sin batch 80 Caza.

Inventario y paths en el ticket. Vitest focalizado + `./vfc` si aplica.
No: scoring, FIRDS, Twelve Data, rediseño FILTER-SHELL.
Sin commit ni push. Devuelve plantilla de retorno del ticket.
```

## Notas orquestador

- Tip polish: `51f8a02`. Preferencia dueño: abrir EE.UU. primero (ya en config).
- Cola fricción UI previa (#52–#55) + MH Mini (#56) cerradas; este es el **Ahora**.
- No implementar en este hilo.
