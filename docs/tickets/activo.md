# Ticket activo — P6e

**Modelo:** Composer · **Esfuerzo:** bajo  
**Rama:** `codex/statsedge-ui-polish`  
**Orquestador:** no comitees ni hagas push; al terminar pega el resumen de retorno en el chat orquestador.

---

## Objetivo

Con el preset **Deterioro técnico** (`weakness`), la tabla ordena por `weaknessScore` pero **no muestra** esa columna. Hay que dejar de ordenar por un número invisible: o se enseña la columna cuando el sort/preset la usa, o se deja de ordenar por ella.

Fuente: `docs/analisis-screener-uso-real-2026-08-23.md` (resto P6), `docs/backlog-activo.md`.

## Alcance

1. Localizar `SCREENER_COLUMNS` / definición de columnas compactas y el sort por `weaknessScore` (p. ej. `defaultSortForSettings`, `setPreset` / modo weakness en shell).
2. **Preferido:** cuando el criterio de orden activo es `weaknessScore` (o el preset/modo weakness lo impone), mostrar una columna visible «Deterioro» (o etiqueta ya usada en producto) con el valor de `weaknessScore` / label existente.
3. **Alternativa aceptable** si la columna rompe el layout de 7 columnas: no ordenar por `weaknessScore` hasta que la columna exista; usar un sort visible coherente y documentarlo en el resumen.
4. Tests de regresión mínimos si ya hay suite de columnas (`screenerSevenColumns` u otra).
5. Smoke mental / hard-reload si tocas CSS de tabla: anótalo en «LO QUE NO VERIFIQUÉ» si no puedes; el orquestador hará smoke visual antes de commit.

## Fuera de alcance

P3 rendimiento, P4/P5 capas, chart, sesión/frescor, renombrar presets, traducir toda la UI.

## Verificación

```bash
npm test -- --run tests/screenerSevenColumns.test.js tests/screenerFilters.test.js
# + cualquier test de columnas/sort que toques
```

Diff real al final. Sin commit ni push.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
