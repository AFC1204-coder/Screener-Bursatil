# MH-FILL-1 — Paridad de etapa estructural en Mercado

**Estado:** Activo  
**Prioridad:** P1  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md` · AUDIT-CRITERIO-1  
**Tipo:** market-health · dato ya existe · sin decisión de producto nueva

## Problema

`/api/market-health` clasifica índices/sectores con `weeklyStageForBars` pero **no** con `weeklyStageStructureForBars`. La mesa ya muestra «Pre-fuga»/«Con fuga»; Mercado usa el criterio incompleto. Además, `stageLabel` local muerto sigue en el payload (`route.js`).

## Alcance

1. En `app/api/market-health/route.js` (y consumidores UI necesarios): calcular subestado estructural con el mismo módulo que la mesa; exponer campos/`stageDisplay` para tabla de índices y `StageStrip` si aplica.
2. Borrar taxonomía `stageLabel` muerta del payload (G9 del informe).
3. Tests del route/helper tocados + `./vfc`.
4. Sin régimen regional (MH-FILL-5) · sin leadership server (MH-FILL-3) · sin STAGE-2 mesa.

## Criterios

1. Índices en Mercado muestran etapa + calificador coherente con mesa (mismo símbolo/índice comparable).
2. Payload sin `stageLabel` legacy.
3. Vitest OK · smoke orquestador `/market-health`.

Sin commit/push.
