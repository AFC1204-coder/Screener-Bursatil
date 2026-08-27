# INT-1-P1 — Cargar último materializado por mercado al cambiar selector

**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer (thinking si hace falta diseño multi-mercado)  
**Origen:** `docs/tickets/INT-0-audit.md` §7 P1  
**Depende de:** B2-chart cerrado; Supabase `screener` alineado con `.env.local`

## Problema

Hoy el screener **siempre arranca con el nocturno US** (~3319 filas) vía `getLatestScanFromCloud()` + `anchor=nightly-us`. Si el usuario cambia mercados (p. ej. solo **CA**, **JP**, **DE**), `setMarketsAndInvalidate` actualiza el selector y cobertura pero **conserva filas US**; `marketsStale` marca divergencia sin resolverla.

En Supabase **sí existen** scans materializados por mercado (CA 22, JP 24, FI-DK-NO-SE 13…), pero la UI no los carga.

## Objetivo

Al cambiar el selector a **un mercado concreto** (o preset de un solo mercado/grupo conocido), **fetch desde Supabase** del último scan materializado publicable para ese mercado y **rehidratar** `analyzedRows` / `rows` / `scanContext` **sin ejecutar scan nuevo**.

Mantener **arranque US** cuando la sesión usa el universo por defecto o mercado US.

## Alcance

### Dentro

1. **Backend — lookup por mercados**
   - Nuevo helper (p. ej. `lib/materializedScanLookup.js` o extensión de `lib/nightlyUsScan.js`):
     - `readLatestMaterializedScanForMarkets(markets, options)`
     - Input: lista normalizada (`normalizeMarketList` de `lib/markets.js`)
     - Query `scans`: `preset=materialized-cache`, `deleted_at` null, `settings->markets` coincide con el array pedido (mismo conjunto ordenado), `progress.status` publicable (`complete`/`partial`/`done` — reutilizar `PUBLISHABLE_PARENT_STATUS` / `isPublicScanStatus`)
     - Orden: `created_at desc`, `limit 1`
     - Devolver `{ scan, row, reason }` simétrico a `readNightlyUsScan`
   - Datos de referencia en prod (2026-08-27): CA 22 filas, JP 24, US 3319, TW **failed/0** (no cargar)

2. **API — `GET /api/scans`**
   - Nuevo anclaje, p. ej. `?anchor=markets&markets=CA` (CSV o repetido; documentar forma canónica)
   - Reutilizar paginación de `scan_results` y hidratación RS/marketCap existente
   - Respuesta incluye metadatos: `{ markets: { found, reason, requested: ["CA"], matchedScanId, rowCount } }`
   - Caché: extender `cacheKey` con markets normalizados (mismo TTL que `cacheableLatest`)
   - **No romper** `anchor=nightly-us` (tests `tests/screenerStartupAnchor.test.js` deben seguir verdes)

3. **Cliente — `lib/cloudSyncClient.js`**
   - `getLatestScanFromCloudForMarkets(markets)` → llama al nuevo anchor con `STARTUP_ROWS_LIMIT` (6000 suficiente para scans intl pequeños)

4. **Cliente — `app/page.jsx`**
   - Tras cambio de mercados (`setMarketsAndInvalidate`, presets de mercado, plantillas que fijan un mercado):
     - Si mercados normalizados ≠ `scanContext.scannedMarkets` **y** aplica regla de auto-carga (ver abajo) → fetch cloud + aplicar mismo camino que `restoreLatestSnapshot` / `applyFreshSnapshotData`
     - Actualizar `scanContext.scannedMarkets`, limpiar `marketsStale` cuando el load termina OK
     - Estado loading breve en status («Cargando materializado CA…»)
   - **Regla de auto-carga (v1 mínima):**
     - **Un solo mercado** seleccionado (p. ej. `["CA"]`, `["JP"]`, `["GB"]`) → cargar su último materializado
     - **Solo US** o sesión arranque sin sesión guardada → seguir `anchor=nightly-us` (sin cambio)
     - **Multi-mercado** (>1 código, p. ej. DEFAULT_MARKETS completo) → **no** auto-fetch en v1; mantener comportamiento actual + banner staleness existente (evitar fusión compleja)
   - **Umbral HK/AU:** si el scan encontrado tiene `row_count < 15`, **no** sustituir filas US; mostrar `snapshotNotice` honesto («HK/AU: materializado insuficiente (N filas). Usa escaneo manual o espera al cron.») — ver INT-0 (último US,HK,AU = 2 filas)

5. **Tests**
   - API: último scan CA gana sobre scan US más reciente cuando `anchor=markets&markets=CA`
   - API: TW failed → `found: false`, sin filas
   - Cliente o integración ligera: normalización markets en URL
   - Regresión: `npm test -- screenerStartupAnchor cloudSyncClient`

6. Sin commit ni push.

### Fuera

- Fusión de varios scans en uno (multi-mercado simultáneo)
- Arreglar cron HK/AU/TW (INT-1 P0 TW aparte)
- Cambiar `DEFAULT_MARKETS` (solo umbral/avisos HK/AU)
- Smoke Browser Use (orquestador post-retorno)

## Archivos probables

- `lib/materializedScanLookup.js` (nuevo) o `lib/nightlyUsScan.js`
- `lib/scanLocalId.js` — constante anchor `markets` si conviene
- `app/api/scans/route.js`
- `lib/cloudSyncClient.js`
- `app/page.jsx`
- `tests/screenerStartupAnchor.test.js`, nuevo `tests/materializedScanLookup.test.js` o similar

## Verificación (orquestador)

1. Tests indicados en verde.
2. Browser Use `:3000`: preset → selector **solo CA** → status indica carga → tabla ~22 filas (no 3319); volver a **US** → recarga nocturno o botón reset.
3. Selector **HK** solo → aviso umbral, no sustituir por 2 filas basura.

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
