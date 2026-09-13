# REVIEW-BRIEF-CRITICAL-1

**Estado:** hecho (ACCEPT DESIGN · 2026-09-13) · **NEEDS ASTRA** A1–A3/A5  
**OWNER:** Cursor / Composer 2.5 High  
**PRIORITY:** P1 (Wave5)  
**MODE:** DESIGN + PROBE — cerrado  
**Siguiente:** `docs/tickets/ASTRA-REVIEW-BRIEF-T0T1T2.md` → luego REVIEW-HYDRATE-DEFER-1  
**Nota:** REVIEW-REFETCH-1 ya cerrado; OK instrumentar `app/review/*` tras Astra.

## PROBLEM

En Rapid Review, el camino crítico percibido (ticker nuevo → estable ~2,8 s mediana; p95 ~6,1 s) está dominado por `/api/company-brief` (~2–6 s, 118–307 KB). Astra ya decidió: fila canónica de sesión → charts → brief pesado fuera del critical path → después prefetch N+1/caché. Falta el mapa concreto sobre código actual.

## EVIDENCE

- QUICK_REVIEW_PERF / Rapid Review audit: 617 Stage2; click→shell+RS ~430 ms mediana; brief es el cuello en ticker nuevo.
- `/api/chart` ~30–730 ms (no es el principal).
- No existe prefetch N+1 hoy.
- Decisión Astra (handoff Wave4): no prefetchear briefs completos para ocultar el problema.

## SCOPE

1. Mapear call graph actual: Review / quick review → qué datos bloquean first paint útil vs enrichment.
2. Probe (lectura + mediciones de red/timing; **sin** rediseñar UI): cuándo se dispara `company-brief`, qué campos usa el shell crítico vs panel secundario.
3. Proponer corte de contrato:
   - inmediato: fila canónica sesión (stage/RS/pattern/scoring/calidad)
   - paralelo: charts/series
   - diferido: descripción/financieros/auditoría extensa del brief
4. Listar archivos y riesgos de ausencia/calidad (emptyFallback, estimated, dataQuality).
5. Entregable: diseño + secuencia de tickets de implementación futuros (no este).

## MUST NOT TOUCH (escritura)

- `app/review/*` **si REVIEW-REFETCH-1 no ha cerrado** y el probe requiere instrumentar esa superficie → esperar o limitar a lectura estática.
- Scoring engine, RS canonical, nocturno, assertDecisionGrade
- Prefetch masivo de briefs
- Cambios de producto en ranking

## PASS CRITERIA

- Diagrama/mapa escrito: critical path actual vs propuesto.
- Tabla campo → fuente (sesión | chart API | brief | otro) → fase (T0/T1/T2).
- Lista de ambigüedades de contrato; marcar cuáles necesitan Astra.
- Cero PR de implementación estructural en este ticket.
- Si se añade probe temporal, revertido o detrás de flag local no comiteado sin OK orquestador.

## TESTS

- Ninguno de producto requerido si solo docs.
- Si se escribe harness de probe: documentar comando; no romper CI.

## STOP CONDITION

- Decisión ambigua de contrato (qué es “canónico” vs “brief”) → **NEEDS ASTRA**, no inventar.
- Tentación de “ya que estoy, implemento el defer” → STOP.
- Tocar refetch/sesión Review en conflicto con REFETCH-1 → STOP.

## DEPENDENCIES

- Preferible: REVIEW-REFETCH-1 cerrado antes de instrumentar `app/review/*`.
- Lectura estática de `app/review`, `app/api/company-brief`, consumidores de brief: OK en paralelo desde ya.
- Decisión Astra previa (handoff) es autoridad de dirección; este ticket la aterriza en archivos reales.

## APARCADO RELACIONADO

- Prefetch N+1 / cache compartida = ticket futuro post-diseño.
- SCANS-CHARTPREVIEW-1 / REACT-COMMIT-PERF-1 = fuera.
