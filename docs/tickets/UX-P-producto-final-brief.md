# UX-P — Brief “producto final” (aspecto + superficie)

**Rama:** `codex/statsedge-ui-polish`  
**Tipo:** solo análisis / plan de tickets — **sin código**  
**Modelo sugerido:** **Gemini 3.7 Flash** (barato, bueno con capturas). Fallback: Composer. Opus/Fable solo si el retorno es flojo o hay disputa de gusto.  
**Origen:** decisión dueño 2026-08-27 — inmediato = aspecto de producto final; métricas RS aparcadas.  
**Contexto ya cerrado:** UX-2…UX-5 (verdad, sort, fantasma, rail de fichas). Análisis previo: `docs/analisis-ux-filtros-ia-2026-08-27.md`.

## Objetivo

Pasar de “herramienta a medio hacer” a **aspecto de producto serio** (uso diario privado), sin rediseñar la metodología ni tocar scoring/RS/VCP.

Entregar: diagnóstico visual + UX de superficie, lista priorizada de tickets ejecutables (Composer), y qué **no** tocar.

## Modelo — por qué no Opus por defecto

| Modelo | Rol | Nota |
|---|---|---|
| **Gemini 3.7 Flash** | Brief visual + backlog de pulido | Mejor relación calidad/precio con screenshots |
| Composer | Implementar tickets del brief | Conoce el CSS/JSX del screener |
| Opus / Fable | Solo desempate de gusto | Ya pagamos juicio en UX-1 (mesa de vistas) |

No inventar un look genérico (púrpura, cream+serif, glow). Respetar `styles/screener.css` y lenguaje stage analysis.

## Entradas obligatorias

1. Hard-reload `http://localhost:3000` (sesión dueño / Browser Use). Esperar datos (US ~3321 o Core intl si aplica).
2. Capturas o descripción fiel de: hero + rail fichas + línea de verdad + tabla; sidebar; «Más filtros» / editor; vista rápida (modal); viewport ~390px.
3. Leer (no reescribir): UX-1 análisis, `docs/backlog-activo.md` (prioridad producto final), componentes `ScreenerShell`, `HuntCardRail`, truth line.

## Preguntas a responder

1. ¿Qué sigue gritando “WIP / interno” (copy, densidad, estados vacíos, chrome duplicado, tipografía, alineación)?
2. ¿La mesa de vistas (fichas + verdad) se lee como el eje principal o aún compite con sidebar/preset/capas?
3. Top 8 cambios de **alto impacto / bajo riesgo** hacia “producto final”.
4. Qué va a **UX-6** (editor honesto), **UX-7** (chips), **UX-8/9**, y qué es un ticket nuevo **UX-P1…** (solo visual/copy/layout).
5. Orden de ejecución recomendado para 2–4 días (mezcla OK con MET/VCP en paralelo *fuera* de este brief).

## Fuera de alcance

- RS global/país/tema, índice etapa 0–100, VCP, scoring nuevo.  
- Redesign total de marca / landing.  
- Auth, nocturno, licencia de datos.  
- Commit/push.

## Formato de retorno (pegar al orquestador)

```
## Resumen
(veredicto 8–12 líneas)

## WIP vs producto
(bullet con evidencia: UI / copy / layout)

## Tickets propuestos
| ID | Título | Prio | Notas | Modelo impl. |
|---|---|---|---|---|

## Orden 2–4 días
(…)

## LO QUE NO VERIFIQUÉ
(…)

Sin commit ni push.
```

## Criterio de aceptación (orquestador)

- Retorno con tickets accionables (no “hacerlo más bonito”).  
- No contradice mesa de vistas ni reabre P0 cerrados sin evidencia nueva.  
- Orquestador escribe tickets UX-6 / UX-P1… y activa el primero.
