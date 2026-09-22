# SCREENER-TRUTH-MARKET-PCT-1 — % / conteo por mercado en truth line

**Estado:** prep → programación cloud  
**Rama base:** `codex/statsedge-ui-polish` @ `b559186`  
**Modelo:** Composer 2.5  
**Contexto:** Plan item 5 residual tras Europa honesty + curated aviso. Sin inventar % si no hay dato cableado.

## Alcance (closable S–M)

1. Cuando la mesa tiene **≥2 mercados** (p. ej. Europa / Global parcial), añadir a truth line o peek un segmento compacto de **conteo por mercado** (filas analizadas o cargadas) — p. ej. `GB 23 · DE 40 · …` — usando datos ya en scan/rows (`scannedMarketsFromScan` / row country).
2. Si se puede calcular cobertura vs selección sin inventar universo FIRDS: `% mercados de la selección presentes en mesa` (no “% del universo oficial”).
3. Reusar `screenerTruthLine` / `marketAvailability`; copy corto; no saturar móvil (compact / peek).
4. Tests focalizados + `./vfc` o vitest del ticket.

## No tocar

FIRDS on, cold payload, ficha brief, nocturno US, scoring, auth.
