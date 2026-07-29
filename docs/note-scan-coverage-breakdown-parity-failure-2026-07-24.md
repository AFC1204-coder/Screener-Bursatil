# Nota — fallo de paridad país/sector preexistente en scanCoverageBreakdown (2026-07-24)

> Estado: nota de seguimiento, no bloqueante. No es un ADR ni una
> decisión de producto.

## Qué se observó

`tests/scanCoverageBreakdown.test.js` y su equivalente de integración
`tests/integration/scan-coverage-breakdown.real.test.mjs` fallan en 4
tests, con el mismo patrón: los campos derivados de frescura (`fresh`,
`freshPct`, `qualityOk`, `rankingEligible`, `actionable`) y el orden de
los grupos `byCountry`/`bySector` no coinciden entre el resultado
esperado del fixture y el resultado real de
`summarizeScanCoverageBreakdown`.

## Qué se verificó

- El fallo **es preexistente en `origin/codex/statsedge-ui-polish`**
  (`661aab5`): confirmado ejecutando `tests/scanCoverageBreakdown.test.js`
  en un `git worktree` aparte apuntando a esa rama remota, con diff
  idéntico al de HEAD. No lo introdujeron los 17 commits del push del
  2026-07-24.
- Ninguno de esos 17 commits toca
  `tests/scanCoverageBreakdown.test.js`,
  `tests/integration/scan-coverage-breakdown.real.test.mjs` ni
  `lib/scanCoverageBreakdown.js` (confirmado con `git log --oneline
  <rango> -- <paths>`, salida vacía).
- El equivalente de integración (`.real.test.mjs`) **no se pudo
  verificar en origin**: en el worktree salió `skipped`, probablemente
  por falta de config/credenciales sin trackear (`.env.local`) que el
  worktree no arrastra. Queda inconcluso si también falla ahí o si
  pasa por saltarse.

## Hipótesis de causa (NO confirmada)

El fixture fija `latestScanAt: "2026-07-09T11:00:00.000Z"` y pasa
`nowMs` explícito en algunas llamadas, pero los diffs muestran que
filas cambian de "fresh" entre ejecuciones — compatible con que algún
punto del cálculo de frescura use el reloj real del sistema en vez del
`nowMs` inyectado, haciendo que el resultado dependa de cuándo se
ejecuta el test relativo a la fecha fija del fixture. **Esto es una
hipótesis a partir del diff, no una causa raíz diagnosticada en el
código.**

## Estado

Pendiente de diagnóstico. No bloqueó el push del 2026-07-24
(`661aab5..a8abc2f`) porque se confirmó preexistente en origin, ajeno
al scope de esos commits. Repetición de comprobación recomendada antes
de cualquier trabajo futuro que toque
`lib/scanCoverageBreakdown.js` o su RPC asociada.

## Resuelto

Causa confirmada y arreglada el 2026-07-25 en el commit `eafd222`:
`priceFreshness` en `app/api/scan-coverage/route.js` usaba `Date.now()`
en vez del `nowMs` recibido explícitamente. La hipótesis de esta nota
era correcta. Se conserva como registro del diagnóstico.

Verificado el 2026-07-30: `tests/scanCoverageBreakdown.test.js` pasa 5/5.
