# MET-5b — Implementación índice salud de etapa

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  
**Spec:** `docs/spec-salud-etapa.md` (**aceptado** + umbrales **OK dueño 2026-08-31**: 26/10/15/50)  
**Referencia fórmula:** `scripts/stage-health-calibrate.mjs` (extraer a módulo puro; no dejar lógica duplicada divergente)  
**Copia activa:** `docs/tickets/activo.md`

## Objetivo

Unidad mínima del spec: **«Salud de etapa: N/100»** en **ficha** (junto a etapa / franja descriptiva) + desglose accesible + motivos de ausencia + campo de fila en scan + sección metodología. Solo Etapas **2 y 4**. Sin columna, sin filtros, sin scoring, sin job, sin tocar `lib/weeklyStage.js`.

## Alcance

1. **`lib/stageHealth.js`** (nombre del spec): constantes con nombre (pesos 25/10/20/25/20, sat 26/10, extensión 15/50, umbrales volumen existentes), subscores [0,1], `stageHealthScore` entero o `null` + código de ausencia (tabla pregunta 8). Lectura espejo Etapa 4. Todo-o-nada (no renormalizar).
2. Helper de líneas UI (patrón `buildTrendSupportLines`) — número + desglose por componente; sin semáforo/colores por rango.
3. **Scan:** campo `stageHealthScore` (+ motivo si aplica) en `materializedScanner` / proyección, junto a campos MET-4b. Coste marginal ~0.
4. **Ficha:** línea en `DescriptiveStrip` (o adyacente al bloque de etapa). El bloque **«Sostén de la tendencia»** (MET-4b) **no se elimina ni se colorea**.
5. **Metodología:** sección «Salud de etapa» (tabla pesos/rampas + espejo E4 + ejemplo trabajado del spec) en el sitio único de metodología del producto.
6. **Tests:** fórmula (ejemplo salud 90 del spec); espejo Etapa 4; todo-o-nada / ausencias; `weeklyStage` untouched; scoring untouched (`scoring.js` / `weaknessScore` sin diff de lógica).
7. Smoke visual: lo hace el **orquestador** (Browser Use), no este chat.

## Fuera

Columna tabla, filtros hunt, vista rápida, MET-4c, VCP/1·3, scoring, jobs/`engine_version`, tocar `weeklyStage.js` / modificar API pública de `trendSupport.js` (solo importar), commit/push.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
