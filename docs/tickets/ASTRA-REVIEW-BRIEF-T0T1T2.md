# ASTRA — Rapid Review · contrato T0/T1/T2 (post REVIEW-BRIEF-CRITICAL-1)

**Fecha:** 2026-09-13  
**Contexto:** diseño ACCEPT; impl bloqueada a estas decisiones.  
**NO pedir código.** Respuestas cerradas + 1 línea de razón cada una.

## Hechos ya verificados (no reabrir)

1. Click → shell RS/etapa desde fila de sesión ~430 ms mediana.
2. `hydrateReviewRow` bloquea en `GET /api/company-brief` (2–6 s, 118–307 KB) antes de quitar «Cargando histórico y métricas…».
3. Gate `alreadyUsable` exige `chartPreview` + `perf3m` + `relativeVolume`. Cola persistida puede **strip** `chartPreview` por cuota → brief obligatorio casi siempre.
4. Chart ya puede ir por `/api/chart` + `/api/rs-weekly` en paralelo (RowPriceChart); hoy llega tarde porque el banner/stable esperan el brief.
5. RS mostrado en Review debe seguir `canonicalRs(row)` / `weeklyRs*` de sesión — **no** `brief.relativeStrength.rsRating` (el merge actual escribe scores del brief; hay que cortarlo en impl).
6. REVIEW-REFETCH-1 cerrado: 0 `/api/scans` al reabrir Review; residual = remount de `/`.
7. Decisión Wave4 Astra previa: fila canónica → charts → brief fuera del critical path; **no** prefetch masivo de briefs.

## Preguntas (NEEDS ASTRA)

### A1 — Autoridad de métricas técnicas en Review
Tras quitar brief del path síncrono, ¿de dónde salen `perf3m` / vol / SMA / drawdown del grid?

| Opción | Significado |
|---|---|
| **A1-S** | Snapshot nocturno de la fila de sesión. Badge/hint «dato del scan» si hace falta. |
| **A1-C** | Recalcular desde barras de `/api/chart` en T1 (puede divergir de la mesa). |
| **A1-H** | Sesión en T0; recalc opcional en T1 solo si faltan finitos en fila. |

**Recomendación orquestador:** **A1-H** (mínimo cambio, honesto con ausencia).

### A2 — Definición de «stable» / fin del banner
¿Cuándo desaparece «Cargando histórico…» y qué medimos como stable en perf?

| Opción | Significado |
|---|---|
| **A2-SHELL** | Shell usable: RS/etapa/métricas de sesión visibles; sin banner de brief. Chart puede seguir cargando. |
| **A2-CHART** | Banner solo mientras falta OHLC T1 (`/api/chart`); brief nunca bloquea. |
| **A2-FULL** | Todo listo incluido brief (status quo — rechazar). |

**Recomendación orquestador:** **A2-CHART** (banner atado a T1; brief fuera).

### A3 — RS Quality / speculationRisk en Review
Hoy el brief los recalcula; el grid de Review no los pinta. ¿Futuro?

| Opción | Significado |
|---|---|
| **A3-OMIT** | No mostrar en Review; no mergear desde brief. |
| **A3-SESSION** | Si la fila de scan los trae, mostrar; si no, ausencia canónica. |
| **A3-BRIEF** | Seguir recalculando vía brief (mantiene acoplamiento — evitar). |

**Recomendación orquestador:** **A3-OMIT** ahora; **A3-SESSION** solo si producto quiere chip explícito.

### A5 (corto) — Fila sin `weeklyRs*` hidratado
¿Ausencia canónica en Review o empujar a Ficha?

| Opción | Significado |
|---|---|
| **A5-ABSENT** | Mostrar «Sin dato» / motivo `rsCanonical` en Review. |
| **A5-FICHA** | CTA a `/stock` para completar. |

**Recomendación orquestador:** **A5-ABSENT** (coherente con mesa).

### A4 (producto menor — default si no contestas)
Logo faltante: iniciales en T0; no fetch ligero solo por favicon.

## Formato de respuesta esperado

```
A1: …
A2: …
A3: …
A5: …
Notas (≤5 líneas): …
Siguiente ticket de impl autorizado: REVIEW-HYDRATE-DEFER-1 sí/no
```

## Tras Astra → secuencia (orquestador)

1. `REVIEW-HYDRATE-DEFER-1` — quitar brief síncrono; banner según A2; no merge RS brief  
2. `REVIEW-CHART-PARALLEL-1` — chart/rs-weekly al cambiar símbolo  
3. `REVIEW-PERSIST-PREVIEW-1` — no strip ciego de chartPreview en cola  
4. Prefetch N+1 **solo chart** (no brief)
