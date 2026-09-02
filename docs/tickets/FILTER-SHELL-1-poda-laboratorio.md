# FILTER-SHELL-1 — Poda cáscara laboratorio del screener

**Estado:** Cerrado 2026-09-02 (verify orquestador · smoke 1280 Diagnóstico cerrado)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer (plan Cursor)  
**Prioridad:** fuego producto · **no** MIGRATE · **no** VCP-gates  
**Contexto:** dueño — cáscara de filtros aún “de hace meses”. UX-FILTERS-8 (`dac98a3`) ya puso defaults fríos. **JSON audit** ya vive en ⋯ (no tocar salvo regresión).

## Problema real (HEAD)

En `ScreenerShell` sidebar, al mismo nivel que la config útil, hay dos disclosures de laboratorio:

- **Auditoría de filtros** (`scanDiagnosticsDisclosure`)
- **Cobertura internacional por mercado** (`globalCoverageDisclosure`)

Compiten visualmente con «Más filtros» / ajustes de sesión. Sensación de cockpit de debug.

## Objetivo

Un solo bloque **Diagnóstico** (o nombre claro), **cerrado por defecto**, que agrupe auditoría + cobertura. La mesa de caza no muestra paneles internos como hermanos de la config diaria.

## Alcance

1. Agrupar ambos disclosures bajo un `<details className="…">` padre cerrado por defecto (p. ej. summary «Diagnóstico»).
2. Mantener el contenido (FilterDiagnosticsPanel, GlobalCoveragePanel) intacto por dentro.
3. Drawer móvil de filtros: misma agrupación si monta esos paneles.
4. No mover JSON audit (ya en ⋯). No cambiar defaults de capas ni hunt.

## Fuera

- MIGRATE, VCP-3-gates, scoring, nocturno, rediseño tokens.
- Reabrir UX-FILTERS-8.
- Quitar CSV/Guardar/Traer frescos (otro ticket si duele).

## Aceptación

- Smoke 1280: no hay dos summaries hermanos «Auditoría…» y «Cobertura internacional…» al nivel superior del aside; hay **un** «Diagnóstico» cerrado.
- Abrir Diagnóstico → siguen accesibles auditoría y cobertura.
- Tests del shell/viewport tocados; sin commit ni push.
