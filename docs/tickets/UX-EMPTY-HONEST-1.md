# UX-EMPTY-HONEST-1 — empty / loading / error humanos (Caza + mesa)

**Estado:** `prep`  
**Tamaño:** S–M (closable en un Agent chat)  
**Rama prog:** `cursor/ux-empty-honest-a41e`  
**Base:** `codex/statsedge-ui-polish` @ `8d1ccac`  
**Patrón:** FICHA-BRIEF (`StockCompanyBriefPanel` · `loading|empty|error|ok`) + truth honesty (`buildScreenerTruthLine` / `MesaEmptyCard`)  
**Cola:** fricción #4 tras ENTRY-1 (#52) · hydrateRs COLD-1 (#53)

## Problema

Tras idle tip `8d1ccac` / COLD `7922c58`, siguen superficies con `—`/`–` mudos, spinners/pending eternos o copy de laboratorio («Spark desde chartPreview…», «base visible», jerga de materializado). El trader necesita empty / loading / error **humanos** y distinguibles — no laboratorio.

## Inventario (alcance cerrado)

| # | Superficie | Archivo / símbolo | Dolor actual |
|---|---|---|---|
| 1 | Caza sparks / cola | `lib/screenerHuntTape.jsx` → `HuntTapeSparkline`; `lib/scansChartPreviewHydrate.js` → `resolveHuntTapeSparkStatus`; `app/components/screener/HuntTapeView.jsx` (titles + celdas `–`) | pending eterno vs «Sin serie»; title lab «Spark desde chartPreview del scan»; stage/RS/dist = `–` sin motivo |
| 2 | Mesa truth + empty | `lib/screenerTruthLine.js` → `buildScreenerTruthLine`; `lib/mesaEmptyState.js` + `MesaEmptyCard`; `app/page.jsx` → `resultsEmptyLabel` / cold via `coldProgressEmptyLabel` | confusión 0-filtro vs sin-escaneo; quiet cold; copy residual no humano |
| 3 | Hunt rail pending | `app/components/screener/HuntCardRail.jsx` (`pending` / `aria-busy`) | transición de ficha sin feedback humano claro |
| 4 | Review (si residual obvio) | `app/review/page.jsx` → `reviewEmptyState` / `queueEmptyTitle` / métricas «base visible»; spark `previewEmpty` «Sin dato» | empty de cola suena a ops; «Sin dato» fijo |
| 5 | Ficha residual obvio | `app/stock/[symbol]/DescriptiveStrip.jsx` (ghost `–`); contrastar con `StockCompanyBriefPanel` (ya honesto) | solo si grep deja un `–`/«Sin dato» mudo en fold; no reescribir brief |

**Fuera:** FIRDS, scoring, auth rewrite, cold hydrateRs, chart-preview batch size, Twelve Data / 1B.

## Alcance (sí)

1. Sustituir estados vacíos/loading/error **visibles** en las filas 1–3 del inventario (y 4–5 solo si residual obvio en grep).
2. Copy en español, corto, orientado a *qué pasa* / *qué puede hacer* (no transporte, no hydrate, no chartPreview).
3. Distinguir loading vs empty asentado vs error (mismo espíritu que brief: `loading|empty|error`).
4. Tests de copy/contrato donde ya existan vecinos (`screenerTruthLine`, `mesaEmptyState`, hunt tape spark status); ampliar si hace falta asserts de strings prohibidos de lab en esas superficies.
5. Sin commit ni push (orquestador).

## Criterios de aceptación

1. En Caza: spark pending no se queda eterno sin resolución a empty humano; title/aria sin jerga `chartPreview`/scan internals; celdas críticas no son solo `–` si hay razón corta.
2. En mesa: truth/empty no mienten «0 de 0» ni compiten con status primary; empty de datos ≠ empty de filtro (MesaEmptyCard vs `resultsEmptyLabel`).
3. Review/ficha: solo toques residuales obvios; no rediseño Astra/brief.
4. Tests del alcance en verde; `./vfc` si el Agent lo usa en el repo.
5. Smoke Browser (orquestador): hard-reload Caza + mesa vacía/filtro-0 + (opcional) Review empty — anotar copy visible.

## Verificación (programación)

- Grep residual en archivos tocados: `chartPreview`, `materializ`, `hydrate`, `Sin dato` fijo donde deba ser contextual.
- No Browser obligatorio en prog; orquestador hace smoke.

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
