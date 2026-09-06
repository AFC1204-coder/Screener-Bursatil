# Inventario — residuales UX-READ (Fable) · 2026-09-06

Fuente: cierre dueño en `docs/analisis-ux-read-jerarquia-2026-09-05.md` y `docs/tickets/UX-READ-1-fable-jerarquia-lectura.md` (**Aparcado:** discordancia cifras RS · badge opacity).

Oleada READ-A′…F **cerrada**. Lo que queda son dos ítems aparcados a propósito, sin ticket de implementación hasta hoy.

## Resumen

| ID | Residual | Prioridad | Dónde vive hoy | Ticket |
|---|---|---|---|---|
| **R1** | Cifras RS distintas en la misma sesión (ej. AAPL 72 / 64 / 57) | P2 | Ficha `/stock`, overlays chart, vista rápida | `docs/tickets/READ-G-rs-cifras-coherentes.md` |
| **R2** | Badge de patrón casi invisible con tarjeta de identidad desplegada | P3 | `UniversalPriceChart` · `.universalChartFloatControls` | `docs/tickets/READ-H-badge-patron-visibilidad.md` |

**No son scoring.** No reabren READ-B (lente por ficha) ni la oleada UX-READ cerrada.

---

## R1 — Discordancia cifras RS

### Qué constató Fable (2026-09-05, AAPL)

En la misma pantalla coexistían tres lecturas de «RS»:

| Cifra | Superficie observada | Fuente probable (código HEAD) |
|---|---|---|
| **64** | Tarjeta de identidad (`RS 64`) | `stockRsUniverse(rs)` → pin `rs.rating` si existe (`app/stock/[symbol]/StockClient.jsx`) |
| **72** | Badges del chart con overlays activos (`RS 72`) | `rsMainScore` / último punto de `globalRsSeries` cuando difiere del pin (`tests/fichaRetiradas.test.js` documenta el caso) |
| **57** | Vista rápida del screener | Anotado en análisis como pendiente aparte (UX-P4); posible mezcla con percentil de lote histórico |

READ-E dejó **un overlay RS ON** y país/tema OFF por defecto (`lib/chartSettings.js`), pero **no unifica el número** que enseña la tarjeta vs el badge del head cuando la tarjeta está plegada, ni audita vista rápida vs ficha en vivo.

### Archivos implicados

- `app/stock/[symbol]/StockClient.jsx` — `stockRsUniverse`, `rsMainScore` al chart
- `app/UniversalPriceChart.jsx` — badges `rsMainScore` / país / tema en head
- `lib/chartIdentityCard.js` — RS de tarjeta
- `lib/rsCanonical.js` — regla de producto (ranking semanal, no lote)
- `app/components/screener/QuickReviewModal.jsx` + `lib/screenerMarket.jsx` — vista rápida (tests en `tests/vistaRapidaRetiradas.test.js`, `tests/rsSurfaceConsistency.test.js`)

### Qué ya está hecho (no repetir)

- READ-F: etiqueta **RS** (no FR) en tarjeta
- READ-E: overlays país/tema opt-in
- READ-D: ocultar RS país en tarjeta si = RS en US mono-mercado
- `lib/rsCanonical.js` + tests de consistencia entre mesa y modal

### LO QUE NO VERIFIQUÉ (orquestador, 2026-09-06)

- Reproducir 72/64/57 en Mini con HEAD actual (solo inventario de docs/commits).
- Si el 57 de vista rápida sigue ocurriendo tras `vistaRapidaRetiradas` y RS canónico.

---

## R2 — Badge opacity + tarjeta

### Qué constató Fable

Con la tarjeta de identidad **desplegada**, el badge de patrón (`BASE CONSTRUCTIVA 12.9% → 4.9%`, CHART-BADGE-2) pasa a `.universalChartFloatControls` en la esquina superior derecha del lienzo. Ese contenedor tiene:

```css
/* styles/components.css ~1620 */
.universalChartFloatControls {
  opacity: 0;
  pointer-events: none;
  transition: opacity .12s ease;
}
.universalChartCanvasWrap:hover .universalChartFloatControls { opacity: 1; }
```

En desktop sin hover, el badge de estructura —frase canónica de lectura según UX-READ— **no se distingue** aunque `opacity` computado pueda ser 1 en otros estados. Memoria 21-ago: «opacity 0 salvo hover» con tarjeta visible.

En móvil `≤640px` el badge dentro de float controls se **oculta** (`display: none`), otro residual de legibilidad.

### Archivos implicados

- `app/UniversalPriceChart.jsx` — ramas `identityCardShown` / `patternBadge` / `universalChartFloatControls`
- `styles/components.css` — opacity hover, media 640px
- `docs/tickets/CHART-BADGE-2-badge-vs-overlay.md` — badge ≠ markers (no tocar gating)

### Qué ya está hecho (no repetir)

- CHART-BADGE-2: badge independiente del overlay actionable
- READ-E: no mueve el badge
- Arquitectura tarjeta 2c (badge flota con nav, no en head muerto)

### LO QUE NO VERIFIQUÉ (orquestador, 2026-09-06)

- Smoke visual AAPL tarjeta desplegada + hover/no-hover en `:13000` o `:3300`.
- Contraste real del badge `.good` sobre el lienzo oscuro.

---

## Relación con backlog

- `docs/backlog-activo.md` — cola **Aparcado: residuales Fable READ** → sustituido por READ-G (P2) y READ-H (P3).
- `docs/tickets/activo.md` — sigue **idle** hasta que el dueño active uno en Agent chat.

## Commits de referencia (oleada cerrada)

| Ticket | Commit |
|---|---|
| READ-A′ | `82417e5` |
| READ-C | `557deb3` |
| READ-D | `edab7ab` |
| READ-E | `6a481f1` |
| READ-F | `67da5b3` |
| Cierre docs | `530a7e2` |
