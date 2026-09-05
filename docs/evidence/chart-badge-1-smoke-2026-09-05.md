# CHART-BADGE-1 — smoke Mini 2026-09-05

## Fix

- `shouldShowChartPatternBadge` / `chartPatternBadgeForRow` ocultan «Sin validar · Estructura sin dato».
- `useChartController` pasa `pattern: null` cuando no hay contenido.

## Verify

- vitest methodologyDisplay + chartController: 19 passed
- `./vfc`: 2699 passed · lint OK
- Deploy Mini + rebuild

## Smoke `:13000/stock/AAPL`

| Check | Resultado |
|---|---|
| `.universalChartPatternBadge` | **ausente** |
| Combo vacío «Sin validar / Estructura sin dato» | **No** |
| Canvas chart | OK |

(Caso con badge con contenido: cubierto por unit tests; no encontrado en 1ª página Líderes E2 en este smoke.)
