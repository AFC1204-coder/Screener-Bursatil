# Backlog activo — StatsEdge

Fuente de verdad operativa para el orquestador. Actualizar tras cada ticket cerrado.
Análisis base: `docs/analisis-screener-uso-real-2026-08-23.md`, `docs/analisis-vista-rapida-2026-08-24.md`.

Última actualización: 2026-08-30 · rama `codex/statsedge-ui-polish`

Ticket en curso: *(ninguno)*.  
Último cerrado: **MET-2c** (cron GHA RS país) — domingo 07:00 UTC.  
Anterior: **MET-2b** (`9c147c6`).  
**Cola:** **MIGRATE Mini** · **mar 2 sep 2026** (reserva mié 3) · billing hasta **5 sep**  
**Nota MET-2c (2026-08-30):** workflow `rs-country-private.yml` · cron `0 7 * * 0` + dispatch · US→intl · flags OK.  
**Nota MET-2c Actions (2026-08-30):** `workflow_dispatch` [33336486687](https://github.com/AFC1204-coder/Screener-Bursatil/actions/runs/33336486687) · **success** ~2,5 min.  
**Nota MET-2b write HK (2026-08-30):** `--write --markets=HK` · snapshot `57f94e01-…` · 74/76 · 0005.HK país **95**.  
**Nota MET-2b (2026-08-30):** verify — tests 108 OK; AAPL país **70**; fix client `node:crypto`.  
**Nota MET-2 aceptación (2026-08-30):** dueño OK — columna 2ª · curado · scoring off · cron.  
**Nota MET-1c smoke (2026-08-30):** pin OK — AAPL **61** · 0005.HK **83** · SHOP.TO 74 · 0700.HK 20 (W35, `canonicalRs` = DB). UI `/stock` bloqueada por token en tab nueva (no bloquea cron).  
**Nota R-06 (2026-08-30):** medido Browser Use (sesión logueada) — truth al cambiar ficha: E2 **1980 ms**, pivot **964**, intl **2522**, IPO **946**, Deterioro **1879**. Warm UX-11 no cumple &lt;200 ms en cold/secuencial; **sin ticket** salvo prioridad producto (chase perf). Intl/IPO muestran lag pasan vs en lista en transición (UX-22 ya tratado).  
**Nota MIGRATE (2026-08-30):** Mac Mini M4 · ruta B · MIGRATE-1…3 · **ventana 2–3 sep** · invoice end **5 sep**.  
**Nota CHART-UI-1 (2026-08-30):** smoke AAPL — `chartPrefClusterScope`+`Display` apilados; TF D y escala Precio OK; nav 7 botones.  
**Nota CLEAN-3 (2026-08-30):** smoke — 390: mobileHome 1 / desktop 0 / tape DOM 29 tiles «Índices» (CSS `display:none` intencional UX-18); ≥760: mobileHome 0 / desktop 1 / tape 0.  
**Nota CLEAN-2 (2026-08-29):** smoke — desktop 0× mobileHome; 390px 1× mobile / 0× desktop.  
**Nota UX-23 (2026-08-29):** smoke — thead 3× «i» (Tema/RS/Etapa); Ticker/Rend/Dist/Cap sin «i».  
**Nota UX-BTN-6 (2026-08-29):** smoke — chips país activo tiza/`--active-*` inset, sin fill tiza ni ámbar.  
**Nota UX-BTN-5 (2026-08-29):** smoke — Deterioro/Líderes activo `--active-*` sin ámbar; select data-active sin azul.  
**Nota UX-BTN-4 (2026-08-29):** smoke AAPL — Candidata/Vigilar/Descartar tokens; activo `--active-*`; Reabrir disabled ghost.  
**Nota UX-BTN-3 (2026-08-29):** smoke AAPL — reposo soft/`rgba(23,41,31,.85)`; activo dibujo distinto (`--active-*`); icon 32×32.  
**Nota UX-BTN-2 (2026-08-29):** smoke Revisar CTA tiza; pager 32×32.  
**Nota UX-BTN-1 (2026-08-29):** smoke 3M/6M/12M OK.  
**Nota UX-BTN (2026-08-29):** brief → `docs/analisis-ux-btn-acabados-2026-08-29.md`.  
**Nota CLEAN-1 (2026-08-29):** CSS huérfano eliminado.  
**Nota UX-22 (2026-08-29):** smoke 3318 verdad pasan/lista.  
**Nota UX-20 (2026-08-29):** smoke Deterioro — `1045 en lista · 50/página`.  
**Nota UX-19 (2026-08-29):** StorageAlert compacto.  
**Nota UX-18 (2026-08-29):** smoke 390×844.  
**Nota UX-17 (2026-08-29):** smoke clic/Enter/doble clic → Vista rápida; ticker → `/stock/NVCT`.  
**Nota UX-16 (2026-08-29):** smoke H-07 — Líderes intl + US 3318 → banner + CTAs; E2 quita aviso.  
**Nota UX-FILTERS-7 (2026-08-29):** restore cosmética + `resolveStoredFilterConfig`; audit 562/562.  
**Nota UX-13 (2026-08-29):** smoke Líderes E2 chip RS + sort Sin dato al final. Commit `08c10fe`.  
**Nota UX-FILTERS-6 (2026-08-29):** smoke modos hunt + Abrir familia → modal IPO. `28c472a`.  
**Nota UX-FILTERS-5 (2026-08-29):** smoke impacto −N IPO/RS. `0e69c73`.  
**Nota handoff móvil (2026-08-29):** Cloud Agent OK; smoke Browser Use al volver.  
**Nota IPO-1c (2026-08-29):** smoke nav IPO; banda 14d; merge **Vigilada** en Radar IPO (ZZSMOKE + pre-IPO).  
**Nota IPO-NOCT (2026-08-29):** SQL patch US scan → **3289/3320** con `ipoDate`; smoke Radar IPO → **285 pasan**. Script `scripts/patch-scan-ipodate.mjs` + merge puro.  
**Nota UX-FILTERS-4 (2026-08-29):** smoke RS `⚠ 1701/3320` + modal «Cobertura del dato»; Radar IPO `⚠ ipoDate en 0/3320` + empty CTA.  
**Nota INT-3d (2026-08-29):** smoke HK → **122 analizadas** (5 noches; latest sola era 33).  
**Nota producto (2026-08-29):** Supabase migrate aplazado; margen renovación ~2–3 días.  
**Nota INT-3e (2026-08-29):** rebuild HK → withMeta 2675/2760; cron o217 selected 84, passedBase 33.  
**Nota INT-3c (2026-08-28):** cron o133 → passedBase 21 porque 0169–0219 es casi toda &lt;0,50 HKD; umbral OK. Yield = selección más líquida o acumular noches, **no** bajar más el precio.  
**Decisión producto (2026-08-28 · universo intl):** menos curación; official-broad + gates; **mejor yield por lote**, no más símbolos/noche (Pro MICRO + spend-cap 8 GB).  
**Decisión producto (2026-08-28 · filtros):** control primario = **barra continua** (grados), no todo-o-nada; Abrir = profundidad. Spec §3 actualizada (opción B).  
**Prioridad mercados:** US (base) · HK · CA · Europa.  
**Decisión producto (2026-08-27):** versión **privada multi-mercado** para uso propio; lanzamiento público condicionado a viabilidad de licencia de datos. Resoluciones en nube **no relevantes**. Conservar esta línea (git/rama) como base de una eventual versión pública.  
**Decisión producto (2026-08-28):** RS global FX = track **privado** …  
**Decisión producto (2026-08-28 · IPO):** Radar IPO = **todos los mercados**; preset **discovery abierto**; fuente v1 = backfill `ipoDate` multi-mercado + curado `/ipo-radar`; rediseño filtros vía **UX-FILTERS** (raíz, no parche IPO).  
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
| UX-12 | Revisar toolbar → `/review?source=current&symbol=…` | `54399d0` |
| UX-11 | Latencia rail fichas: caché hunt + verdad optimista + deferred rows | `8a16197` |
| UX-14 | CTA stale mercados: misalignment sin depender de scanStale | `f657410` |
| UX-FILTERS | Spec rediseño presentación filtros (tickets 1…7) | `docs/analisis-ux-filters-presentacion-2026-08-28.md` |
| IPO-1a | `ipoDate` desde chart meta v8 + hydrate/patch caché + proyecciones | `eb3053a` |
| IPO-1b | Preset `ipoDiscovery` + empty state CTA `/ipo-radar` | `0dea0bf` |
| UX-FILTERS-1 | Toggle ≠ abrir editor (cierra UX-15) | `b6cfafa` |
| UX-FILTERS-2 | Taxonomía única de familias | `745043a` |
| UX-FILTERS-3 | Intensidad continua 0–100 (IPO + RS) | `417969f` |
| INT-2 | Fusión híbrida US+intl; Global=US+Core; revert en partial-markets | `c11668b` |
| INT-3 | Universo intl amplio HK/CA official-broad + gates | `2e3507d` |
| INT-3b | Caps scan-refresh official-broad (sin techo 25) | `13985cc` |
| INT-3c | Gates HK/CA minPrice moneda local | `24a8e93` |
| INT-3e | Selección HK Main Board/short-sell + metadatos en snapshot | `506bbf6` |
| INT-3d | Acumular noches HK/CA en mesa (N=7) | `7017bf3` |
| UX-FILTERS-4 | Cobertura N/M + aviso dato ausente (IPO + RS) | `48faa89` |
| IPO-NOCT | Parche `ipoDate` en scan US desde perfil (SQL + script) | `d3e932f` |
| IPO-1c | Nav + superficie `/ipo-radar` + merge vigiladas | `165724d` |
| UX-FILTERS-5 | Impacto −N por familia (IPO + RS) | `0e69c73` |
| UX-FILTERS-6 | Ficha hunt declara modo + puertas | `28c472a` |
| UX-13 | RS Líderes E2 opción D (sort + chip) | `08c10fe` |
| UX-FILTERS-7 | Restore intensidad cosmética + compat | `2dacad6` |
| UX-16 | Guardrail Líderes intl datos ≠ mercados | `8b58b48` |
| UX-17 | Enter/doble clic → Vista rápida | `a2e06c2` |
| CHART-NAV-fix | Chevrons/zoom/reset vivos (sync manual/fit) | `0d5298a` |
| CHART-RS | RS overlay sin pane inferior | `0728afe` |
| CHART-NAV | fixLeftEdge false + manual lógico en resize | `cb99525` |
| UX-18 | Móvil ≤480: chrome compacto, 1ª fila legible | `620ae28` |
| UX-19 | StorageAlert compacto + dismiss + liberar | `260bcdc` |
| UX-20 | Truth line «en lista» + hint /página | `a8a540e` |
| UX-21 | Desktop: orden solo cabeceras (sin select) | `e415815` |
| UX-22 | Verdad pasan/lista alineada (deferred hunt) | `332d2e4` |
| CLEAN-1 | Purga CSS `.resultSortSelect` | `fb9188a` |
| UX-BTN-1 | Segmented / keycaps unificados | `59bbc52` |
| UX-BTN-2 | Primary / Ghost / Pager | `74d7085` |
| UX-BTN-3 | Chart floating nav | `ae37bfa` |
| UX-BTN-4 | Stock decision rail | `27c63fb` |
| UX-BTN-5 | Hunt rail + «+ Filtro» | `035c22b` |
| UX-BTN-6 | Market / country chips | `969b97e` |
| UX-23 | InfoHints cabecera tabla | `9244496` |
| CLEAN-2 | Dual DOM móvil/desktop | `e69c3af` |
| CLEAN-3 | MarketMiniTape breakpoint 900→760 | `03eb7fa` |
| CHART-UI-1 | ChartPreferences compact · 2 clusters TF/rango | `cd8e8d3` |
| MET-1c | Cron GHA RS global privado (dom 06:00 UTC) | `368670f` |
| MET-2 | Spec RS país (columna 2ª · US motor congelado · intl local sin FX) | (docs) |
| MET-2b | Impl RS país (lector + motor + columna; fix client crypto) | `9c147c6` |
| MET-2c | Cron GHA RS país privado (dom 07:00 UTC) | |

## Siguiente — datos IPO + filtros

| ID | Qué | Estado |
|---|---|---|
| IPO-1a write | `scripts/backfill-ipo-date.mjs --write` en Supabase | **Hecho** US 5893 + intl ~586 |
| Nocturno / IPO-NOCT | Parche `ipoDate` en scan US desde perfil | **Hecho** · `d3e932f` · 3289/3320 · smoke Radar **285** |
| IPO-1c | Nav + merge vigiladas `/ipo-radar` | **Hecho** · `165724d` · smoke Browser Use |
| INT-2 | Mesa US+EU+HK: fusión híbrida nocturno+materializado; selección honestamente cargable | **Hecho** · smoke US+HK 3343, US+Core 3538 |
| INT-3 | Universo intl amplio: oficial HK+CA, gates calidad, menos curated-core techo | **Hecho** · `2e3507d` · corrida HK universeTotal 2760 pero selected 25 por cap ruta |
| INT-3b | Quitar cap `perMarket≤25` / `limit≤80` en scan-refresh para official-broad | **Hecho** · `13985cc` · cron selected 84 → passedBase 21 (minPrice USD) |
| INT-3c | Gates baseReject HK/CA en moneda local (sin subir lote) | **Hecho** · `24a8e93` · smoke o133→21 |
| INT-3e | Selección HK: Main Board/short-sell + preservar metadatos en snapshot | **Hecho** · smoke o217→passedBase 33; withMeta 2675 |
| INT-3d | Acumular lotes HK/CA (unión N noches) en una mesa | **Hecho** · smoke HK 122 analizadas (5 noches) |
| UX-FILTERS-1 | Toggle ≠ abrir editor (cierra UX-15) | **Hecho** · `b6cfafa` |
| UX-FILTERS-2 | Taxonomía única de familias | **Hecho** · `745043a` |
| UX-FILTERS-3 | Intensidad continua 0–100 + Abrir (IPO + RS) | **Hecho** |
| UX-FILTERS-4 | Cobertura N/M + aviso dato ausente | **Hecho** · `48faa89` · smoke Browser Use |
| UX-FILTERS-5 | Impacto −N por familia (tarjeta + pie editor) | **Hecho** · `0e69c73` · smoke Browser Use |
| UX-FILTERS-6 | Ficha hunt declara modo + puertas | **Hecho** · `28c472a` · smoke Browser Use |
| UX-13 | Cobertura RS ~47 % Sin dato en Líderes E2 | **Hecho** · `08c10fe` · opción D · smoke Browser Use |
| UX-FILTERS-7 | Migración / restore compat | **Hecho** · `2dacad6` · audit 562 · smoke restore |
| UX-16 | Líderes intl guardrail datos ≠ mercados | **Hecho** · `8b58b48` · smoke H-07 Browser Use |
| UX-17 | Vista rápida: Enter / doble clic → modal | **Hecho** · `a2e06c2` · smoke Browser Use |

~~UX-15~~ subsumido en UX-FILTERS-1.

## P2 (post-review)

| ID | Qué | Estado |
|---|---|---|
| UX-18 | Móvil 390: resultados accesibles | **Hecho** · `620ae28` · smoke 390×844 |
| UX-19 | Banner localStorage lleno | **Hecho** · `260bcdc` |
| UX-20 | Copy «visibles» vs página | **Hecho** · `a8a540e` · smoke Deterioro |
| UX-21 | Botones Ordenar vs cabeceras | **Hecho** · `e415815` · smoke RS header |
| UX-22 | Verdad pasan vs en lista (deferred hunt) | **Hecho** · `332d2e4` · smoke 3318 |
| CLEAN-1 | Purga CSS `.resultSortSelect` | **Hecho** · `fb9188a` |
| UX-BTN | Brief acabados botones/teclas | **Hecho** · `docs/analisis-ux-btn-acabados-2026-08-29.md` |
| UX-BTN-1 | Segmented / keycaps unificados | **Hecho** · `59bbc52` · smoke 3M/6M/12M |
| UX-BTN-2 | Primary / Ghost / Pager | **Hecho** · `74d7085` · smoke Revisar + pager |
| UX-BTN-3 | Chart floating nav | **Hecho** · `ae37bfa` · smoke AAPL |
| UX-BTN-4 | Stock decision rail | **Hecho** · `27c63fb` · smoke AAPL |
| UX-BTN-5 | Hunt rail + «+ Filtro» | **Hecho** · `035c22b` · smoke `/` |
| UX-BTN-6 | Market / country chips | **Hecho** · `969b97e` · smoke `/` |
| UX-23 | InfoHints cabecera tabla | **Hecho** · `9244496` · smoke `/` |
| CLEAN-2 | Dual DOM móvil/desktop | **Hecho** · `e69c3af` · smoke desktop+390 |
| CLEAN-3 | MarketMiniTape media query canónica 760 | **Hecho** · `03eb7fa` · smoke 390 tape DOM + ≥760 sin mobileHome |

Ver informe · `docs/analisis-ux-btn-acabados-2026-08-29.md`.

## Track IPO / salidas a bolsa (dueño 2026-08-28)

| ID | Qué | Estado |
|---|---|---|
| IPO-1 | Radar IPO multi-mercado + datos + ficha discovery | **Aceptado** · `docs/tickets/IPO-1-radar-producto.md` |
| UX-FILTERS | Spec presentación filtros (IPO piloto) | **Aceptado** · `docs/analisis-ux-filters-presentacion-2026-08-28.md` |
| IPO-1a | Backfill `ipoDate` (código + write US/intl) | `eb3053a` + write 2026-08-28 |

Orden: IPO-1a → IPO-1b–c (+ 1d = UX-FILTERS-3+4 sobre IPO).

## Chart (pendiente · oleada post-screener P2)

Decisión dueño **2026-08-29:** revisar gráfico; **RS dentro del lienzo** (no panel abajo); **navegación libre** tipo TradingView (pan/zoom), sin quedar encasillado en la zona de referencia.

| ID | Qué | Estado |
|---|---|---|
| CHART-RS | RS solo overlay en gráfico (sin panel duplicado) | **Hecho** · `0728afe` · smoke OKTA |
| CHART-NAV | Pan/zoom libre; zona de interés marcada, no secuestrada | **Hecho** · smoke AAPL · `fixLeftEdge:false` + manual lógico |
| CHART-UI-1 | Densidad toolbar ChartPreferences compact (agrupar TF/rango) | **Hecho** · `cd8e8d3` · smoke AAPL · 2 clusters |

**Orden sugerido:** CHART-RS (cambio de representación) → CHART-NAV (gesto timeScale); o paralelo en ramas si no tocan el mismo helper de rango.  
**No** mezclar con UX-18…21 (P2 mesa) en el mismo ticket.

## Track métricas (pendiente)

| ID | Qué | Estado |
|---|---|---|
| MET-1c | Cron semanal motor global privado | **Hecho** · `368670f` · `rs-global-private.yml` · smoke lectura OK |
| MET-2 | Spec RS país (calidad intra-país) | **Aceptado dueño 2026-08-30** · `docs/spec-rs-pais.md` · `4f82d6d` |
| MET-2b | Impl lector + motor intl + columna/filtro | **Hecho** · `9c147c6` · write HK OK |
| MET-2c | Cron GHA RS país (dom 07:00 UTC) | **Hecho** · `rs-country-private.yml` |
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
- **Salida Supabase Pro → Mac Mini M4** — plan `docs/plan-migrate-postgres-mac-mini-2026-08-30.md` · tickets MIGRATE-1…3 · **activar con OK dueño + fecha billing**.
- **VCP / contracciones en producto** — investigación activa en `research/contracciones/` + docs (`diseno-contracciones*.md`, citas Minervini/O'Neil/Weinstein); detector producto sigue en `lib/setupPatterns.js`.
- Traducir inglés estructural restante.
- Dos colas modal vs `/review` (estructural; baja prioridad si el modal basta).
- ~~Resoluciones en nube~~ — **descartado** (dueño: no relevante).
- Badge «RS global» en chart — subsumed by B2-chart smoke.

## Convención

- Programación en chat aparte; prompt en el orquestador.
- Orquestador: verify + **smoke en página con Browser Use** (no pedir checklist mecánico al dueño) + commit.
