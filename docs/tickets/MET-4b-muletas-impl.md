# MET-4b — Implementación muletas de tendencia

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  
**Spec:** `docs/spec-muletas-tendencia.md` (**aceptado** dueño 2026-08-31)  
**Copia activa:** `docs/tickets/activo.md`

## Objetivo

Unidad mínima del spec: tres lecturas en **ficha** bajo **«Sostén de la tendencia»** — sin columna, sin filtros hunt, sin scoring, sin job, sin tocar `lib/weeklyStage.js` como clasificador.

| Muleta | Fuente |
|---|---|
| Persistencia MA 30w / 10w | Contadores semanas consecutivas; mismas medias que etapa (`weeklyStage` / sma semanal) |
| Aceleración | `perf3m` vs tramo previo derivado de `perf6m`; banda muerta **5 pp** |
| Volumen | `upDownVolRatio` 50 sesiones; umbrales 1 / 1,25 ya existentes |

Ausencias con motivo (principio 3). Copy trader-facing, no semáforos.

## Alcance

1. Funciones puras (patrón `descriptiveStrip`) + tests unitarios.
2. Campos de fila en scan / proyección si el spec lo exige para consistencia ficha↔scan; si basta calcular en ficha desde barras+campos ya en brief, preferir mínimo.
3. Bloque UI en franja descriptiva de ficha (`StockClient` / strip).
4. Tests: etapa intacta; scoring untouched; ausencias honestas.
5. Smoke Browser Use lo hace el orquestador.

## Fuera

MET-4c (vista rápida / filtros), MET-5, scoring, MIGRATE, columna tabla, commit/push.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
