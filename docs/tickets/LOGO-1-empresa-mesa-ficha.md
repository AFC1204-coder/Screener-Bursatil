# LOGO-1 — Logos de empresa en mesa y portada de ficha

Copia de referencia. Ejecutar desde `docs/tickets/activo.md`.

**Estado:** Activo  
**Prioridad:** P1 (lectura / identidad)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** dueño 2026-09-07 · captura tape con iniciales MI/AH/… · ficha  
**Tipo:** UI datos — **no scoring**

## Problema (verificado en código)

1. **Mesa / tape:** `CompanyMark` (`lib/screenerAtoms.jsx`) pide favicon Google vía `companyLogoDomain(row)`. En filas ligeras del scan **no viajan** `website` ni `logoDomain` (`lib/scanLightProjection.js` TABLE_FIELDS solo tiene symbol/companyName/…). Sin dominio → solo iniciales. El mapa `COMPANY_ASSET_DOMAINS` cubre pocos tickers.
2. **Portada ficha:** `StockVerdictHead` pinta **solo** iniciales en `.stockLogoPro` (`StockClient.jsx` ~222–224). El brief ya trae `visual.logoUrl` / `clearbitLogoUrl` y hay `logoCandidates` / `logoIndex` **sin usar en el JSX** de la portada.

## Alcance (hacer)

1. **Ficha (inmediato):** en `stockLogoPro`, `<img>` con cadena `logoUrl` → `clearbitLogoUrl` (o `logoCandidates` + `onError` avanza índice); si fallan todas → iniciales. Reutilizar CSS `.stockLogoPro img` si ya existe.
2. **Mesa:** añadir `website` y `logoDomain` a la proyección ligera (TABLE_FIELDS / lista canónica + test `scanLightProjection`) para que el próximo materializado/nocturno las persista. Coste: dos strings cortos por fila.
3. **`CompanyMark`:** si hay dominio, intentar favicon Google y, si falla, Clearbit (mismo patrón que brief); sin dominio → iniciales. No inventar scrapers ni APIs de pago nuevas.
4. Tests: light projection incluye campos; mark/ficha si hay harness sencillo.
5. Sin commit/push. `./vfc` si aplica.

## Fuera de alcance

- Backfill masivo SQL de `website` en scans ya guardados (ops aparte; tras 2 los logos llegan con la siguiente corrida / filas nuevas).
- Ampliar a mano `COMPANY_ASSET_DOMAINS` como solución principal.
- IPO-UX-A/B (no mezclar).
- Sticky Media 1 / filtros 0 (otro hilo).

## Criterios de aceptación

1. `/stock/AAPL` (u otro con website en brief): portada muestra logo, no solo iniciales; fallback a iniciales si la URL falla.
2. Tras proyección con `website`/`logoDomain` en filas de prueba (o mock), `CompanyMark` muestra `<img>`, no `<b>` iniciales.
3. Smoke orquestador: mesa + ficha hard-reload.

## Archivos probables

- `app/stock/[symbol]/StockClient.jsx`
- `lib/screenerAtoms.jsx` (`CompanyMark`)
- `lib/scanLightProjection.js` + `tests/scanLightProjection.test.js`
- `styles/stock.css` (si hace falta)

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
