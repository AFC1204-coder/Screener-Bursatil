# Backlog activo — StatsEdge

Fuente de verdad operativa para el orquestador. Actualizar tras cada ticket cerrado.
Análisis base: `docs/analisis-screener-uso-real-2026-08-23.md`, `docs/analisis-vista-rapida-2026-08-24.md`.

Última actualización: 2026-08-26 · rama `codex/statsedge-ui-polish`

Ticket en curso: **P6e** → `docs/tickets/activo.md` (abrir en Agent chat **aparte**).

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

## Siguiente (orden sugerido)

| ID | Qué | Notas | Modelo sugerido |
|---|---|---|---|
| P6e | Ordenar por columna invisible (Deterioro): mostrar columna cuando el preset la usa, o no ordenar por ella | Resto de P6; barato | Composer / bajo |
| P4 | Separar «traer datos frescos» (conserva criterios) de «resetear criterios» | P1 ya refresca; el botón Reset sigue siendo nuclear | Composer / medio |
| P5 | Capas: avisar si apagar una degrada `setupMode` / otras reglas | C11 medido en análisis | Composer / medio |
| P3 | Rendimiento del gesto (<200 ms): fast-path `screenPassed`, memo por orden, debounce save | Más delicado; medir antes/después | Grok o Composer / alto; smoke de gesto |

## Aplazado / no oleada UI

- Cutover Hito 1, tenancy, Twelve Data licencia — ver memoria Claude / ADRs.
- Contracciones / VCP en producto — `research/contracciones/`; no shipping.
- Merge `refactor/chart-controller-*` — divergencia grande; no trivial.
- Traducir inglés estructural restante (Results, Leadership pulse, …).

## Convención

- Un ticket = un tema verificable.
- Programación: sin commit/push; plantilla de retorno en `.cursor/rules/orquestacion-statsedge.mdc`.
- Orquestador: verify + smoke visual si aplica + commit + marcar fila aquí.
