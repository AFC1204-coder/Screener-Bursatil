# UX-3 — Invariante orden visible + sort por cabecera

**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer · **Medium**  
**Origen:** `docs/analisis-ux-filtros-ia-2026-08-27.md` (P0 #1) · orden: UX-4 (hecho) → **UX-3** → UX-2  
**Principio:** 7.5 — no ordenar por una magnitud que la tabla no muestra (`lib/screenerPipeline.js` / `defaultSortForSettings`).

## Problema

En vivo (UX-1): sort=`perf3m` con periodo activo **6M** y columna «Rend. 6M». `setPerfPeriod` sincroniza periodo→sort, pero elegir orden en el `<select>` o restaurar sesión **desincroniza**. Además las cabeceras `<th>` no ordenan [CÓDIGO `lib/screenerTable.jsx`].

## Objetivo

1. Imposible que el sort activo discrepe de la columna/periodo de rendimiento visible (o del sort de deterioro en modo weakness).  
2. Cabeceras clicables con indicador ↓/↑ para columnas ordenables.  
3. Restaurar sesión nunca deja sort y columna desalineados.

## Alcance

### Dentro

1. **Sincronizar** caminos: select «Ordenar», period picker (3M/6M/12M), `defaultSortForSettings`, restauración de sesión. Opciones válidas:  
   - A) Eliminar el select de orden y ordenar solo por cabecera + periodo; o  
   - B) Mantener select pero forzar que al elegir `perf3m|perf6m|perf12m` actualice el periodo visible, y al cambiar periodo actualice el sort.  
   Preferir **B si el select ya está cableado**, o **A si sale más simple**; no dejar dos controles que mientan.
2. **`lib/screenerTable.jsx`:** cabeceras clicables para columnas con sort key (`screenerSortOptions` / columnas en `screenerColumns.jsx`); indicador de dirección.
3. **Sesión:** al hidratar, normalizar `sort` ↔ `perfPeriod` (o equivalente) antes de pintar.
4. Tests: invariante sort↔periodo; click de cabecera si hay harness de componente; regresión sesión.
5. Sin commit ni push.

### Fuera

- UX-2 (línea de verdad / banners).  
- UX-5 rail de fichas.  
- Cambiar métricas del motor de filtrado.

## Archivos probables

- `app/components/screener/useResultViewModel.js`
- `app/components/screener/ResultFilterBar.jsx`
- `lib/screenerTable.jsx`
- `lib/screenerColumns.jsx`
- `lib/screenerPipeline.js` (solo si hace falta el contrato)
- `app/page.jsx` (sesión)
- tests de vista / sort

## Verificación (orquestador)

1. Tests en verde.  
2. Browser Use: imposible dejar sort=perf3m con columna/botón 6M activo; cabecera Rend. ordena y marca ↓/↑; reload de sesión coherente.

## Plantilla de retorno

```
## Resumen
(1–4 bullets)

## Archivos
(lista real)

## Tests
(comando + resultado)

## LO QUE NO VERIFIQUÉ
(…)

Sin commit ni push.
```
