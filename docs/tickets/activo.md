# Ticket activo — FICHA-UI bloque `/stock`

**Estado:** verificación orquestador  
**Rama:** `cursor/stock-ficha-ui-brief-a547` → PR vs `codex/statsedge-ui-polish`  
**Modelo:** Composer  

## Alcance (brief dueño 2026-09-05)

1. **Clasificación compacta (izq.)** — Vigilar / Candidata / Descartar (+ Reabrir) en desplegable junto a «CLASIFICACIÓN» / historial manual.  
2. **+ lista (arriba der.)** — Añadir ticker a favoritos (watchlist local); picker preparado si hubiera más destinos.  
3. **Buscador centrado** — Sobre el gráfico, salto rápido a otra ficha (`/api/search` + candidatos del screener).

**No tocado:** scoring, VCP, RS overlay, MIGRATE, CLEAN-4, defaults RS.

## Entregable programación

- `StockUserClassification` → barra `stockClassificationBar` + `stockDecisionActionMenu`
- `StockAddToListButton` + `lib/stockListActions.js` (favoritos vía `createFavoriteFromRow`)
- `StockSymbolSearch` sobre `stockChartPanel`
- CSS en `styles/components.css`
- Tests: `tests/stockFichaUiBrief.test.js`, `tests/stockDecisionRailCss.test.js`, `tests/stockFire1MobileFold.test.js`

## Hueco documentado

- **Listas de usuario:** solo **Favoritos** (`STORAGE_KEYS.favorites`). Las vistas guardadas (`listViews`) son filtros de discovery, no colecciones de tickers. Multi-lista UI lista; falta segundo destino de producto.

## Verificación pendiente (orquestador)

- [ ] `git diff` real vs brief  
- [ ] `npm test` superficies tocadas  
- [ ] Smoke visual `:3300` o `:3000` — clasificación, +lista, buscador  
- [ ] Commit si gates OK  
