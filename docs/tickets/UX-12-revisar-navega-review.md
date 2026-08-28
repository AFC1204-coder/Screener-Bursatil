# UX-12 — Revisar desde screener → `/review`

**Prioridad:** P1 · **Origen:** UX-REVIEW H-03

## Problema

Botón **Revisar** en toolbar screener (`ScreenerShell.jsx:674`) llama `openReview(resultsFiltered)` que solo persiste cola y abre **modal** vista rápida (`useQuickReviewSession.js:148-187`) — **no navega** a `/review`. El dueño espera ir a la página de review (como `/review?source=current&symbol=DK`, que sí funciona).

## Alcance

1. «Revisar» primario → `router.push('/review?source=current&symbol=…')` con cola ya persistida (misma lógica `prepareReviewQueueRows` + `persistReviewQueue`).
2. Símbolo inicial: fila seleccionada en tabla, o primera fila visible, o `selectedSymbol` si existe.
3. No romper «Revisar vista» en sidebar mobile / desglose si deben seguir siendo modal — solo el botón primario de toolbar (confirmar en código cuáles deben ir a `/review`).
4. Test: unit o smoke mínimo de URL/handler si hay patrón en `tests/screenerPercentileScopeBanner.test.js` («Revisar primario»).

## Fuera

- Rediseño cola review / decisiones.
- Unificar modal vs página (estructural; otro ticket).

Modelo: Composer · effort MED. Smoke Browser Use: clic Revisar → URL `/review`. Sin commit ni push.
