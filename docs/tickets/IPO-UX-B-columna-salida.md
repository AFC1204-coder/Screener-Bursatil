# IPO-UX-B — Columna Salida + orden + empty state

Copia. Activar tras IPO-UX-A.

**Estado:** Cola (tras A)  
**Prioridad:** P0  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-ux-ipo-superficie-2026-09-07.md`

## Alcance

1. Columna contextual **Salida** (fecha · edad) cuando ficha «IPO recientes» activa — patrón `WEAKNESS_SCORE_COLUMN` / `screenerShowsWeaknessColumn`; sustituye sitio de VCP en esa ficha.
2. Orden default: Salida **desc** (más reciente primero).
3. Etapa «—» con motivo «&lt;30 semanas cotizando» cuando aplique.
4. Empty state: ventana + cobertura `ipoDate`; **sin** CTA a vigiladas / IPO Radar (`ipoDiscoveryEmptyMessage`).
5. Smoke orquestador obligatorio (layout).

## Fuera

- Lente/chips/merge (A) · nav/kill list copy (C) · Desde salida (D) · RS IPO (F)
