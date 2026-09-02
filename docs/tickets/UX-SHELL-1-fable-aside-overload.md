# UX-SHELL-1 — Brief Fable: sobregarga del aside / filtros (sin código)

**Estado:** Brief cerrado 2026-09-03 · **aceptado** · impl **post-MIGRATE**  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Fable 5  
**Retorno archivado:** `docs/analisis-ux-shell-aside-2026-09-03.md`  
**Tipo:** brief + kill list + oleadas. **Sin código en esta fase.**

## Por qué ahora (y qué no es)

Desde UX-1 aceptamos **mesa de vistas** (5 fichas + verdad + editor experto). Luego UX-P / FILTER-SHELL / MOBILE-FIRE **podaron chrome**, pero el **aside de filtros sigue siendo un inventario del sistema** (~67 umbrales, muchas familias siempre visibles). La sensación del dueño: *arrastre de código antiguo; no evoluciona*.

Este encargo **no** reabre la dirección de producto. Pide: **cómo desmontar la sobrecarga** alrededor de la mesa de vistas ya aceptada.

## Evidencia HEAD (orquestador 2026-09-02 · `:3310` logueado)

**Rail de caza (eje OK):** Líderes Etapa 2 · Cerca de pivot · Deterioro · Líderes intl · Radar IPO.

**Summaries del `<aside class="sidebar">` (orden real):**

1. Mis plantillas  
2. Personalizar mercados (28/28) · personalizado  
3. Configuración avanzada  
4. Más bases de filtro  
5. Vista de resultados  
6. **Ajustes finos (39/67)** → familias abiertas en el árbol: Liquidez, Tendencia, Momentum, Fuerza relativa, Cercanía, Volatilidad, Scores, Cobertura, Estructura, **VCP**, Volumen objetivo, Rentabilidad/riesgo, Short interest, IPO  
7. Diagnóstico → Auditoría de filtros · Cobertura internacional  

`ScreenerShell.jsx` ~1000 LOC · `styles/screener.css` ~10k LOC. Cada ticket de fuego añade CSS; casi no retira superficies.

## Lecturas obligatorias (no reinventar)

| Fuente | Uso |
|---|---|
| `docs/analisis-ux-filtros-ia-2026-08-27.md` | UX-1: mesa de vistas ya decidida |
| `docs/analisis-ux-producto-final-2026-08-27.md` | UX-P: cockpit → podar chrome |
| `docs/analisis-ux-filters-presentacion-2026-08-28.md` | Taxonomía familias / intensidad |
| `docs/tickets/FILTER-SHELL-1-poda-laboratorio.md` | Diagnóstico agrupado — insuficiente |
| `docs/tickets/FILTER-SHELL-2-toolbar-secundaria.md` | Toolbar ⋯ |
| `docs/backlog-activo.md` | Estado; MIGRATE mañana |

## Misión

1. Diagnosticar **por qué el aside sigue gritando laboratorio** pese a mesa de vistas + podas.  
2. Proponer **IA objetivo** del panel de filtros (qué es diario / semanal / nunca en superficie).  
3. **Kill list** explícita: superficies a retirar, fusionar o enterrar (no solo «meter en details»).  
4. **4 oleadas** implementables post-MIGRATE (P0→P2), cada una acotada a archivos/zonas, sin reescritura suicida de `ScreenerShell` en un solo ticket.  
5. Decir qué **no** tocar (scoring, hunt semantics, VCP motor, datos, auth).

## Fuera de alcance

- Código JSX/CSS/tests.  
- MIGRATE / Postgres / Mini.  
- Rediseño de `/stock`, chart, VCP producto, scoring.  
- Look genérico SaaS (púrpura, cream+serif, glow). Respetar tokens stage analysis existentes.  
- Sustituir el rail de 5 fichas por otro paradigma.

## Formato de retorno (pegar al orquestador)

```
## Resumen
(8–12 líneas: veredicto + dirección)

## Por qué sigue sobrecargado
(bullets con evidencia UI / estructura, no vibes)

## IA objetivo (diario / raro / enterrado)
(tabla o lista corta)

## Kill list
| Superficie actual | Acción (retirar / fusionar / enterrar / mantener) | Motivo |

## Oleadas post-MIGRATE
| ID | Título | Prio | Zona (aside/toolbar/…) | Riesgo | Criterio aceptación |

## Qué no tocar
(…)

## LO QUE NO VERIFIQUÉ
(…)
```
