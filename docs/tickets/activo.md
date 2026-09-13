# Ticket activo — Wave5

**Estado:** en curso  
**Rama:** `codex/statsedge-ui-polish` @ origin sync  
**Cerrados Wave5:** REVIEW-REFETCH-1 (diag) · REVIEW-BRIEF-CRITICAL-1 (design + NEEDS ASTRA)  
**Abierto:** SCANS-RS-HYDRATE-1 (invest)  
**Aparcados:** SCANS-CHARTPREVIEW-1 · REACT-COMMIT-PERF-1 · remount scans (post-REFETCH) · impl brief (post-Astra)

Tickets:
- `docs/tickets/SCANS-RS-HYDRATE-1.md` — activo
- `docs/tickets/REVIEW-REFETCH-1.md` — hecho
- `docs/tickets/REVIEW-BRIEF-CRITICAL-1.md` — design OK

---

## Prompt para Agent chat (SCANS-RS-HYDRATE-1 · Composer 2.5 High)

```
@docs/tickets/SCANS-RS-HYDRATE-1.md

Rama: codex/statsedge-ui-polish (HEAD sync origin).
Modelo: Composer 2.5 High.

Alcance: INVESTIGATE ONLY — por qué hydrateRs=1 añade decenas de s al TTFB frío de /api/scans. Medir breakdown (DB / hydrate RS / stringify / gzip). Proteger readers y semántica RS canónica. Hipótesis de fix mínimo; no cambio estructural de RS.

MUST NOT TOUCH: scoringEngine, RS canonical writers/readers semántica, assertDecisionGrade, nocturno, reviewSession, gzip 91ae6e4, FILTER-ANNOTATION.

PASS: reporte con timings reproducibles + candidatos rankeados; STOP/ASTRA si cambia significado RS.

Tests: nc -zv 127.0.0.1 15432; npx vitest run tests/scansApiRsHydrateDefer.test.js

Sin commit ni push. Devuelve plantilla de retorno del orquestador.
```
