# REVIEW-MODAL-ABSENCE-1 — Vista rápida: RS y Negocio honestos (sin guiones mudos)

**Estado:** `prep`  
**Tamaño:** S (closable en un Agent chat)  
**Rama prog:** `cursor/review-modal-absence-a41e`  
**Base:** `codex/statsedge-ui-polish` @ tip post `22a9805` (feat UX-EMPTY `9e39b88` / #54)  
**Patrón:** `reviewRsCell` / `REVIEW-RS-COPY-1` · empty Negocio = `companyBriefSummaryText` / FICHA-BRIEF  
**Cola:** fricción #5 tras UX-EMPTY (#54) · antes MH-MINI-RPC (ops)  
**Inventario:** store `internal/review-astra-residual-2026-09-23.md`

## Problema

REVIEW-RS-COPY-1 dejó `/review` (grid + cola) con copy humano (`Cargando…` / `Sin ranking` / …). El journey real Enter/doble clic abre **Vista rápida** (`QuickReviewModal`), donde RS sigue siendo `"-"` si `!canonicalRs.available`. El bloque Negocio del modal fabrica «{name} opera en {industry}…» cuando no hay `businessSummary` — parece brief lleno sin ficha. Opcional en S: `ChartIdentityCard` sigue mostrando `–` mudo en Absent (Negocio `/stock` ya dice «Sin ranking»).

## Alcance (sí)

1. **QuickReviewModal — RS:** cola + fila «RS» de «El valor» → `reviewRsCell(canonicalRs(row))` (mismo `text` corto + `title` largo que `/review`). Cero celdas RS que sean solo `^[-–—]$`.
2. **Negocio del modal:** si no hay summary usable en la fila, **no** llamar a `quickBusinessDescription` que inventa «opera en…»; empty corto alineado a `companyBriefSummaryText` / mensaje empty de Negocio. Actividad/Mercado: sin `"-"` mudo — copy corto o vacío honesto.
3. **Tests** focalizados (helpers del modal / extract mínimo de ausencia) + vitest del ticket / `./vfc` acotado.
4. **Stretch si cabe en S:** `ChartIdentityCard` Absent de RS (y solo RS) → mismo copy corto que `reviewRsCell` / Negocio; no rediseñar toda la tarjeta.

## No tocar

- `company-brief` en `/review` (Astra: fuera del critical path)
- Scoring, nocturno, auth, hydrateRs, chart-preview batch
- Unificar colas modal ↔ `/review` (L estructural, aparcado)
- Superficies ya cerradas por UX-EMPTY (Caza/mesa) salvo regresión accidental
- Métricas no-RS del modal (`pct`/`amount` con `"-"`) — fuera de este S salvo que el extract de ausencia sea trivial y compartido

## Archivos (previsto)

- `app/components/screener/QuickReviewModal.jsx`
- `lib/screenerFormat.js` (`quickBusinessDescription` / helper de ausencia)
- `lib/reviewRsDisplay.js` (reuso; **sin** cambiar contrato)
- `tests/reviewRsCopy.test.js` o `tests/quickReviewAbsence.test.js` (nuevo/extend)
- Stretch: `app/stock/[symbol]/ChartIdentityCard.jsx` (+ helper si hace falta)

## Criterios de aceptación

1. Modal (AAPL/AVAH u otro sin RS disponible): texto `Cargando…` / `Sin ranking` / `Sin histórico` / `Error` según estado — **0** celdas RS `^[-–—]$`.
2. Sin `businessSummary` usable en fila: Negocio no inventa actividad; mensaje vacío legible en español.
3. `/review` metric grid + panel Negocio `/stock` sin regresión de copy.
4. Tests del alcance en verde; `./vfc` si el Agent lo usa en el repo.
5. Smoke Browser (orquestador): Enter → Vista rápida; anotar RS + Negocio visibles.

## Verificación (programación)

- Grep en archivos tocados: `opera en`, `"-"` en paths RS del modal, `quickBusinessDescription` sin summary.
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
