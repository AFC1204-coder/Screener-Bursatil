# IPO-1b — Preset discovery + ficha Radar IPO

**Prioridad:** P1 producto · **Tras:** IPO-1a código + write (perfil poblado; filas scan llegan con nocturno)
**Spec:** `docs/tickets/IPO-1-radar-producto.md` · wire UX-FILTERS §3.1

## Contexto

`ipoDate` ya está en `fundamental_snapshots` (US ~5893 + intl). Las filas del screener lo verán al **próximo materializado/nocturno** (resuelve desde perfil cacheado). No hace falta re-fetch masivo de Yahoo ahora.

## Alcance

1. **Preset `ipoDiscovery`** (o sustituir el que usa el rail):
   - `setupMode: ipoRecent`, `requireRecentIpo: true`, `maxIpoAgeMonths: 60`–`84`
   - Umbrales **discovery**: sin (o muy bajos) minCap / minPerf / cobertura estricta; intl tolera cobertura parcial
   - No el preset institucional actual (cap 300M, perf3m≥10…)
2. **Rail** ficha «Radar IPO» → `ipoDiscovery` (`lib/screenerHuntCards.js`).
3. **Empty state** honesto:
   - Si 0 pasan y cobertura `ipoDate` baja → mensaje + CTA a `/ipo-radar`
   - Si hay filas → listado usable (sort perf / edad)
4. Opcional ligero: enlace nav a `/ipo-radar` (si cabe sin abrir IPO-1c entero).
5. Tests preset + hunt card; smoke Browser Use tras datos en scan (o mock + nota «pendiente nocturno»).

## Fuera

- UX-FILTERS tarjeta completa (1d = FILTERS-3+4).
- Feed pre-IPO automático.
- Rematerializado masivo (orquestador: nocturno).

## Verificación

```bash
npm test -- screenerHunt screenerFilter
./vfc 'screenerHunt|screenerFilterCatalog|ipo'
```

Smoke: ficha Radar IPO con filas recientes **si** el scan ya trae `ipoAgeMonths`; si no, empty state con motivo + CTA.

Modelo: Composer / MiniMax M3 · MED–HIGH. Sin commit ni push.
