# Ticket activo — REVIEW-HYDRATE-DEFER-1 (prep)

**Estado:** prep · Astra A1-S / A2-CHART / A3-OMIT / A5-ABSENT  
**Ticket:** `docs/tickets/REVIEW-HYDRATE-DEFER-1.md`  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 High

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/REVIEW-HYDRATE-DEFER-1.md

Rama: codex/statsedge-ui-polish.
Modelo: Composer 2.5 High.

Alcance: sacar company-brief del camino síncrono de Rapid Review.
Astra vinculante: A1-S (métricas = snapshot sesión) · A2-CHART (banner = OHLC T1; brief no bloquea) · A3-OMIT (no merge RS quality/speculation/rsRating del brief) · A5-ABSENT (Sin dato + motivo).

MUST NOT TOUCH: reviewSession contrato, scoring/RS writers, nocturno, recalc métricas desde chart, prefetch briefs.

PASS: 0 company-brief hasta shell usable; banner solo por chart T1; tests PASS; sin commit ni push.

Devuelve plantilla de retorno del orquestador.
```
