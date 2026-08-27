# UX-1 — Retorno: rediseño filtros / IA del screener (2026-08-27)

Fuente: encargo `docs/tickets/UX-1-filter-ia-redesign.md`.  
Modelo: análisis (Fable/Opus). Smoke Browser Use solo lectura sobre `localhost:3000` del dueño.  
Sin código. Orquestador verificó citas clave contra HEAD (ghost filters en `screenerResultView.js`, `th` sin sort, `sectorStrength` sin columna Grp, contrato `defaultSortForSettings` / principio 7.5).

---

## Veredicto (10–15 líneas)

La maquinaria de filtrado es más honesta que hace dos semanas (capas v2, aviso de degradación, cajón «Más filtros» arreglado, columna Deterioro condicional), pero la **cáscara sigue hablando el idioma del sistema, no el del trader**. En la sesión real de hoy [REPRODUCIDO]: título «Balanceado», subtítulo «1 mercados · 47 resultados visibles», un KPI de tres celdas con la tercera vacía («3321 | 47 | –»), **dos banners naranjas simultáneos** diciendo lo mismo sobre la selección de mercados sin ofrecer un clic de resolución, un disclosure con jerga interna («MUESTRA PARCIAL · PERCENTIL POR LOTE»), y —lo más grave— la tabla **ordenada por Rendimiento 3M mientras la columna visible es Rend. 6M**, exactamente la violación del principio 7.5 que `defaultSortForSettings` dice prevenir [CÓDIGO `lib/screenerPipeline.js:91-96`]. Ninguna de esas superficies responde a la pregunta matinal del dueño: *¿qué estoy cazando y qué me está quitando el sistema?* El preset es un nombre opaco («Balanceado») sobre ~68 umbrales [DOC auditoría 08-13], las capas son un tercer eje que nadie pidió, y los filtros de vista incluyen 10 criterios de juicio que **se siguen calculando y aplicando sin control visible** tras retirarlos de la UI [CÓDIGO `lib/screenerResultView.js`, `useResultViewModel.js`; memoria 2026-08-12]. El diagnóstico no es «demasiados filtros»: es que **hay tres sistemas (ejecución, capas, vista) presentados como si fueran uno**, y ningún lugar único que diga la verdad. La dirección correcta es la propuesta A («mesa de vistas»): fichas de caza nombradas en lenguaje de etapa, una línea de verdad, y todo lo demás plegado a un editor experto honesto.

## Mapa mental del usuario vs mapa real del sistema

**Mapa mental del trader (Weinstein/Minervini):** «Elijo qué cazo hoy (líderes E2, cerca de pivot, deterioro, intl) → veo la lista ordenada por lo que me importa → recorto por país/sector si quiero → abro fichas». Un eje, una lista, un orden.

**Mapa real del sistema:** tres poblaciones (`analyzedRows` → filtro de ejecución → `rows` → filtro de vista → `filtered`) [DOC análisis 08-15], gobernadas por **cuatro** superficies distintas: (1) preset + bases opcionales + plantillas en el sidebar, (2) capas con contrato v2 que pueden degradar `setupMode` [CÓDIGO `lib/screenerFilterLayers.js`, `layerToggleImpact`], (3) ~68 umbrales del editor avanzado [DOC auditoría 08-13], (4) filtros de vista en «Más filtros» + Resolución + Ordenar [CÓDIGO `ResultFilterBar.jsx`]. Encima, la selección de **mercados** es un quinto eje que no filtra sino que decide *qué datos se cargan*, y cuando se desalinea del scan produce los dos banners naranjas de hoy [REPRODUCIDO]. El usuario ve una pantalla; el sistema tiene cinco máquinas.

## Problemas (gravedad + evidencia)

**P0 — bugs/contradicciones:**

1. **Orden invisible reproducido en vivo**: sort=`perf3m` con periodo activo 6M y columna «Rend. 6M» [REPRODUCIDO]. `setPerfPeriod` sincroniza sort→periodo [CÓDIGO `useResultViewModel.js`] pero el camino inverso (elegir orden en el select, o restaurar sesión) desincroniza. Contradice el comentario-contrato de `lib/screenerPipeline.js:91-96`.
2. **Filtros fantasma**: 10 filtros de juicio retirados de la UI pero aún evaluados en `applyResultViewFilters` [CÓDIGO `lib/screenerResultView.js`]. Si un estado persistido trae un valor no-«all», oculta filas sin control visible.
3. **Reglas muertas / off-by-design** listadas como criterio (`minRsRating`, IPO, `minWeaknessScore` en presets no-weakness) [DOC auditoría 08-13].

**P1 — deuda de IA:** doble banner sin CTA; preset caja negra; capas en flujo diario; «Fuerza grupo» sin columna; sin sort por cabecera.

**P2 — pulido:** «1 mercados», jerga PERCENTIL POR LOTE, KPI «–», duplicado «Débiles».

## Propuesta de IA (resumen)

Propuesta **A (mesa de vistas)**: rail de 5 fichas de caza (*Líderes Etapa 2*, *Cerca de pivot*, *Deterioro*, *Líderes intl*, *Radar IPO*) + chips de vista + editor experto colapsado + **una línea de verdad**. Intl = cambio de ficha (auto-switch existente), no un preset que el usuario deba aprender.

## Backlog propuesto (aceptado a backlog activo)

| Id | Título | Prio |
|---|---|---|
| UX-2 | Línea de verdad única + banner de mercados accionable | P0 |
| UX-3 | Invariante orden-visible + sort por cabecera | P0 |
| UX-4 | Purga de filtros fantasma de la vista | P0 |
| UX-5 | Rail de fichas de caza (propuesta A) | P1 |
| UX-6 | Editor experto honesto | P1 |
| UX-7 | Chips de vista con impacto + «+ Filtro» | P1 |
| UX-8 | Desglose «qué está filtrando ahora» | P2 |
| UX-9 | Copy y limpieza menor | P2 |

## LO QUE NO VERIFIQUÉ (del análisis)

Gestos mutadores en la sesión del dueño; móvil; coste real de `useMemo` fantasma; CTA de banners (no existían).
