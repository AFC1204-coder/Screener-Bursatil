# UX-13 — RS en Líderes Etapa 2 (opción D)

**Estado:** Decisión dueño **aceptada 2026-08-29** · **en programación** (activo tras FILTERS-6 `28c472a`)  
**Origen:** H-04 / `docs/analisis-ux-screener-review-2026-08-28.md`  
**Decisión:** opción **D (híbrido)** — no ensanchar ranking; no expulsar Sin dato del filtro de etapa por defecto.

## Problema

En ficha **Líderes Etapa 2**, ~47 % de las filas que *pasan* muestran «– Sin dato» en RS. El tooltip es correcto (fuera del ranking semanal), pero la expectativa de “líder” choca con media lista sin fuerza relativa visible.

## Decisión (D)

1. **No** cambiar el universo/motor del ranking semanal solo para rellenar celdas.  
2. **No** exigir `weeklyRsAvailable` en balanced / Líderes E2 por defecto (sigue siendo lista de stage).  
3. **Sí** presentación honesta en la ficha de caza:
   - Al ordenar por RS (y/o al entrar con sort RS): filas **con** RS arriba; **Sin dato** al final.  
   - Chip / verdad local: **`RS en N/M`** sobre los que pasan la ficha (no el lote entero; eso ya es FILTERS-4).  
   - Copy corto: fuerza relativa = ranking semanal del universo privado; ausencia ≠ fallo de etapa.  
4. **Follow-up opcional (fuera del primer PR):** toggle «Solo con RS» que acerque a opción B sin ser el default.

## Fuera (v1 de este ticket)

- Ampliar job `rs_weekly` / bajar exclusiones (opción C).  
- Inventar RS de lote / percentil local.  
- Cambiar semántica de `minRsRating` en el preset balanced salvo el sort/tie-break acordado.

## Verificación (cuando se programe)

- Líderes E2: chip `RS N/M` coherente con celdas.  
- Sort RS: Sin dato al final.  
- Smoke Browser Use; tests de helper de conteo/orden.
