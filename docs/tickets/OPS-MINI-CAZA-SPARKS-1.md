# OPS-MINI-CAZA-SPARKS-1 — daily smoke: Caza debe ver sparks/SVG

**Estado:** prep → programación cloud  
**Rama base:** `codex/statsedge-ui-polish` @ `fe4a051` (post #46)  
**Modelo:** Composer 2.5  
**Síntoma:** `ops:mini:daily` PASS 2026-09-21 — Caza `huntRows:525` pero `sparks/svgs:0` (pasa solo por truth line).

## Alcance (closable S)

1. Diagnosticar: ¿selector smoke (`.miniSparkline`) desalineado del DOM real de HuntTape / chart-preview? ¿o hydrate no pinta SVG en Caza tras daily?
2. Arreglar **una** de las dos: selectors en `scripts/ops/mini-smoke-playwright.mjs` **o** hydrate/DOM de sparks en cinta Caza (reusar CAZA-SPARKS-SCROLL / chart-preview).
3. Criterio: en smoke Caza, `svgs > 0` **o** `sparks > 0` con mesa US hidratada (no solo truth).
4. Tests si tocas lib; `./vfc` o vitest del cambio.

## No tocar

Cold payload (#46 cerrado), nocturno, scoring, auth, Review/Astra (siguiente cola).
