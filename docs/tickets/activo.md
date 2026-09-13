# Ticket activo — Wave5 (prep · agentes no lanzados)

**Estado:** prep  
**Rama:** `codex/statsedge-ui-polish` @ `1748738` (sync origin)  
**Wave:** SCANS-RS-HYDRATE-1 ∥ REVIEW-REFETCH-1 · REVIEW-BRIEF-CRITICAL-1 (lectura)  
**Aparcados:** SCANS-CHARTPREVIEW-1 · REACT-COMMIT-PERF-1  
**Checkpoint:** revert FILTER-ANNOTATION-1 `c55a648` · gzip KEEP `91ae6e4`

Tickets:
- `docs/tickets/SCANS-RS-HYDRATE-1.md`
- `docs/tickets/REVIEW-REFETCH-1.md`
- `docs/tickets/REVIEW-BRIEF-CRITICAL-1.md`

---

## Prompt para Agent chat (SCANS-RS-HYDRATE-1 · Composer 2.5 High)

```
@docs/tickets/SCANS-RS-HYDRATE-1.md

Rama: codex/statsedge-ui-polish (HEAD sync origin ≥ 1748738).
Modelo: Composer 2.5 High.

Alcance: INVESTIGATE ONLY — por qué hydrateRs=1 añade decenas de s al TTFB frío de /api/scans. Medir breakdown (DB / hydrate RS / stringify / gzip). Proteger readers y semántica RS canónica. Hipótesis de fix mínimo; no cambio estructural de RS.

MUST NOT TOUCH: scoringEngine, RS canonical writers/readers semántica, assertDecisionGrade, nocturno, reviewSession, gzip 91ae6e4, FILTER-ANNOTATION.

PASS: reporte con timings reproducibles + candidatos rankeados; STOP/ASTRA si cambia significado RS.

Tests: nc -zv 127.0.0.1 15432; npx vitest run tests/scansApiRsHydrateDefer.test.js

Sin commit ni push. Devuelve plantilla de retorno del orquestador.
```

---

## Prompt para Agent chat (REVIEW-REFETCH-1 · Grok 4.7 High)

```
@docs/tickets/REVIEW-REFETCH-1.md

Rama: codex/statsedge-ui-polish (HEAD sync origin ≥ 1748738).
Modelo: Grok 4.7 High.

Alcance: identificar 1–2 /api/scans al reabrir Rapid Review con sesión válida. Impl solo si causa inequívoca y localizada sin tocar contrato reviewSession. Si no, solo diagnóstico.

MUST NOT TOUCH: lib/reviewSession.js contrato, scoring/RS, company-brief, scans hydrate/gzip.

PASS: inventario caller+motivo; si patch → 0 scans innecesarios + reviewSession tests PASS + sin regresión cola/foco/identity.

Tests: npx vitest run tests/reviewSession.test.js tests/screenerReviewLaunch.test.js

Sin commit ni push. Devuelve plantilla de retorno del orquestador.
```

---

## Prompt para Agent chat (REVIEW-BRIEF-CRITICAL-1 · Composer 2.5 High)

```
@docs/tickets/REVIEW-BRIEF-CRITICAL-1.md

Rama: codex/statsedge-ui-polish (HEAD sync origin ≥ 1748738).
Modelo: Composer 2.5 High.

Alcance: DESIGN + PROBE — mapear cómo sacar company-brief completo del critical path de Rapid Review (fila canónica → charts → brief diferido). NO implementación estructural. Astra solo si contrato ambiguo.

Restricción paralelismo: lectura estática OK; NO instrumentar/modificar app/review/* hasta que REVIEW-REFETCH-1 cierre.

MUST NOT TOUCH: scoring/RS canónico, prefetch masivo de briefs, nocturno.

PASS: mapa critical path + tabla campo→fuente→fase + ambigüedades; cero PR estructural.

Sin commit ni push. Devuelve plantilla de retorno del orquestador.
```
