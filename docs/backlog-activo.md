# Backlog activo — StatsEdge

Fuente de verdad operativa para el orquestador. Actualizar tras cada ticket cerrado.
Análisis base: `docs/analisis-screener-uso-real-2026-08-23.md`, `docs/analisis-vista-rapida-2026-08-24.md`.

Última actualización: 2026-08-27 · rama `codex/statsedge-ui-polish`

Ticket en curso: **libre** (dueño elige P0 UX).  
Último cerrado: **UX-1-filter-ia-redesign** (análisis → `docs/analisis-ux-filtros-ia-2026-08-27.md`).  
**Prioridad dueño:** US (base) · HK · CA · Europa.  
**Decisión producto (2026-08-27):** versión **privada multi-mercado** para uso propio; lanzamiento público condicionado a viabilidad de licencia de datos. Resoluciones en nube **no relevantes**.  
**Decisión IA filtros (2026-08-27):** dirección **propuesta A (mesa de vistas)**; tickets UX-2…UX-9 abajo.

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
| INT-1-HK-select | Curado primero en cola HK/AU; cron HK → 23 filas; chip carga 23 | `6602485` |
| INT-1-AU-run | Cron `oceania-australia` → 15 filas; chip AU carga 15 (Browser Use) | (orquestador, sin código) |
| INT-1-merge | Fusión materializados N≥2; smoke HK+AU=38 sin «no coincide» | `94b88cd` |
| INT-1-KR-IN | Cohorts KR/IN + EXTRA KR + curated-core; cron 24/22; chips OK | `6305f51` |
| INT-1-chart-intl | Smoke ficha `/stock/0005.HK` y `/stock/BHP.AX` (chart API + UI) | (orquestador) |
| INT-1-CA-EU | Curated-core CA + 8 cohorts EU priority; cron CA/GB/DE ≥15 | `56704e1` |
| INT-1-EU-run | Corridas FR/NL/CH/SE/IT/ES (NL/IT 2ª pasada por cursor) | (orquestador) |
| INT-1-intl-preset | Preset `intl` + mercados `core-intl` + auto fuera/US; smoke GB 23, Core 198/210, US Balanceado 3321 | `840ba52` |
| INT-1-EU-secondary-JP | EU2→cohorts por país + curated-core JP/secondary; cron JP24/DK24/NO23; smoke chips OK | `b1247de` |
| UX-1 | Encargo IA filtros/cáscara (stage analysis); dirección = mesa de vistas | `2c441a0` + análisis |

## Siguiente (orden sugerido)

| ID | Qué | Notas | Modelo |
|---|---|---|---|
| UX-2 | Línea de verdad única + banner mercados con 1 CTA | P0 · bug/IA cáscara | Composer Medium |
| UX-3 | Invariante orden=columna visible + sort por cabecera | P0 · principio 7.5 | Composer Medium |
| UX-4 | Purga filtros fantasma de vista (10 juicios) | P0 · «lo que no está no filtra» | Composer Medium |
| UX-5 | Rail de fichas de caza (5) | P1 · propuesta A | Composer / Fable si diseño |
| UX-6 | Editor experto honesto (sin reglas muertas; capas→secciones) | P1 | Composer Medium |
| UX-7 | Chips de vista con impacto + «+ Filtro» | P1 | Composer Medium |
| UX-8 | Desglose «qué está filtrando ahora» | P2 | Composer Medium |
| UX-9 | Copy / «1 mercado» / jerga percentil | P2 | MiniMax / Composer fast |
| ~~IL/CN/BR/MX~~ | Aplazado | — | — |

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
