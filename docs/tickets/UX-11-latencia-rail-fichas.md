# UX-11 — Latencia perceived al cambiar ficha rail

**Prioridad:** P1 · **Origen:** UX-REVIEW H-02 · `docs/analisis-ux-screener-review-2026-08-28.md`

## Problema

Tras «Resetear criterios», cambiar ficha en `HuntCardRail` tarda **688–3517 ms** percibidos antes de que la tabla/verdad reflejen el nuevo preset:

| Ficha | ms (review) |
|---|---|
| Líderes Etapa 2 | ~1037 |
| Cerca pivot | ~1157 |
| Deterioro | ~917 |
| Líderes intl | ~2366 |
| Radar IPO | ~3517 |

Objetivo producto (P3): gesto de filtro **<200 ms perceived**. El rail es el mismo gesto mental: «cambio de vista de caza».

## Hipótesis técnica (verificar en código)

- `applyHuntCard` → `huntCardSelection` → `setPreset(selection.presetKey, { sort })` (`app/page.jsx`).
- `setPreset` puede disparar recomputación completa del pipeline sobre ~3300 filas (sort + capas + sectorize) en el hilo principal.
- P3 añadió fast-path para toggles de filtro (`3558ad5`); el rail puede **no** usar ese camino.

## Alcance

1. **Medir** el camino `applyHuntCard` → tabla actualizada (marcas `performance.now` o reutilizar patrón P3 si existe).
2. **Objetivo UX:** al clic en ficha rail, feedback **inmediato** (<200 ms):
   - Opción A: fast-path preset hunt (reusar datos ya materializados sin re-fetch).
   - Opción B: optimistic UI (verdad + tabla stale 1 frame + skeleton/spinner en rail activo).
   - Opción C: `startTransition` + indicador «Actualizando…» si el cálculo real no cabe en 200 ms — **solo** si A/B no bastan; documentar ms antes/después.
3. **No cambiar** semántica de presets hunt (`lib/screenerHuntCards.js`) ni scoring.
4. Radar IPO (0 filas) debe responder igual de rápido (empty state, no bloqueo 3.5 s).
5. Test: unit del handler o benchmark vitest si ya hay patrón P3 en `tests/screenerFilter*`.

## Verificación

```bash
npm test -- screenerHunt screenerFilter
./vfc 'HuntCard|applyHunt|page.jsx|screenerHunt'
```

Browser Use (hard-reload `:3000`):
- Resetear criterios → clic Líderes Etapa 2 → Deterioro → Líderes intl.
- Anotar ms hasta verdad actualizada (`N pasan «…»`) y filas DOM.
- Objetivo: **<200 ms perceived** o feedback visible en el primer frame.

## Fuera

- UX-16 (semántica Líderes intl con solo US cargado).
- UX-20 (copy «visibles» vs paginación).
- Re-fetch de scans / mercados.

Modelo: Composer o MiniMax M3 · effort **HIGH**. Sin commit ni push.
