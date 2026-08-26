# Backlog activo — StatsEdge

Fuente de verdad operativa para el orquestador. Actualizar tras cada ticket cerrado.
Análisis base: `docs/analisis-screener-uso-real-2026-08-23.md`, `docs/analisis-vista-rapida-2026-08-24.md`.

Última actualización: 2026-08-26 · rama `codex/statsedge-ui-polish`

Ticket en curso: ninguno. Siguiente sugerido: **P5** o RS mentiroso en vista rápida.

## Hecho (esta oleada)

| ID | Qué | Commit |
|---|---|---|
| P1 | Sesión caduca en frontera nocturna; refresh conserva criterios | `476cab4` |
| P2 | Copia muestreada → re-fetch; fallo → aviso + muestra | `476cab4` |
| B2 / chart | Vacío usa `emptyFallback`, no «Sin dato» fijo | `219e075` |
| P6a–e | Título, badge, Enter→ficha, Más filtros, columna Deterioro | `cd20747` / `1572e80` |
| P4 | «Traer datos frescos» vs «Resetear criterios» | `5cc8c6c` |
| P3 | Gesto de filtro &lt;200 ms (fast-path / no sectorize / sort / debounce) | `3558ad5` |

## Siguiente (orden sugerido)

| ID | Qué | Notas | Modelo sugerido |
|---|---|---|---|
| P5 | Capas: avisar si apagar una degrada `setupMode` / otras reglas | Solo si usas el panel avanzado | Composer |
| RS lote | RS de lote etiquetado «RS» en vista rápida/review | Misma familia “número que miente” | Composer / medio |

## Aplazado / no oleada UI

- Cutover Hito 1, tenancy, Twelve Data, contracciones/VCP, merge chart-controller.
- Traducir inglés estructural restante.

## Convención

- Programación en chat aparte; prompt en el orquestador.
- Orquestador: verify + smoke + commit.
