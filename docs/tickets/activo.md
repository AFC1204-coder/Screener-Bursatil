# Ticket activo — REVIEW-CHART-PAINT-1

**Estado:** activo · programación en Agent chat aparte  
**Rama:** `codex/statsedge-ui-polish` @ `9554309` (post-#41)  
**Modelo:** Composer 2.5 High (o Terra)  
**Origen:** smoke Top5+baratos 2026-09-19 — P7/P8 PARTIAL  
**Evidencia:** Agent Store `internal/smoke-top5-baratos.md`

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md

Eres programación StatsEdge (NO orquestador). Rama: codex/statsedge-ui-polish @ 9554309.
Modelo: Composer 2.5 High (o Terra). SIN commit ni push.

Alcance:
1) Diagnosticar por qué en /review?symbol=AAPL (y mesa→Revisar) el chart
   se queda en «Cargando histórico…» sin pintar línea/velas (smoke PARTIAL
   P7/P8; path/title ya OK).
2) Fix acotado para que el histórico pinte (preview línea y/o OHLC); no
   dejar loading eterno ni colgar el tab.
3) Tests focalizados de lo que toques + ./vfc si aplica.

No tocar scoring, auth, nocturno, writers, company-brief/Astra.

Plantilla Resumen / Archivos / Tests / LO QUE NO VERIFIQUÉ. Sin commit ni push.
```

## Objetivo

En Vista rápida (`/review?symbol=AAPL` y lanzamiento mesa→Revisar), el path y el título «Vista rápida» ya están bien (#39). El residual del smoke es que el chart se queda en **«Cargando histórico…»** sin pintar.

Arreglar el paint del histórico (o un error honesto si el dato no llega). No dejar loading eterno ni colgar el tab de Chrome.

## Contexto técnico útil

- Smoke: Mini UP, mesa US hidratada; Review path OK; captura PNG de review timeouteó.
- Áreas probables: `app/review/page.jsx`, `app/useChartController.js`, `app/useReviewChartPreviewHydrate.js`, `lib/reviewChartPreviewHydrate.js`, chart fetch/cache, `/api/chart` o preview hydrate.
- No reabrir P7 path/title salvo que el fix lo requiera.

## Fuera de alcance

- Scoring / auth / nocturno / writers  
- Company-brief / Astra  
- B/C/D cobertura Global profunda  
- Commit / push (los hace el orquestador tras verify)

## Done when

1. En `:3300` hard-reload, `/review?symbol=AAPL` pinta histórico (o error honesto visible).  
2. Mesa → Revisar no deja loading eterno.  
3. Tests de lo tocado + `./vfc` si aplica.  
4. Retorno con plantilla; **sin commit ni push**.

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
