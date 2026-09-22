# FICHA-BRIEF-SURFACE-1 — brief en `/stock` honesto y no torpe

**Estado:** prep → programación cloud  
**Rama base:** `codex/statsedge-ui-polish` @ `4a51266`  
**Modelo:** Composer 2.5  
**Nota:** Rapid Review Astra T0–T2 ya quitó brief del critical path; el residual “Review/Astra” de producto es la **ficha** (`app/stock/[symbol]/`).

## Alcance (closable S–M)

1. Panel company-brief en StockClient: estados claros **loading / ok / vacío-error** (copy humano, sin spinner eterno ni layout jump brusco).
2. Expand/collapse usable; no bloquear chart/precio de la ficha.
3. Si ranking intl (RS país/tema) se muestra junto al brief: reusar honesty de `reviewRsDisplay` / mesa — no guiones mudos sin motivo.
4. Tests focalizados (render estados) + `./vfc` o vitest del ticket.

## No tocar

- Reintroducir brief síncrono en `/review`.
- Nocturno, scoring, auth, Europa yield, cold payload.

## Verify

Smoke Browser ficha AAPL `:3300` si Mini UP (orquestador); si no, LO QUE NO VERIFIQUÉ.
