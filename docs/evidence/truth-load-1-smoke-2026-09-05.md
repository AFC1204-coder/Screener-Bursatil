# TRUTH-LOAD-1 — smoke Mini 2026-09-05

Host: `http://127.0.0.1:13000/` (túnel → Mini Next). Deploy: rsync `screenerTruthLine.js` + `ScreenerShell.jsx` · `npm run build` · `kickstart com.statsedge.next`.

## Hard-reload `/` (HK, muestra parcial)

| Momento | Evidencia |
|---|---|
| Durante carga | Truth: `cargando… · mesa: HK · orden: Rendimiento 3M ↓ · corte 5 sept, 12:41` |
| Status | `Cargando el escaneo nocturno...` |
| Banner | `UNIVERSO PARCIAL · Se muestran 157 de 204…` |
| Mentira 0·0·0 | **No** |
| Tras settle | `157 analizadas · 12 pasan «Líderes intl» · 12 en lista · mesa: HK · …` |

## Gates

- vitest truth+misalignment: 39 passed
- `./vfc`: 2682 passed · lint OK
