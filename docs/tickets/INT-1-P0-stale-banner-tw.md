# INT-1-P0 — Banner mercados stale + TW no seleccionable

**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer  
**Origen:** `docs/tickets/INT-0-audit.md` §7 P0  
**Tras:** INT-1-P1 (`b46dfb1`) — auto-carga con **un** mercado; multi-mercado sigue stale sin copy claro

## Problema

1. **Expectativa falsa al abrir:** `DEFAULT_MARKETS` son 29 códigos y el copy (`DEFAULT_STATUS` / KPI «29 mercados») sugiere universo multi-mercado listo, pero el arranque carga solo el **nocturno US** (~3319). El punto `marketsStale` existe (`controlDotStale` en el panel Mercados) pero es fácil de ignorar; no hay banner claro «los datos son de US».
2. **TW roto:** último materializado `materialized:TW:2026-08-25` con `status: failed`, `row_count: 0`. INT-1-P1 ya avisa si el usuario elige solo TW, pero el chip **TW** y el preset **Asia** siguen ofreciéndolo como si hubiera pipeline sano.

## Objetivo

1. Banner / copy **honesto** cuando `markets` (selección) ≠ `scanContext.scannedMarkets` (datos cargados), sobre todo en multi-mercado y en arranque Global/29 vs US.
2. **TW:** no seleccionable (o deshabilitado con motivo) hasta que haya materializado publicable; el preset Asia no debe incluir TW.

## Alcance

### Dentro

#### A. Banner / copy stale (UI)

- Cuando `marketsStale === true` (ya calculado en `app/page.jsx`), mostrar un `snapshotNotice` (o banner dedicado visible junto a Estado) en español, p. ej.:
  - *«Datos cargados: US (3319). La selección de mercados no coincide — elige un solo mercado para cargar su materializado, o deja la selección alineada con el scan.»*
- Incluir mercados del scan (`scannedMarkets`) y, si cabe, `row_count` / longitud de `analyzedRows`.
- Al arrancar con DEFAULT_MARKETS (29) + scan US: el aviso debe aparecer **sin** que el usuario toque nada (hoy `marketsStale` ya debería ser true en ese caso — verificar y cablear el notice).
- Suavizar `DEFAULT_STATUS` / textos que prometan «EEUU + Europa + Asia… listos» si el dato real es solo US (mínimo: no contradecir el banner).
- No inventar fusión multi-scan (fuera de alcance; eso es INT-1+).

#### B. TW fuera del selector usable

- Opción mínima (preferida v1): lista `UNAVAILABLE_MARKETS` o flag en `MARKET_META` / helper (`lib/screenerConfig.js` o `lib/markets.js`):
  - `TW`: `{ selectable: false, reason: "Materializado TW fallido (cron); sin filas publicables." }`
- Chip TW: `disabled` / no toggle / `aria-disabled` + `title` con el motivo.
- `marketPresetMarkets("asia")`: excluir TW (y cualquier otro marcado no seleccionable).
- `DEFAULT_MARKETS` / `MARKET_ORDER`: **quitar TW del default** (sigue en meta para futuro) **o** dejarlo en orden pero no-seleccionable y no activo al inicio.
- Al intentar cargar solo TW vía API (si alguien fuerza URL): el aviso INT-1-P1 `materialized-not-publishable` ya cubre; no hace falta arreglar TWSE en este ticket.

#### C. Tests

- Unit: helper `isMarketSelectable` / Asia sin TW.
- UI o lógica: con `markets = DEFAULT_MARKETS` y `scannedMarkets = ["US"]` → notice stale presente (test del builder del mensaje si se extrae a función pura).
- Regresión: INT-1-P1 tests siguen verdes (`materializedScanLookup`, `screenerStartupAnchor`).

#### D. Sin commit ni push.

### Fuera

- Arreglar provider TWSE / re-correr cron TW (ticket aparte si el dueño lo pide).
- Cron HK/AU usable / fusión multi-mercado.
- Cambiar anclaje de arranque fuera de `nightly-us`.

## Archivos probables

- `app/page.jsx` — emitir notice cuando `marketsStale`
- `app/components/screener/ScreenerShell.jsx` — chip disabled, copy
- `lib/screenerConfig.js` — DEFAULT_STATUS, MARKET_META / DEFAULT_MARKETS
- `lib/markets.js` o helper nuevo de disponibilidad
- tests nuevos o ampliación de tests de screener/shell

## Verificación (orquestador)

1. Tests del ticket en verde.
2. Browser Use `:3000`:
   - Arranque (Global/29 o DEFAULT): banner indica datos US vs selección multi.
   - Preset Asia: **sin** TW activo; chip TW no clicable o con motivo.
   - Solo CA (regresión INT-1-P1): sigue cargando ~22 filas.

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
