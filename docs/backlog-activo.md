# Backlog activo — StatsEdge

Fuente de verdad operativa para el orquestador. Actualizar tras cada ticket cerrado.
Análisis base: `docs/analisis-screener-uso-real-2026-08-23.md`, `docs/analisis-vista-rapida-2026-08-24.md`.

Última actualización: 2026-08-26 · rama `codex/statsedge-ui-polish`

Ticket en curso: ninguno. Siguiente sugerido: **P5** o **P3** (decidir tras uso real).

## Hecho (esta oleada)

| ID | Qué | Commit |
|---|---|---|
| P1 | Sesión caduca en frontera nocturna; refresh conserva criterios | `476cab4` |
| P2 | Copia muestreada → re-fetch; fallo → aviso + muestra | `476cab4` |
| B2 / chart | Vacío usa `emptyFallback`, no «Sin dato» fijo | `219e075` |
| P6a | H1 = nombre del preset | `cd20747` |
| P6b | Badge avanzado vs baseline de sesión | `cd20747` |
| P6c | Enter → ficha (fila seleccionada) | `cd20747` |
| P6d | Cajón «Más filtros» `grid-column: 1 / -1` | `cd20747` |
| P6e | Columna Deterioro cuando sort/modo weakness | `1572e80` |
| P4 | «Traer datos frescos» vs «Resetear criterios» | `5cc8c6c` |

## Siguiente (orden sugerido)

| ID | Qué | Notas | Modelo sugerido |
|---|---|---|---|
| P3 | Rendimiento del gesto (<200 ms): fast-path `screenPassed`, memo por orden, debounce save | Medido ~1,0–1,5 s por filtro en QA | Grok o Composer / alto |
| P5 | Capas: avisar si apagar una degrada `setupMode` / otras reglas | C11; solo si usas el panel avanzado | Composer / medio |

## Aplazado / no oleada UI

- Cutover Hito 1, tenancy, Twelve Data licencia — ver memoria Claude / ADRs.
- Contracciones / VCP en producto — `research/contracciones/`; no shipping.
- Merge `refactor/chart-controller-*` — divergencia grande; no trivial.
- Traducir inglés estructural restante (Results, Leadership pulse, …).
- RS de lote etiquetado «RS» en vista rápida/review.

## Convención

- Un ticket = un tema verificable.
- Programación: sin commit/push; prompt en el chat orquestador (no depender del archivo).
- Orquestador: verify + smoke visual si aplica + commit + marcar fila aquí.
