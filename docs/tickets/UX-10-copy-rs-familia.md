# UX-10 — Copy familia RS alineado con MET-1b

**Prioridad:** P1 · **Origen:** UX-REVIEW H-01 · `docs/analisis-ux-screener-review-2026-08-28.md`

## Problema

La **columna RS** en tabla ya dice «RS global · USD · universo privado curado» (`lib/screenerColumns.jsx`), pero la **familia RS** en sidebar/modal sigue con copy pre-MET-1b:

- `lib/screenerFilterCatalog.js:508` — `detail: "universo, benchmark, país y grupo"`
- `lib/screenerFilterCatalog.js:542` — `intro: "Ranking contra universo, benchmark, país y grupo."`

Confunde: el usuario cree que la columna RS mezcla benchmark/país/grupo cuando es el ranking global privado.

## Alcance

1. Actualizar `detail` e `intro` de familia `relativeStrength` para reflejar:
   - **Columna / filtro principal:** RS global semanal, universo privado curado, base USD (FX).
   - **Reglas restantes de la familia** (Bench, País, Grupo, Quality, etc.): dejar claro que son **filtros auxiliares** o percentiles de lote si aún aplican — no sustituyen la columna RS global.
2. Alinear tooltip icono `i` de familia RS en sidebar si duplica el texto del catálogo.
3. Test mínimo si existe guard de copy RS (grep en tests de filter catalog).

## Fuera

- Cambiar semántica de filtros RS Bench/País/Grupo.
- MET-2/MET-3.

## Verificación

- Browser Use: tooltip familia RS ≠ tooltip columna en conflicto; ambos coherentes.
- `npm test -- screenerFilter` (si hay suite).

Modelo: Composer / MiniMax · effort LOW. Sin commit ni push.
