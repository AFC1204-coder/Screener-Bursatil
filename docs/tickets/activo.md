# Ticket activo — REVIEW-PERSIST-PREVIEW-1 (prep)

**Estado:** prep  
**Previo:** REVIEW-CHART-PARALLEL-1 ACCEPT parcial (sin diff producto)  
**Ticket:** `docs/tickets/REVIEW-PERSIST-PREVIEW-1.md`  
**Rama:** `codex/statsedge-ui-polish`

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/REVIEW-PERSIST-PREVIEW-1.md

Rama: codex/statsedge-ui-polish.
Modelo: Grok 4.7 High (o Composer 2.5 High si Grok no disponible).

Alcance: conservar chartPreview en la cola Rapid Review al persistir (evitar strip por cuota cuando sea posible). Tras DEFER no hay brief que regenere previews. No tocar contrato reviewSession ni reintroducir company-brief.

MUST NOT TOUCH: reviewSession identity/signature, hydrate/brief, A1-S, scans API, refactor storage amplio.

PASS: más filas conservan preview al reabrir, o degradación honesta solo si presupuesto imposible; tests PASS. Sin commit ni push.

Devuelve plantilla de retorno del orquestador.
```
