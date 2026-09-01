# C-05 — Contrato hydrate RS en caché de mesa

**Prioridad:** P1 datos  
**Rama:** `codex/statsedge-ui-polish`  
**Auditoría:** `docs/tickets/CLEANUP-shadow-2026-09-01.md`

## Problema

`cachedScreenerRows` / arranque compacto puede devolver filas **sin RS país/tema** si la petición no lleva `hydrateRs=1`. El arranque y `pullCloudState` ya piden `hydrateRs=1` (`lib/cloudSyncClient.js`), pero no hay contrato de test que impida regresiones en otras rutas (Research Desk import, materializado por mercado, etc.).

## Alcance

1. **Test de contrato** que documente: modo `core` vs `extended` en `lib/scansRsHydration.js` + efecto en campos de fila (`rsCountryRating`, `themeRsRating` o los que use el catálogo hoy).
2. Test (o ampliar `tests/scansApiRsHydrateDefer.test.js` / `cloudSyncClientStartupRequest.test.js`) que liste **call sites** de `/api/scans` en cliente y assert que rutas de **mesa de producto** incluyen `hydrateRs=1`.
3. Comentario breve en `lib/scansRsHydration.js` o `lib/cachedScreenerRows.js`: «mesa completa requiere extended».

## Fuera de alcance

- Cambiar límites de `rowsLimit` ni performance del cron.
- Ops Vercel / C-01.

## Criterios de aceptación

- Tests nuevos o ampliados en verde.
- Sin commit ni push.

## Plantilla de retorno

(igual que UX-COPY-1)
