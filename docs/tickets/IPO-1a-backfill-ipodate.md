# IPO-1a — Backfill `ipoDate` multi-mercado

**Prioridad:** P0 datos · **Origen:** IPO-1 · spec UX-FILTERS aceptada  
**Depende de:** decisiones dueño (todos mercados; híbrido Yahoo/FMP + `/ipo-radar`)  
**No bloquea:** UX-FILTERS-1…2 pueden ir en paralelo; **sí** desbloquea IPO-1b y UX-FILTERS-4 (cobertura IPO)

## Problema

`requireRecentIpo` / edad IPO filtran por `ipoDate` / `ipoAgeMonths`, pero el materializado nocturno deja **≈0 filas** con fecha (ver `lib/scoringEngine.js` ~649). Radar IPO hunt = empty permanente.

## Alcance

1. **Fuente:** Yahoo `firstTradeDate` (`lib/yahoo.js` ya expone `ipoDate` en profile) → fallback FMP `ipoDate` → si no hay: ausencia declarada (no inventar).
2. **Persistencia:** `researchRow` / proyección light / materializado deben llevar `ipoDate` + `ipoAgeMonths` calculado (`monthsSince`) en filas US **e intl**.
3. **Backfill:** script o job puntual + path en nocturno/cron para no perder el campo en corridas nuevas. Preferir no tocar DDL si las columnas ya existen en payload JSON/metrics.
4. **Motivo ausente:** si se puede, motivo estable (`ipo-date-unavailable`) usable por UX-FILTERS-4; si no cabe en schema, al menos `ipoDate: ""` y `ipoAgeMonths: null` consistentes.
5. **Éxito cuantitativo:** en snapshot típico US (o merge), **≥15 filas** con `ipoAgeMonths ≤ 60` (o documentar tope real del proveedor y umbral ajustado). Smoke: al menos un `.HK` o `.L` con fecha si Yahoo/FMP la dan.
6. Tests unitarios del path de población + (si hay harness) sample materializado.

## Fuera

- UI ficha / preset discovery (IPO-1b).
- Feed IPO de pago.
- Re-añadir `ipoScore` al composite.

## Verificación

```bash
npm test -- (archivos tocados: researchRow, yahoo, materialized, ipo…)
./vfc 'ipoDate|researchRow|materialized|yahoo'
```

Opcional smoke: query/local filas con `ipoDate` no vacío tras backfill `--write` (dueño OK para write).

Modelo: **Fable 5** o Opus · HIGH. Sin commit ni push.
