# STAGE-4 — Volumen de la fuga junto al calificador «Con fuga»

**Estado:** Hecho  
**Prioridad:** P1  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md` A-4 / W8  
**Tipo:** dato de soporte · sin reclasificar etapa ni subestado  
**Cierre:** smoke `/stock/AVAH` «Con fuga (2,8×)» + celda Vol. fuga 2,8×; metodología declara métrica sin clasificar

## Problema

«Con fuga» (`E2_structural`) se decide solo con precio (techo + HH/HL o tendencia ancha). Weinstein/O'Neil exigen volumen en la ruptura (≈2× media previa / +40–50%), pero hoy dos valores «Con fuga» —uno seco y otro a 3×— se ven idénticos. La decisión de **no** condicionar la etapa al volumen sigue vigente (auditoría VCP-0); falta **reportarlo**.

Hoy `lib/weeklyStageStructure.js` no calcula ni persiste ningún ratio de volumen de fuga.

## Alcance

1. **Cálculo** en `weeklyStageStructure` (o helper puro al lado):  
   `weeklyBreakoutVolRatio = vol_semana_fuga / mediana(volume de las 4 semanas previas)`.  
   - Semana de fuga = primera semana (en el lookback) cuyo **cierre** supera la resistencia (`52s − rightWeeks`), cuando exista.  
   - Si `E2_structural` viene solo por **tendencia ancha** (sin semana de ruptura puntual): ratio `null` + detalle honesto («sin semana de fuga puntual»).  
   - Si faltan volumenes: `null` + motivo.  
   - **No** usar el ratio para cambiar `structure` / labels / gates VCP.
2. **Persistir** en proyección de scan (`weeklyStageStructureFields` + `materializedScanner`): p. ej. `weeklyBreakoutVolRatio`, `weeklyBreakoutVolWeek` (fecha ISO opcional). Compatible con filas viejas (ausencia = sin dato).
3. **UI de soporte** junto al calificador «Con fuga» (patrón MET-4 «acompaña (1,4×)»):
   - Ficha (`DescriptiveStrip` / bloque etapa) y al menos una de: mesa (hint/title del calificador) o `/review` evidencia.  
   - Copy corto: p. ej. `vol. fuga 1,8×` / `vol. fuga seco 0,7×` / «sin dato vol. fuga».  
   - Umbral de **referencia visual** 2× (Weinstein) solo en copy/hint — **no** gate.
4. **Metodología** (ligero): una línea en sección subestado de `/metodologia` que declare la métrica y que **no** entra en la clasificación (importar constante/ventana desde el mismo módulo).
5. **Tests:** unit del ratio (fuga clara 2×+, seca &lt;1, tendencia ancha → null); proyección de campos; snapshot/display si aplica. `./vfc` tocados. Sin commit/push.

## Fuera de alcance (NO)

| Tema | Motivo |
|---|---|
| Cambiar `structure` / exigir 2× para «Con fuga» | Decisión explícita de no condicionar |
| STAGE-5 filtro por subestado | Decisión dueño |
| STAGE-6 zona de resistencia / recuento bases | Aplazado |
| Reabrir `weeklyStage.js` / scoring | Criterio congelado |
| Ops Mini / RPC | Residual aparte |
| BottomNav nuevo ítem | — |

## Criterios

1. Con barras de fixture: ratio ≈ `vol_fuga / median(4 prev)`.  
2. Clasificación Pre-fuga/Con fuga **idéntica** antes/después en los mismos fixtures de estructura.  
3. UI: con «Con fuga» y ratio disponible se ve el ×; sin ratio, ausencia clara.  
4. Vitest + lint OK. Smoke orquestador: ficha con Con fuga + hard-reload.

Sin commit/push.
