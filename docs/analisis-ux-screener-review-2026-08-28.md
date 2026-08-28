# Análisis UX — Screener (pasada extensa)

**Fecha:** 2026-08-28  
**Rama:** `codex/statsedge-ui-polish`  
**URL:** `http://localhost:3000` (hard-reload Cmd+Shift+R al inicio y tras cambios de ficha)  
**Método:** Browser Use (CDP Chrome local), sin code review de diff  
**Contexto:** post-MET-1b (RS global privado curado en columna)

---

## Veredicto

El screener es **usable y coherente en el flujo principal US** tras MET-1b: la columna RS muestra el tooltip correcto («RS global · USD · universo privado curado»), los valores numéricos coinciden entre tabla, cola de review y ficha (`HNGE=96`, `DK=97`), y el badge «Ranking provisional» aparece sin reaparecer el copy viejo «Muestra parcial · percentil por lote». La línea de verdad, la auditoría `N/M pasan` y el desglose «¿Qué recorta?» (expandido) son honestos y alineados.

**Fricciones relevantes (P1):** (1) copy desactualizado en tooltip/modal de la familia RS («universo, benchmark, país y grupo») frente a columna RS global; (2) latencia percibida al cambiar ficha rail **688–3517 ms** (objetivo ticket: <200 ms); (3) botón **Revisar** en screener no navega a `/review` (sí funciona URL directa y ticker→ficha); (4) **~47 %** de filas en Líderes Etapa 2 con «– Sin dato» pese a ser US — tooltip explica («no entra en el universo del ranking») pero sorprende en una ficha de líderes; (5) banner mercados stale con CTA inconsistente según viewport/estado.

**No probado en esta sesión:** RS numérico en fila `.HK`/`.TO`/`.L` tras cargar datos intl (CTA de carga no disparada de forma fiable). Móvil 390px: drawer filtros OK; tabla no visible en viewport principal.

**Veredicto global:** **Apto con deuda P1** — sin P0 de datos mentirosos detectados; priorizar copy RS familia, gesto Revisar y latencia rail.

---

## Hallazgos

| ID | P | Área | Evidencia | Propuesta ticket |
|---|---|---|---|---|
| H-01 | P1 | RS · copy familia | Tooltip icono `i` familia RS sidebar: «universo, benchmark, país y grupo». Columna RS header: «RS global · USD · universo privado curado». | **UX-10** — Actualizar copy familia RS alineado con MET-1b |
| H-02 | P1 | Rail · latencia | Tiempos al cambiar ficha (post-reset): Líderes Etapa 2 ~1037 ms, Cerca pivot ~1157 ms, Deterioro ~917 ms, Líderes intl ~2366 ms, Radar IPO ~3517 ms. | **UX-11** — Perf perceived: cambio ficha rail <200 ms o feedback inmediato |
| H-03 | P1 | Navegación · Revisar | Clic en fila DK (RS=97) + botón «Revisar» → permanece en `/` (2012 ms). `/review?source=current&symbol=DK` sí muestra cola con DK=97. | **UX-12** — Revisar desde screener debe abrir review con cola actual |
| H-04 | P1 | RS · cobertura US | Líderes Etapa 2, 47 filas: **25 RS numérico, 22 «Sin dato»** (~47 %). Tooltip Sin dato: «Sin RS semanal: este símbolo no entra en el universo del ranking.» | **UX-13** — Auditar universo ranking vs expectativa trader en ficha líderes |
| H-05 | P1 | Mercados · stale CTA | Con HK seleccionado: «Datos cargados: US (3321). La selección actual (HK) no coincide.» — en algunos estados no aparece «Cargar datos de la selección»; solo «Traer datos frescos». | **UX-14** — CTA stale mercados siempre visible y copy diferenciado |
| H-06 | P1 | Filtros · RS familia | Clic en «Ajustar» RS puede desactivar familia entera (✓→X «Quitado») en lugar de solo expandir reglas. | **UX-15** — Separar toggle familia de expandir reglas |
| H-07 | P1 | Rail · Líderes intl | Con solo US cargado (3321) y ficha Líderes intl: **2902 pasan**, mayoría tickers 🇺🇸. Mercados sidebar 10/29 o 28/29 según sesión. Confuso si usuario espera solo intl. | **UX-16** — Líderes intl: aviso o restricción cuando datos ≠ mercados seleccionados |
| H-08 | P2 | Navegación · quick view | Enter y doble-clic en fila no abren vista rápida; ticker-link navega directo a `/stock/[symbol]`. | **UX-17** — Restaurar o documentar gesto vista rápida |
| H-09 | P2 | Móvil 390px | Viewport 390: sidebar oculto, botón «Filtros» abre drawer 390px con familias RS OK; `tableVisible: false` en viewport principal. | **UX-18** — Móvil: tabla resultados accesible sin fricción |
| H-10 | P2 | Arranque | Banner «El snapshot no se ha podido guardar… espacio lleno» (localStorage). No bloquea uso. | **UX-19** — Mensaje localStorage menos intrusivo o limpieza guiada |
| H-11 | P2 | Rail · paginación | Deterioro: 1047 pasan, 50 visibles. Líderes intl: 2902 pasan, 50 visibles. Verdad dice «N visibles» = total, no página. | **UX-20** — Clarificar «visibles» vs «en esta página» si hay paginación |
| H-12 | P2 | Sort · botones | Botones «Ordenar: RS» en barra no cambian sort; cabecera columna RS sí (`orden: RS ↓`, filas 97,97,96…). | **UX-21** — Unificar o eliminar botones Ordenar redundantes |

### Evidencia detallada por matriz

#### A. Arranque y verdad
- Hard-reload → **3321 analizadas** (US), coherente.
- Línea de verdad: `3321 analizadas · 47 pasan «Líderes Etapa 2» · 47 visibles · orden: Rendimiento 3M ↓ · corte 27 ago, 16:07`
- Badge **RANKING PROVISIONAL** presente.
- Copy «Muestra parcial · percentil por lote»: **no aparece** ✓

#### B. Fichas rail (post «Resetear criterios»)

| Ficha | Pasan | Visibles | Filas DOM | Sort default | ms percibido |
|---|---|---|---|---|---|
| Líderes Etapa 2 | 47 | 47 | 47 | Rend. 3M ↓ | ~1037 |
| Cerca de pivot | 2 | 2 | 2 | Dist. máx 52s ↓ | ~1157 |
| Deterioro | 1047 | 1047 | 50 | Deterioro ↓ | ~917 |
| Líderes intl | 2902 | 2902 | 50 | Rend. 3M ↓ | ~2366 |
| Radar IPO | 0 | 0 | 1 (empty state) | Rend. 3M ↓ | ~3517 |

- Conteo ficha ↔ verdad ↔ auditoría: **alineados** (± paginación 50 filas).
- «¿Qué recorta?» expandido: `Ficha «Líderes Etapa 2» deja 47 de 3321` + `Principal corte: Tendencia (−1846)` + enlace «Ver auditoría».

#### C. Filtros
- **RS columna** tooltip: «RS global · USD · universo privado curado. Fuerza relativa semanal…»
- **RS familia** tooltip: «universo, benchmark, país y grupo» ← desalineado (H-01).
- RS min stepper (+): 47 → **22 pasan** al subir umbral (filtra).
- Sort RS cabecera: `DK=97, AYA=97, HNGE=96…`; **persiste tras reload** (`orden: RS ↓`) ✓ UX-3.
- Sort Capitaliz.: `CRWD` primero, RS=89 en fila top.

#### D. Mercados
- Solo US: RS numérico en **25/47** (~53 %), no mayoría absoluta.
- HK seleccionado: banner stale, **no se cargaron datos HK** en sesión → sin fila `.HK` con RS numérico verificado.
- Banner ejemplo: `Datos cargados: US (3321). La selección actual (CA, CH, DE, ES, FR, GB, HK, IT, NL, SE) no coincide.`

#### E. Navegación
- Ticker `HNGE` → `/stock/HNGE`: FR **96** (tabla tenía 96) ✓
- Review `/review?source=current&symbol=DK`: sidebar cola muestra **DK=97**, HNGE=96, RHI=− ✓
- Volver desde ficha → `/review?source=current&symbol=HNGE` (no screener directo); Screener nav → preserva ficha Líderes Etapa 2 + sort.
- Móvil 390px: rail scroll `overflow-x: auto`; drawer Filtros usable.

#### F. Regresiones conocidas

| Regresión | Estado | Notas |
|---|---|---|
| `rsGlobalPct` de lote mostrado como RS | **OK** | No aparece en UI |
| HK sin RS mudo sin motivo | **OK*** | Sin dato tiene tooltip motivo; *HK no cargado |
| Copy «Muestra parcial · percentil por lote» | **OK** | No reapareció |
| Ranking provisional (UX-9) | **OK** | Badge visible con percentil batch |

---

## Tickets propuestos

| Ticket | Prioridad | Resumen |
|---|---|---|
| **UX-10** | P1 | Copy familia RS: sustituir «universo, benchmark, país y grupo» por texto alineado RS global privado curado |
| **UX-11** | P1 | Reducir latencia cambio ficha rail o skeleton/optimistic UI (<200 ms perceived) |
| **UX-12** | P1 | Botón Revisar en screener → navegar a `/review` con cola del preset actual |
| **UX-13** | P1 | Revisar cobertura RS en ficha Líderes Etapa 2 (~47 % Sin dato US) |
| **UX-14** | P1 | CTA mercados stale consistente: «Cargar datos de la selección» siempre visible |
| **UX-15** | P1 | Desacoplar toggle OFF familia RS del botón Ajustar/expandir |
| **UX-16** | P1 | Líderes intl: guardrail cuando datos cargados ≠ mercados intl seleccionados |
| **UX-17** | P2 | Vista rápida: Enter/dbl-clic o documentar flujo ticker→ficha |
| **UX-18** | P2 | Móvil 390px: resultados visibles sin depender solo del drawer |
| **UX-19** | P2 | Banner localStorage lleno menos intrusivo |
| **UX-20** | P2 | Copy «N visibles» vs paginación 50 filas |
| **UX-21** | P2 | Botones «Ordenar: X» vs cabeceras de columna |

---

## LO QUE NO PROBÉ

- RS numérico en fila **`.HK` / `.TO` / `.L`** tras cargar datos intl (CTA «Cargar datos de la selección» no ejecutada de forma fiable en todos los estados; timeout 20 s no aplicado con éxito).
- Persistencia de chips vista (+ Filtro) tras reload (regresión UX-4) — chips de vista no localizados como botones en DOM durante sesión.
- Cada familia de filtro (Liquidez, Tendencia, Momentum, Cercanía, Volatilidad) — solo RS en profundidad; resto: tooltips breves capturados.
- Flujo completo «Traer datos frescos» / resolución stale post-CTA.
- RS Bench / País / Grupo / Quality como filtros activos vs columna RS global (familia RS expandida pero reglas no toggled individualmente salvo RS min).
- Auth, scoring, cron MET-1c, VCP (fuera de alcance ticket).
- Segunda pasada visual en `:3300` aislado (solo `:3000` dev del dueño).
- Tablet breakpoints intermedios (solo 390px y desktop ~1470px).
