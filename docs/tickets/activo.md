# Ticket activo — CAZA-SPARKS-SCROLL-1

**Estado:** activo · programación en Agent chat aparte  
**Rama:** `codex/statsedge-ui-polish` @ `d05b00d`  
**Modelo:** Composer 2.5 High (o Terra)  
**Origen:** residual SCANS-CHARTPREVIEW-HYDRATE-STABLE-1 · plan datos #2  
**Nota:** Ya existen `computeHuntChartPreviewHydrateStart`, evento viewport y listener en `page.jsx` / `HuntTapeView.jsx`. El ticket es **cerrar el residual en uso real**: si al scrollear >80 no llegan sparks, arreglar; si sí llegan, evidenciar y documentar cierre.

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md

Eres programación StatsEdge (NO orquestador). Rama: codex/statsedge-ui-polish @ d05b00d.
Modelo: Composer 2.5 High (o Terra). SIN commit ni push.

Ticket CAZA-SPARKS-SCROLL-1 — sparks Caza al scroll >80 (ventana, no top fijo).

Alcance:
1) Reproducir en :3300 Caza US (Mini UP): scrollear más allá de ~80 filas.
   ¿Aparecen SVG/sparks en la ventana visible o quedan pending/vacíos?
2) Si falla: fix mínimo en el cableado (HuntTapeView scroll →
   emitHuntChartPreviewViewport → page hydrateStart / huntRowsForChartPreviewHydrate).
   Causas probables: rowHeight vs densidad Compacto/Cómodo, no emitir scroll,
   start no actualiza el efecto, cancel de in-flight, etc.
3) Si ya funciona: no refactor; tests de regresión si faltan + evidencia
   (conteo SVG en viewport profundo o script Playwright).
4) Mantener cap ≤80 por POST; no hidratar toda la cola.

No tocar scoring, auth, nocturno, VCP detector, Europa, ops Mini scripts
salvo usarlos para smoke.

Plantilla Resumen / Archivos / Tests / LO QUE NO VERIFIQUÉ. Sin commit ni push.
```

## Objetivo

Al scrollear la cinta Caza más allá del top 80, la **ventana visible** (≈80 filas + overscan) debe hidratar `chartPreview` y pintar sparks — mismo cap, start desplazado. No volver a hidratar toda la cola filtrada.

## Contexto técnico

- `lib/scansChartPreviewHydrate.js`: `computeHuntChartPreviewHydrateStart`, `HUNT_CHART_PREVIEW_VIEWPORT_EVENT`, `huntRowsForChartPreviewHydrate({ start, limit })`.
- `app/components/screener/HuntTapeView.jsx`: emite viewport en scroll.
- `app/page.jsx`: escucha evento → `huntChartPreviewStart` → hydrate.
- Tests unitarios ya cubren start/window (`tests/scansChartPreviewHydrateStable.test.js`).
- Residual documentado en STABLE-1: «Scroll profundo Caza >80: aún sin hydrate por viewport».
- Smoke ops: `npm run ops:mini-smoke:start` (no valida scroll profundo hoy).

## Fuera de alcance

- Subir el cap por encima de 80 de forma permanente  
- Hydrate de Auditoría / tabla completa  
- Redesign densidad Caza  
- Commit / push

## Done when

1. Evidencia PASS: tras scroll profundo, filas visibles tienen spark SVG (o «sin serie» honesto), no pending eterno del top-only. **O** bugfix + tests.  
2. Cap por request sigue ≤80.  
3. `./vfc` o vitest focalizado OK.  
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
