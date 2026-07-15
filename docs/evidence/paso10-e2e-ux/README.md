# Paso 10 §10.8 — verificación visual E2E (UX sin regresión)

Capturas reales que verifican el criterio `§10.8` del ADR
`chart-controller-extraction`: "Los E2E actuales conservan la UX de
navegación, trendlines y bloqueo P0 sin nuevas capacidades visibles."

## Capturas

| Archivo | Escenario | Estado confirmado |
|---|---|---|
| `review-A-pre-switch.png` | `/review` viendo ALPHA | Header `.reviewIdentity > span > b` = `ALPHA` (`Alphabet Inc.`) |
| `03-review-switch-A-to-B.png` | Misma página, clic en BETA.DE | Header ahora = `BETA.DE` — el cambio de símbolo actualiza el identificador sin recargar la página |
| `04-review-zoom-actions.png` | Estado final tras los clics | Chart en estado `empty` correctamente (placeholder "Sin dato.") — la rama UX preservada del data model |

## Comando

```bash
# Requiere app corriendo en :3100 + STATSEDGE_ACCESS_TOKEN en .env.local
PORT=3100 node scripts/e2e/chartStep10Visual.mjs
```

## Notas

- El chart cae en estado `empty` porque el seed sintético de la
  verificación tiene <252 barras (umbral candle-grade mínimo para el
  rango `1A` diario). Esto **es la UX correcta** del cierre del Paso 9
  (rama `notice.code: "insufficient-history"` del data model, §3.4
  prioridad 7) — el chart no rompe ni entra en bucle ni entra en
  loading indefinido.
- Lo que este test descarta fehacientemente: que el cambio de símbolo
  A → B deje el identificador pegado en A, o que el chart lance una
  excepción tras `chart.remove()`.
- El contrato de no-regresión del Paso 9 está cubierto, no así los
  gestos de trendlines/drawing (escenario Canvas + pointer), que
  requieren un escenario E2E con la suite nativa de Playwright que
  invoca coordenadas exactas — fuera del scope ligero de §10.8.
