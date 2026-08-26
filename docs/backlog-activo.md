# Backlog activo — StatsEdge

Fuente de verdad operativa para el orquestador. Actualizar tras cada ticket cerrado.
Análisis base: `docs/analisis-screener-uso-real-2026-08-23.md`, `docs/analisis-vista-rapida-2026-08-24.md`.

Última actualización: 2026-08-26 · rama `codex/statsedge-ui-polish`

Ticket en curso: ninguno. Siguiente: **uso real** 15–20 min antes de más tickets.

## Hecho (esta oleada)

| ID | Qué | Commit |
|---|---|---|
| P1 | Sesión caduca en frontera nocturna; refresh conserva criterios | `476cab4` |
| P2 | Copia muestreada → re-fetch; fallo → aviso + muestra | `476cab4` |
| B2 / chart | Vacío usa `emptyFallback`, no «Sin dato» fijo | `219e075` |
| P6a–e | Título, badge, Enter→ficha, Más filtros, columna Deterioro | `cd20747` / `1572e80` |
| P4 | «Traer datos frescos» vs «Resetear criterios» | `5cc8c6c` |
| P3 | Gesto de filtro &lt;200 ms (fast-path / no sectorize / sort / debounce) | `3558ad5` |
| RS smoke | RS canónico en tabla, vista rápida y `/review` (Browser Use 2026-08-26) | (código previo `1f20345` / guards tests) |
| P5 | Aviso al apagar capas que degradan `setupMode` / reglas doble capa | _(este commit)_ |

## Siguiente (orden sugerido)

_(vacío — oleada P1–P6 + P5 cerrada; siguiente ítem tras uso real)_

## Aplazado / no oleada UI

- Cutover Hito 1, tenancy, Twelve Data, contracciones/VCP, merge chart-controller.
- Traducir inglés estructural restante.
- Dos colas modal vs `/review` (estructural).
- Badge «RS global» en chart: smoke pendiente si el histórico no termina de cargar (B2 / API histórico; no reimplementación RS).

## Convención

- Programación en chat aparte; prompt en el orquestador.
- Orquestador: verify + **smoke en página con Browser Use** (no pedir checklist mecánico al dueño) + commit.
