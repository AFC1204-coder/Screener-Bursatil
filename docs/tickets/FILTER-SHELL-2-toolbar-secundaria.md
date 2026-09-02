# FILTER-SHELL-2 — Toolbar resultados: secundarios al menú ⋯

**Estado:** Cerrado 2026-09-02 (verify orquestador · smoke 1280+390)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Prioridad:** poda UI · continuación FILTER-SHELL-1  
**Previo:** UX-P2 (JSON audit ya en ⋯) · FILTER-SHELL-1 `21da8b0`

## Problema

En `resultsToolbar`, **Traer datos frescos**, **Resetear criterios**, **CSV** y **Guardar** siguen en franja visible al mismo peso visual que el entorno de **Revisar**. Sigue oliendo a cockpit, no a mesa de caza.

## Objetivo

Barra primaria = **Revisar** (+ ⋯). Acciones de datos/sesión viven **dentro del menú ⋯** (junto a JSON audit).

## Alcance

1. Mover a `resultsMoreMenuPanel`: Traer datos frescos, Resetear criterios, CSV, Guardar (y dejar JSON audit).
2. **Revisar** sigue `btnPrimary` en la toolbar.
3. **Escape hatch vacío:** si no hay filas, el menú ⋯ (o equivalente) debe seguir montado con Traer/Resetear — el comentario actual en ScreenerShell lo exige; no dejar la sesión sin salida.
4. Móvil: si `MobileResultList` / toolbar ≤480 duplica CSV/Guardar/Traer a primer nivel, misma política (⋯ o menú ya existente).
5. Actualizar tests que asumen esos botones en la franja primaria (`screenerPercentileScopeBanner`, etc.).

## Fuera

- MIGRATE, VCP, scoring, lógica de refresh/reset.
- Rediseño tokens / hunt rail.
- Quitar las acciones (solo reclasificar jerarquía).

## Aceptación

- Smoke 1280: toolbar primaria muestra **Revisar** y **⋯**; no muestra CSV/Guardar/Traer/Resetear como botones hermanos de Revisar.
- Abrir ⋯ → las cuatro (+ JSON audit) accesibles.
- Sin filas: Traer o Resetear siguen alcanzables vía ⋯.
- Tests verdes del área. Sin commit ni push.
