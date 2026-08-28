# UX-14 — CTA stale mercados consistente

**Prioridad:** P1 · **Origen:** UX-REVIEW H-05 · `docs/analisis-ux-screener-review-2026-08-28.md`

## Problema

Con mercados seleccionados ≠ datos cargados (ej. cargado US 3321, selección HK o Core intl), el usuario ve:

- Banner «Datos cargados: … La selección actual (…) **no coincide**»
- En algunos estados **solo** «Traer datos frescos» (refresh nocturno US) y **no** «**Cargar datos de la selección**» (`MARKETS_MISALIGNMENT_CTA`)

Eso bloqueó smoke intl/HK en UX-REVIEW: no se pudo cargar materializado HK de forma fiable.

## Código relevante

- `lib/marketAvailability.js` — `buildMarketsStaleNotice`, `MARKETS_MISALIGNMENT_CTA`
- `app/page.jsx` — `marketsStale`, `scanStale`, `loadScanForMarketSelection`, `announceCoverage`
- `app/components/screener/ScreenerShell.jsx` — banner `marketsMisalignment` vs `scanStale` (mobile + desktop `scanStaleNotice`)
- Tests: `tests/screenerMarketsMisalignment.test.js`

## Hipótesis

1. `marketsMisalignment` solo si `marketsStale` (= `scanStale` **y** mercados distintos) — si `scanStale` false pero selección ≠ scan real, no hay CTA correcto.
2. `scannedMarkets` pasado al banner puede no coincidir con `scannedMarketsFromScan` cuando el contexto está incompleto.
3. Banner duplicado/oculto por viewport (mobile vs desktop) o `snapshotNotice` compitiendo (parcialmente fixeado en tests).
4. Usuario confunde «Traer datos frescos» (mismo universo, refresh) con «Cargar selección» (cambiar materializado).

## Alcance

1. **Regla producto:** si `selectedMarkets` ≠ `scannedMarkets` (keys normalizados), **siempre** mostrar banner mercados + botón **`Cargar datos de la selección`** que llama `loadScanForMarketSelection(markets, …)` — independiente de otros flags salvo `restoringScan`.
2. **Copy diferenciado:**
   - Desalineación mercados → CTA «Cargar datos de la selección»
   - Solo cambió manual/scanMode/cobertura con mismos mercados → «Traer datos frescos»
3. **Un banner** por viewport (mantener tests existentes); no duplicar en `snapshotNotice` (`source: markets-stale` filtrado).
4. **Sidebar:** si el banner solo está en resultados, considerar aviso compacto junto a control Mercados (dot stale ya existe) — mínimo que desktop+mobile sigan teniendo CTA visible sin scroll.
5. Tests: casos HK seleccionado / US cargado; multi Core intl; scanStale false pero mercados distintos (si reproducible).
6. Smoke Browser Use: seleccionar solo HK → clic CTA → status «Cargando materializado…» y filas `.HK` o aviso honesto si falla API.

## Fuera

- Nuevo ingest cron HK.
- Cambiar lógica de merge materializados (INT-1).

## Verificación

```bash
npm test -- screenerMarketsMisalignment screenerPercentile
./vfc 'marketAvailability|ScreenerShell|page.jsx|MarketsMisalignment'
```

Browser: US cargado → elegir HK o Core intl → **Cargar datos de la selección** visible y funcional.

Modelo: Composer · MED. Sin commit ni push.
