# Backlog activo — StatsEdge

Fuente de verdad operativa para el orquestador. Actualizar tras cada ticket cerrado.
Análisis base: `docs/analisis-screener-uso-real-2026-08-23.md`, `docs/analisis-vista-rapida-2026-08-24.md`.

Última actualización: 2026-08-27 · rama `codex/statsedge-ui-polish`

Ticket en curso: **siguiente** (AU en vivo opcional / INT-1+).  
Último cerrado: **INT-1-HK-select**.  
**Decisión producto (2026-08-27):** versión **privada multi-mercado** para uso propio; lanzamiento público condicionado a viabilidad de licencia de datos. Resoluciones en nube **no relevantes**.

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
| P5 | Aviso al apagar capas que degradan `setupMode` / reglas doble capa | `9ee5775` |
| B2-chart | Preview línea instantáneo + transición velas; timeout 15s fetch; smoke modal/review OK | `5d28d5f` |
| INT-0 | Auditoría multi-mercado (repo ↔ Supabase) | `36cbcdd` |
| INT-1-P1 | Cargar materializado al elegir 1 mercado; aviso HK sin scan; smoke CA/US/HK | `b46dfb1` |
| INT-1-P0 | Banner mercados stale + TW no seleccionable; smoke arranque/Asia/CA | `9911f84` |
| INT-1-HK-AU | Cohorts cron HK/AU dedicados (plan); 1ª corrida HK = 4 filas (penny @ offset 130) | `0cc62ba` |
| INT-1-HK-select | Curado primero en cola HK/AU; cron HK → 23 filas; chip carga 23 | _(hash tras commit)_ |

## Siguiente (orden sugerido)

| ID | Qué | Notas | Modelo |
|---|---|---|---|
| INT-1-AU-run | Corrida `oceania-australia` + smoke chip AU | Núcleo curado AU = 10; relleno dump | Orquestador |
| INT-1+ | Fusión multi-mercado; KR/IN/… | Después | Composer |

## Track internacional (privado, pre-licencia pública)

Objetivo: las filas **no-US ya persistidas** entran en presets, filtros, tabla, vista rápida y ficha con la **misma dinámica** que US (salvo ausencias declaradas con motivo).

**Alcance de la auditoría INT-0:** leer del repo, no preguntar al dueño — `DEFAULT_MARKETS` (`lib/screenerConfig.js`), `CURATED` / `EXTRA_UNIVERSES` / `EXPANDED_CORE` (`lib/universes.js`), `DEFAULT_SCAN_MARKETS` (`lib/markets.js`), y cruzar con símbolos que ya existen en scans/`scan_results`.

| Capa | Estado conocido | Riesgo |
|---|---|---|
| Universo / símbolos | `lib/universes.js` + FIRDS/HKEX/J-Quants/TWSE/ASIC; Europa puede degradar a listas curadas si flags off | Población parcial sin aviso |
| Scan / benchmarks | `serverScanRunner.loadBenchmarks` hidrata ^IBEX, ^GDAXI, etc. (fix documentado) | Verificar en scans vivos, no asumir |
| RS canónico | Ranking semanal **solo universo US** (`rs_weekly_items`); intl → «–» + motivo (correcto) | No confundir con bug |
| RS vs benchmark / composite | Percentiles de **lote**; mezcla multi-mercado cambia semántica | Producto: ¿filtrar por país antes de comparar? |
| Nocturno / «qué cambió» | `weekly-changes` acotado a MIC US | Intl sin franja comparable |
| Fundamentales ficha | EDGAR solo US; intl limitado | OK en privado con aviso |
| Chart / API | B2-chart cerrado (preview línea + fetch OHLC) | Verificar intl en INT-0 |

Licencia pública: Twelve Data Venture (~499 $/mes exhibición) u equivalente — **aplazado** hasta decisión de monetización (`docs/analisis-datos-financieros-2026-08-22.md` C.3–C.4).

## Aplazado / no oleada UI

- Cutover Hito 1, tenancy, Twelve Data, merge chart-controller.
- **VCP / contracciones en producto** — investigación activa en `research/contracciones/` + docs (`diseno-contracciones*.md`, citas Minervini/O'Neil/Weinstein); detector producto sigue en `lib/setupPatterns.js`.
- Traducir inglés estructural restante.
- Dos colas modal vs `/review` (estructural; baja prioridad si el modal basta).
- ~~Resoluciones en nube~~ — **descartado** (dueño: no relevante).
- Badge «RS global» en chart — subsumed by B2-chart smoke.

## Convención

- Programación en chat aparte; prompt en el orquestador.
- Orquestador: verify + **smoke en página con Browser Use** (no pedir checklist mecánico al dueño) + commit.
