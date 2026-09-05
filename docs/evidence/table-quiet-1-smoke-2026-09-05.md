# TABLE-QUIET-1 — smoke Mini 2026-09-05

Host: `http://127.0.0.1:13000/` (túnel → Mini Next).  
Deploy: rsync `screenerColumns.jsx` + `themeRs.js` · `npm run build` · `kickstart com.statsedge.next` · next=200.

## Mesa US (50 filas, hard-reload)

| Columna | Missing | InfoHint en celda | Con valor |
|---|---|---|---|
| VCP | 30 | **0** | 20 (vcpTag) |
| RS tema | 29 | **0** | 21 (número) |

Muestra: ATRC / MAN / AVAH / ANRO → VCP `–` sin `infoHint`; RS tema con número o `–` quieto.

Cabeceras siguen con InfoHint de leyenda (UX-23) — esperado.

## Tests (Mac)

`npm test -- tests/tableQuiet1.test.js tests/ausenciaExplicita.test.js tests/themeRs.test.js tests/screenerSevenColumns.test.js` → 49 passed.
