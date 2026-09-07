# IPO-UX-E — Contexto «salida» en ficha `/stock`

**Estado:** Cerrado · smoke OK 2026-09-07 · residual: company-brief sin `ipoAnchor*`  
**Prioridad:** P1  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-ux-ipo-superficie-2026-09-07.md` · oleada P1 «ficha valor»  
**Tipo:** producto ficha — **no scoring · no RS IPO (F) · no CRUD `/ipo-radar` · no nocturno**

## Problema

En mesa (IPO-UX-D/D2) ya se ve **Salida** y **Desde salida**. Al abrir `/stock/{symbol}` el contexto de salida se reduce a un KV «IPO» con fecha: no hay edad, ni % desde ancla, ni lectura coherente con la mesa cuando el valor viene del cohort IPO recientes.

## Alcance

1. En ficha `/stock` (chrome identidad / bloque company / rail de decisión — el sitio que ya exista para listing/IPO, sin inventar un panel nuevo grande): mostrar **fecha de salida**, **edad** (misma convención que mesa) y **% desde salida** cuando haya ancla usable.
2. Fuente de ancla (prioridad):
   - `ipoAnchorClose` / `ipoAnchorDate` si llegan en el payload de ficha o se pueden reutilizar desde helpers puros (`lib/ipoAnchor.js` / `ipoDesdeSalidaPct`);
   - si no, calcular desde `chartBars` / serie de ficha con la misma regla que D2 (primer cierre usable ≥ `ipoDate`);
   - ausencia honesta («—» + motivo corto) si no hay `ipoDate` o no hay barra.
3. Copy alineado con mesa («Desde salida», no inventar «performance IPO» / score).
4. Tests unitarios del cálculo/presentación si se extrae helper; `./vfc` en archivos tocados.
5. Sin commit/push.

## Fuera

- IPO-UX-F RS IPO / peer  
- Cambiar scoring / `ipoScore` / lente mesa  
- Backfill Mini / nocturno  
- Rediseño amplio de `/stock` (LOOK / decision rail salvo el hueco mínimo)

## Criterios

1. En un IPO reciente con ancla (p.ej. ANDG / SLDE), la ficha muestra % finito coherente con mesa (± redondeo).
2. Sin `ipoDate` → no inventar %; fecha/edad ausentes honestas.
3. IPO antigua con historial truncado: misma semántica que mesa (ancla = primer cierre disponible ≥ ipoDate, o — si no hay).
4. Vitest afectados verdes. Smoke visual = orquestador.

## Dependencias

- IPO-UX-D + D2 código + ops `--write` hechos (ancla en scan US 2026-09-07).
