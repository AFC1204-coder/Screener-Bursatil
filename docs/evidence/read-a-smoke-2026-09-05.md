# READ-A — smoke Mini 2026-09-05

Host: `http://127.0.0.1:13000/` · deploy 6 archivos · `npm run build` · kickstart · next=200.

## Mesa US (EE. UU. · Líderes Etapa 2 · 50 filas)

Cabeceras: `TICKER · TEMA · RS · ETAPA · VCP · Rend. 3M · Dist. máx 52s · Capitaliz.`

| Check | Resultado |
|---|---|
| RS tema | **Ausente** |
| RS país | **Ausente** |
| RS | Presente |
| VCP | Presente |

## Mesa Core intl (auto → Líderes intl · 50 filas)

Cabeceras: `… · RS · RS país · ETAPA · VCP · …`  
Mesa: `CA+CH+DE+ES+FR+GB+HK+IT+NL+SE`

| Check | Resultado |
|---|---|
| RS tema | **Ausente** |
| RS país | **Presente** |
| RS + VCP | Presentes |

## Tests (Mac)

95 passed en suites READ-A; suite global reportada por programación 2717 passed.
