# UX-LOOK-1 — Brief Fable: rediseño visual general (piel, no cerebro)

**Estado:** listo para Fable 5.1  
**Rama:** `codex/statsedge-ui-polish` (lectura; **sin código** en esta fase)  
**Modelo:** **Fable 5.1**  
**Tipo:** dirección visual + tipografía/color/botones/transiciones + móvil · oleadas. **Sin código.**  
**Dueño 2026-09-05 noche:** no solo filtros — look general; filtros son lo que más arrastra; no hace falta ser agresivo, sí verse mejor y usarse mejor en móvil.

## Por qué ahora (y qué no es)

SHELL A→D y UX-READ ya movieron **estructura y lectura**. Lo que sigue oliendo a “hace meses” es la **piel**: densidad, verde dominante, botones, tipografía, transiciones, sensación de UI acumulada.

Existe `styles/tokens-v2.css` («Pizarra y Tiza») y `docs/design/DIRECCION-VISUAL.md` — **verde-pizarra** deliberado, **aún no migrado** en bloque. El dueño pide **menos verde** y mejores elecciones de tipo/tamaño/color. Fable debe **juzgar** si v2 se enmienda, se sustituye, o se toma solo la disciplina (tokens, no hex sueltos) con otra paleta.

Este encargo **no** reabre mesa de vistas, scoring, VCP motor, tape producto, ni Mini ops.

## Superficies a mirar (prioridad)

1. **Filtros / aside** (más deuda visual) — tarjetas familia, ⏻, intensidad, modal, chips «+ Filtro»  
2. **Home caza** — rail fichas, verdad, toolbar, mesa  
3. **Ficha `/stock`** — chrome alrededor del chart (no rediseñar el motor del gráfico)  
4. **Móvil ≤480** — fold, bottom nav, drawer; calidad de uso, no solo “que quepa”

## Evidencia / lecturas

| Fuente | Uso |
|---|---|
| `styles/tokens.css` | v1 activo: Inter + JetBrains; `--positive/#2bd576`, `--accent` azul |
| `styles/tokens-v2.css` | v2 no importado en bloque: pizarra verde `#17291F`, Archivo / Instrument / Spline Mono |
| `docs/design/DIRECCION-VISUAL.md` | doctrina v2 (si existe / vigente) |
| `docs/analisis-ux-shell-aside-2026-09-03.md` | SHELL: cerebro del aside ya decidido |
| `docs/analisis-ux-btn-acabados-2026-08-29.md` | UX-BTN 1–6 ya hicieron un pase de botones |
| `docs/prototypes/tape/` | dirección caza futura; **no** mezclar en este brief como impl |
| Mini `:13000` o local logueado | hard-reload home + filtros + `/stock/AAPL` + viewport 390 |

## Misión

1. **Diagnóstico visual** (no vibes): por qué se ve “viejo / demasiado verde / lab”; citá tokens y superficies.  
2. **Dirección de look** moderada: tipografía (familias + escala de tamaños), paleta (menos verde de lienzo; verde solo semántica alcista si hace falta), botones, 2–3 transiciones útiles (no decoración).  
3. **Filtros primero** en la propuesta de piel, sin reabrir el mapa SHELL (Mercados + familias).  
4. **Móvil:** principios de calidad de uso (targets, fold, scroll, teclado/virtual).  
5. **4–6 oleadas** implementables (P0→P2), cada una acotada (tokens → botones → aside → mesa → stock chrome → móvil). Sin reescritura monolítica.  
6. Qué **no** tocar.

## Fuera de alcance

- Código JSX/CSS/tests en esta fase.  
- Scoring, umbrales, hunt semantics, motor VCP/etapa, Mini/GHA.  
- Inventar veredictos de compra.  
- Look SaaS genérico (púrpura, cream+serif terracotta, glow, dashboard de métricas).  
- Sustituir el rail de 5 fichas ni la mesa de vistas.  
- Implementar tape producto (proto aparte).

## Formato de retorno (pegar al orquestador)

```
## Resumen
(8–12 líneas: veredicto + dirección de look)

## Diagnóstico (por qué se ve viejo / verde / lab)
(bullets con evidencia tokens/UI)

## Dirección visual
### Tipografía (familias + escala)
### Color (paleta; qué pasa con pizarra-verde v2)
### Botones e interacción
### Transiciones (máx 3 tipos útiles)
### Móvil (calidad de uso)

## Filtros: piel sin tocar el cerebro SHELL
(qué cambia visualmente; qué no)

## Oleadas
| ID | Título | Prio | Zona | Riesgo | Criterio aceptación |

## Qué no tocar
(…)

## LO QUE NO VERIFIQUÉ
(…)
```
