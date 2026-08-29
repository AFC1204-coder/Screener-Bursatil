# UX-BTN — Brief acabados de botones / teclas / controles

**Estado:** Activo · análisis en Agent chat aparte (**sin código**)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** **Gemini 3.7 Flash** (como UX-P). Fallback: Composer solo si Gemini no disponible.  
**Origen:** dueño 2026-08-29 post CLEAN-1 — optimizar acabados; no mezclar con purga CSS.  
**Contexto:** `docs/analisis-ux-pagina-2026-08-29.md` · tokens en `styles/tokens-v2.css` / `styles/components.css` (`.btn*`, `.compactSeg`, `.marketChip`, `.universalChartNavButton`, hunt rail).

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/UX-BTN-acabados-brief.md
@docs/tickets/activo.md
@docs/analisis-ux-pagina-2026-08-29.md

Rama: codex/statsedge-ui-polish
Modelo: Gemini 3.7 Flash

Ticket UX-BTN — SOLO brief / plan. Sin editar CSS ni JSX. Sin commit ni push.

Objetivo: diagnosticar acabados de botones, teclas (segmented controls) y controles
clicables del screener + ficha chart, y proponer 4–8 tickets ejecutables (Composer)
de alto impacto / bajo riesgo. No rediseñar el producto ni la metodología.

Entradas:
1. Hard-reload http://localhost:3000 — esperar datos US (~3300 analizadas).
2. Capturas o descripción fiel de: chrome superior + acciones; rail fichas hunt;
   filter bar (Resolución, + Filtro); segmented 3M/6M/12M; cabeceras columna;
   pager; sidebar mercados/chips; /stock/AAPL toolbar (rangos, TF, Precio/Log/%/RS,
   nav chevrons/zoom).
3. Leer tokens y familias de botón en styles/components.css + styles/screener.css
   (no reescribir el design system desde cero).

Responde:
1. Qué controles se sienten “WIP / baratos / inconsistentes” (radio, borde, hover,
   active, disabled, altura, peso tipográfico) — con evidencia.
2. Familias a unificar (máx 4–5): p.ej. primary CTA, ghost/toolbar, segmented,
   chip/market, icon-nav chart.
3. 5–8 reglas de acabado (sí/no) alineadas al look stage-analysis oscuro actual
   (sin púrpura, cream+serif, glow, pills everywhere).
4. Tickets UX-BTN-1… con alcance CSS/tokens acotado; modelo impl. = Composer.
5. Qué NO tocar (tabla densidades, scoring, copy de verdad, CLEAN-2 dual DOM,
   infoHints salvo si es el “i” como control).

Formato de retorno del ticket. Sin commit ni push.
```

## Objetivo

De “controles a medio acabar / familias mezcladas” a **acabado coherente de producto** en botones y teclas, sin rediseño de marca ni de mesa de vistas.

## Modelo

| Rol | Modelo |
|---|---|
| Brief visual + reglas + backlog | **Gemini 3.7 Flash** |
| Implementar tickets del brief | Composer 2.5 |
| Desempate de gusto | Opus/Fable solo si hace falta |

## Preguntas

1. ¿Qué grita WIP en botones/teclas (chrome, rail, filter, segmented, chart nav)?  
2. ¿Cuántas familias visuales hay hoy vs las que deberían existir?  
3. Top cambios alto impacto / bajo riesgo (tokens + CSS, sin JSX salvo className).  
4. Orden de tickets UX-BTN-1…  
5. Qué queda fuera (infoHints como ruido de tabla → UX-23 aparte).

## Fuera de alcance

- Implementar CSS en este ticket.  
- Rediseño landing / tipografía display nueva.  
- Auth, scoring, RS, nocturno.  
- Commit / push.

## Formato de retorno

```
## Resumen
(veredicto 8–12 líneas)

## Familias de control
(hoy vs propuesto)

## Reglas de acabado (5–8)
(…)

## Tickets propuestos
| ID | Título | Prio | Notas | Modelo impl. |
|---|---|---|---|---|

## Orden
(…)

## LO QUE NO VERIFIQUÉ
(…)

Sin commit ni push.
```

## Criterio de aceptación (orquestador)

- Tickets accionables (no “hacerlo más bonito”).  
- Respeta mesa de vistas y tokens existentes.  
- Orquestador escribe UX-BTN-1… y activa el primero tras revisar el brief.
