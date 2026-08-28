# Backlog activo — StatsEdge

Fuente de verdad operativa para el orquestador. Actualizar tras cada ticket cerrado.
Análisis base: `docs/analisis-screener-uso-real-2026-08-23.md`, `docs/analisis-vista-rapida-2026-08-24.md`.

Última actualización: 2026-08-28 · rama `codex/statsedge-ui-polish`

Ticket en curso: **UX-11** (pendiente ticket) · siguiente lógico tras UX-12.  
Último cerrado: **UX-12** (Revisar → `/review`).  
Anterior: **UX-10** (`d3dfce9`).  
**Prioridad mercados:** US (base) · HK · CA · Europa.  
**Decisión producto (2026-08-27):** versión **privada multi-mercado** para uso propio; lanzamiento público condicionado a viabilidad de licencia de datos. Resoluciones en nube **no relevantes**. Conservar esta línea (git/rama) como base de una eventual versión pública.  
**Decisión producto (2026-08-28):** RS global FX = track **privado** (`statsedge-private-global-rs-usd-v1`). Público v1 previsto **US-only** (`statsedge-us-equity-rs-v1` pinneado) — el global no contamina la versión pública. Spec: `docs/spec-rs-global-multi-mercado-fx.md`.  
**Decisión IA filtros (2026-08-27):** dirección **propuesta A (mesa de vistas)**; P0 + UX-5 + oleada producto-final (P1…P5, UX-6…9) hechos.  
**Decisión métricas (2026-08-27, no inmediato):** RS **global** = un solo ranking del universo privado con **ajuste por divisa**; RS **país** = calidad dentro del propio país; RS **tema** = por a qué se dedica la empresa (theme). Más adelante: muletas de tendencia + índice 0–100 de salud de etapa. VCP e indicadores nuevos = track paralelo.  
**Gate cierre:** tests del ticket + **`./vfc`** + smoke Browser Use.  
**Modelo brief UX-P:** Gemini 3.7 Flash (aceptado).

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
| UX-4 | Purga filtros fantasma de vista; smoke 47=47 con claves fantasma | `a890fa8` |
| UX-3 | Invariante sort↔periodo + cabeceras clicables; smoke 3M/6M/↑ + reload | `2ad795e` |
| UX-2 | Línea de verdad + 1 banner mercados con CTA; smoke CTA resuelve stale | `60985a3` |
| UX-5 | Rail 5 fichas de caza; smoke US/Deterioro/pivot/Core intl 198/210 | `2690ed7` |
| UX-P | Brief producto final (Gemini); chrome laboratorio → podar | `f9588a0` + análisis |
| UX-P1 | Chrome superior: sin Estado OK; percentil = badge; smoke | `58c2aa4` |
| UX-P2 | Toolbar: JSON audit en ⋯; Revisar primario; «Resultados» | `58c2aa4` |
| UX-6 | Sidebar: Ajustes de sesión; bases en advanced; smoke EE.UU. 47/3321 | `52d2f47` |
| UX-P3 | Banderas en Personalizar mercados; presets regionales; smoke | `52d2f47` |
| UX-7 | «+ Filtro»; chips con impacto; Vista N/M; smoke tema −46 | `7882d82` |
| UX-P4 | Modal nav/salida agrupados; triage active; smoke Candidata | `7882d82` |
| UX-P5 | Móvil 390: rail scroll; drawer sheet; smoke | `0f42cda` |
| UX-8 | Desglose «¿Qué recorta?» bajo verdad; smoke 47/3321 | `0f42cda` |
| UX-9 | Ranking provisional + corte; Datos *; smoke | `86224c0` |
| MET-1 | Spec RS global multi-mercado + FX (aceptado; privado global / público US-only) | `877c318` |
| UX-REVIEW | Pasada extensa screener filtros/navegación (Browser Use; sin P0) | `docs/analisis-ux-screener-review-2026-08-28.md` |
| UX-10 | Copy familia RS alineado MET-1b (sidebar + modal) | `d3dfce9` |
| UX-12 | Revisar toolbar → `/review?source=current&symbol=…` | (pending) |

## Siguiente — oleada post-review (P1)

| ID | Qué | Estado |
|---|---|---|
| UX-11 | Latencia ficha rail (<200 ms o feedback) | **Siguiente** |
| UX-13 | Cobertura RS ~47 % Sin dato en Líderes E2 | Pendiente · **decisión dueño** |
| UX-14 | CTA stale mercados consistente | Pendiente |
| UX-15 | Toggle familia RS vs expandir reglas | Pendiente |
| UX-16 | Líderes intl guardrail datos ≠ mercados | Pendiente |

## P2 (post-review)

UX-17…21 — vista rápida, móvil tabla, localStorage, «visibles» vs paginación, botones Ordenar redundantes. Ver informe §Tickets propuestos.

## Chart (pendiente oleada screener)

| ID | Qué | Estado |
|---|---|---|
| CHART-RS | RS solo overlay en gráfico (sin panel duplicado) | Pendiente · `docs/tickets/CHART-RS-overlay-sin-pane.md` |

## Track métricas (pendiente)

| ID | Qué | Estado |
|---|---|---|
| MET-1c | Cron semanal motor global privado | Tras smoke OK dueño |
| MET-2 | Spec RS país (calidad intra-país) | Decisión dueño; sin ticket |
| MET-3 | Spec RS tema (ocupación / theme) | Decisión dueño; sin ticket |
| MET-4 | Muletas tendencia (persistencia MA, aceleración, volumen) | Ideas; sin ticket |
| MET-5 | Índice 0–100 salud de etapa (ponderado; no interruptor 1–4) | Ambicioso; tras MET-1…4 |
| MET-6 | RS en stress / bajadas (sin beta baja disfrazada) | Idea; sin ticket |
| VCP | Detector producto vs corpus `research/contracciones/` | Aplazado / investigación |

~~IL/CN/BR/MX~~ aplazado.

## Track internacional (privado, pre-licencia pública)

Objetivo: las filas **no-US ya persistidas** entran en presets, filtros, tabla, vista rápida y ficha con la **misma dinámica** que US (salvo ausencias declaradas con motivo).

**Alcance de la auditoría INT-0:** leer del repo, no preguntar al dueño — `DEFAULT_MARKETS` (`lib/screenerConfig.js`), `CURATED` / `EXTRA_UNIVERSES` / `EXPANDED_CORE` (`lib/universes.js`), `DEFAULT_SCAN_MARKETS` (`lib/markets.js`), y cruzar con símbolos que ya existen en scans/`scan_results`.

| Capa | Estado conocido | Riesgo |
|---|---|---|
| Universo / símbolos | `lib/universes.js` + FIRDS/HKEX/J-Quants/TWSE/ASIC; Europa puede degradar a listas curadas si flags off | Población parcial sin aviso |
| Scan / benchmarks | `serverScanRunner.loadBenchmarks` hidrata ^IBEX, ^GDAXI, etc. (fix documentado) | Verificar en scans vivos, no asumir |
| RS canónico | Ranking semanal **global privado** (`statsedge-private-global-rs-usd-v1`); intl sin snapshot → «–» + motivo | MET-1b activo |
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
