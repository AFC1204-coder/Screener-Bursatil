# REVIEW-CHART-PREFETCH-N1

**Estado:** hecho (ACCEPT · 2026-09-14)  
**OWNER:** Cursor / Composer 2.5 High  
**PRIORITY:** P1  
**MODE:** IMPLEMENTACIÓN  
**Cierre:** cache/dedupe `lib/chartFetchCache.js` + prefetch N±1 en Review; 0 brief.

## Smoke orquestador (`:3300` next dev)

- Foco **AVAH**: además de su `/api/chart`, prefetch **ATAI** + **PSO** (N+1/N−1) y rs-weekly vecinos.  
- Nav AVAH→**ATAI**: **0** refetch chart ATAI (cache hit); solo nuevo prefetch **ATRC**.  
- **0** `company-brief`.  
- Tests: 68 PASS (reviewSession + chartParallel + chartFetchCache + reviewChartPrefetch + useChartDataModel).
