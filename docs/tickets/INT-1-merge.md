# INT-1-merge — Fusión de materializados al elegir varios mercados

**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer · **Medium** (subir a High si toca API + cliente)  
**Origen:** smoke INT-1-AU-run — con HK+AU activos el banner dice «selección no coincide» y **no** carga las 23+15 filas ya publicadas.

## Problema

`readLatestMaterializedScanForMarkets` solo acepta un scan cuyo `settings.markets` **coincide exactamente** con el conjunto pedido. No existe (ni debe existir) un scan `["HK","AU"]` en cron: hay `["HK"]` y `["AU"]` dedicados.

Hoy: N≥2 mercados → aviso stale + datos del scan anterior. Uso privado multi-mercado queda roto en el caso más natural (combinar chips).

## Objetivo

Si el usuario selecciona **2+ mercados** y **cada uno** tiene un materializado publicable (mismas reglas que INT-1-P1: publishable, HK/AU ≥15 filas), cargar la **unión de filas** y alinear `scannedMarkets` con la selección.

## Alcance

### Dentro

1. **Lookup / API** — camino para N mercados:
   - Por cada código en `markets`, reutilizar la lógica de un mercado (`readLatestMaterializedScanForMarkets([code])`).
   - Si **todos** tienen scan publicable → devolver scan sintético o payload con `rows` = concat (dedupe por `symbol`), `settings.markets` = conjunto pedido, `rowCount` = suma, metadatos honestos (`source: "merged-materialized"` o similar).
   - Si **falta** alguno → no sustituir; reason claro (`partial-markets` / lista de faltantes) para que el banner stale siga (o copy más preciso).
2. **Cliente** — al cambiar mercados a N≥2, el mismo flujo que ya carga un mercado (`fetchLatest…` / sync) debe consumir el merge y reemplazar la tabla (no quedarse en US/HK previo).
3. **Scoring / percentiles** — **no** recalcular percentiles globales en este ticket. Conservar métricas por fila del scan origen. Si hace falta aviso corto «mezcla de scans; percentiles por lote de origen», OK; no bloquear.
4. Tests: merge HK+AU con fixtures; un mercado ausente → no merge; un solo mercado → comportamiento INT-1-P1 intacto.
5. Sin commit ni push.

### Fuera

- Recalcular RS/score sobre el universo fusionado.
- Crear cohorts cron multi-mercado.
- KR/IN/… nuevos pipelines.
- Ampliar listas `EXTRA` AU (opcional aparte).

## Archivos probables

- `lib/materializedScanLookup.js`
- `app/api/scans/route.js` (si el merge vive en servidor)
- `lib/cloudSyncClient.js` / `app/page.jsx` (disparo al cambiar mercados)
- `lib/marketAvailability.js` (copy del aviso si cambia)
- tests `materializedScanLookup` / cloud sync

## Verificación (orquestador)

1. Tests en verde.
2. Browser Use: chip solo HK → 23; solo AU → 15; **HK+AU** → ≥38 analizadas (o 23+15 dedupados), sin banner «no coincide».
3. Volver a US solo → nocturno US intacto.

## Contexto reciente

- Cron HK: 23 filas (`asia-hongkong`). Cron AU: 15 (`oceania-australia`).
- Umbral: `MATERIALIZED_MIN_ROWS_HK_AU = 15`.

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
