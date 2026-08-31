# MET-4d — Filtro hunt: persistencia mínima sobre MA 30s

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  
**Specs:** `docs/spec-muletas-tendencia.md` §pregunta 6 (filtro propio tras uso real) · campos `weeksAboveSma30w` / `weeksAboveSma30wAbove` (MET-4b + proyección MET-4c)  
**Copia activa:** `docs/tickets/activo.md`  
**MIGRATE:** fuera

## Objetivo

Un control de filtro hunt: **semanas mínimas sobre la media de 30 semanas** — lectura del dato de persistencia MET-4, **nunca scoring**. Candidata de mesa: cazar Etapa 2 con sostén ya acumulado.

## Contrato de producto

| Pieza | Decisión |
|---|---|
| Clave | `minWeeksAboveSma30w` (nombre orientativo; alinear con catálogo) |
| Métrica | `weeksAboveSma30w` **solo si** `weeksAboveSma30wAbove === true`. Si está **bajo** la media, **no pasa** el mínimo (>0), aunque el contador sea alto (son semanas *bajo*, no sobre). |
| Neutro | `0` — filtro apagado (no corta). |
| UI | Familia **Tendencia** (`FILTER_GROUPS.trend`): campo numérico + step 1; etiqueta trader-facing tipo «Semanas sobre MA 30s min». |
| Presets | **No** endurecer presets hunt por defecto; opcional un action chip («p. ej. ≥8 sem») sin cambiar Líderes/E2 de fábrica. |
| Ausencia | Sin campo en fila (nocturno pre-MET-4c): con umbral >0 → **no pasa** (honesto). Cobertura/aviso si el catálogo ya tiene patrón para métricas parciales. |
| Scoring | Intocable. Sin `stageHealthScore`, sin aceleración/volumen como filtros en este ticket. |

## Alcance

1. Catálogo: `FILTER_FIELDS` / `FIELD_RULES` o regla propia en `screenerFilters.js` si el min genérico no puede exigir el lado `Above`.
2. Defaults / `NEUTRAL_FIELD_VALUES` / capas / restore — mismo camino que un `minPerf*`.
3. Tests: pasa con 12 sem above; falla con 12 sem below; falla sin dato si min>0; scoring untouched; `scanLightProjection` ya lista el campo (no quitar).
4. Smoke: orquestador — Abrir Tendencia, poner umbral, ver impacto −N; aviso si cobertura baja hasta el próximo nocturno.

## Fuera

Filtro salud MET-5 · filtro aceleración/volumen · columna tabla · MIGRATE · commit/push · cambiar definición de persistencia en `trendSupport.js`.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
