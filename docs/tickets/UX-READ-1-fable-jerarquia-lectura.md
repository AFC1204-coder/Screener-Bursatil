# UX-READ-1 — Brief Fable: jerarquía de lectura (mesa → ficha)

**Estado:** Cerrado (dueño 2026-09-05 noche)  
**Retorno:** `docs/analisis-ux-read-jerarquia-2026-09-05.md`  
**Impl:** READ-A′ `82417e5` · READ-C `557deb3` · READ-D `edab7ab` · READ-E `6a481f1` · READ-F `67da5b3`  
**No hecho (a propósito):** READ-B (lente por ficha; VCP se queda en mesa).  
**Aparcado:** discordancia cifras RS · badge opacity.  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Fable 5.1  
**Tipo:** brief + kill list + oleadas. **Sin código.**  
**Previo:** UX-1 mesa de vistas · UX-P chrome · SHELL A→D aside · TABLE-QUIET-1 · CHART-BADGE-2

## Por qué ahora (y qué no es)

El aside ya no es el inventario. La mesa **sí**: diez columnas fijas para cinco fichas de caza distintas; tres RS + etapa + VCP en la misma fila; la ficha `/stock` y el badge del chart vuelven a contar la estructura.

Este encargo **no** reabre mesa de vistas, SHELL, ni scoring. Pide: **qué debe leerse, y dónde**, en un pase de caza de mañana.

## Cuatro preguntas (un solo juicio)

Trabajarlas **juntas**. No son cuatro audits.

1. **Fila en ~1,5 s.** En Líderes Etapa 2, ¿qué **tres datos** bastan para abrir ficha o pasar al siguiente? ¿Qué columnas son ruido en ese gesto?
2. **La ficha de caza como lente, no solo filtro.** Hoy las 5 fichas recortan filas y cambian sort, pero la **misma parrilla** (tema, RS, RS país, RS tema, etapa, VCP, 3M, dist 52s, cap). ¿Qué columnas existen solo en esa ficha? En concreto: **un RS vs tres**, y **etapa (“Con fuga”) vs VCP (`2C·form·PV%`)** — ¿dos juicios o el mismo setup en dos dialectos?
3. **Ficha `/stock`: una frase canónica.** El chart de AAPL ya dice «Base constructiva 12.9% → 4.9%». ¿Qué bloques de la ficha **repiten** esa frase (franja, N3, strip, hints, overlays RS)? ¿El gráfico es el escenario de decisión y el resto leyenda, o al revés?
4. **Verdad: instrumento vs log.** `3319 analizadas · 593 pasan · 593 en lista · 50/página · mesa US · orden · corte · RANKING PROVISIONAL` — ¿qué 1–2 cifras merecen peso, y el resto a `details`? El badge provisional: ¿en la verdad, en celdas RS, o callar hasta percentil final?

## Evidencia viva (orquestador 2026-09-05 · Mini `:13000`)

**Mesa US · Líderes Etapa 2 · 50 filas · 593 en lista · 3319 analizadas.**

Cabeceras: TICKER · TEMA · RS · RS país · RS tema · ETAPA · VCP · Rend. 3M ↓ · Dist. máx 52s · Capitaliz.

- Etapa típica: `Etapa 2` / `Etapa 2 Con fuga`.
- VCP con dato: `2C·form·PV-1.5%` …; **30/50** ausente (guion quieto, TABLE-QUIET-1).
- RS tema: **29/50** ausente (quieto).
- Orden visible: rendimiento 3M (default de la ficha `lideres-etapa-2` = `activePerf`).
- Verdad + badge `RANKING PROVISIONAL` (residual honesto ~batch; finalize = Mini mañana, no este brief).

**Ficha AAPL:** badge chart `BASE CONSTRUCTIVA 12.9% → 4.9%` (CHART-BADGE-2). Overlay de markers sigue gated por actionable.

**Rail:** Líderes Etapa 2 · Cerca de pivot · Deterioro · Líderes intl · Radar IPO. Código: `lib/screenerHuntCards.js` — preset + sort; **no** cambia columnas.

## Lecturas obligatorias (no reinventar)

| Fuente | Uso |
|---|---|
| `docs/principios-producto.md` | P1 sin veredictos · P3/7 ausencia · P5 metodología no repetida por fila |
| `docs/analisis-ux-filtros-ia-2026-08-27.md` | UX-1: mesa de vistas |
| `docs/analisis-ux-producto-final-2026-08-27.md` | UX-P: podar chrome (hecho) |
| `docs/analisis-ux-shell-aside-2026-09-03.md` | SHELL: aside cerrado; no reabrir |
| `lib/screenerColumns.jsx` | Parrilla única desktop/móvil |
| `lib/screenerHuntCards.js` | Ficha = preset + sort |
| `docs/tickets/TABLE-QUIET-1-ausencias-silenciosas.md` | Guion quieto ≠ quitar columna |
| `docs/tickets/CHART-BADGE-2-badge-vs-overlay.md` | Badge ≠ markers |

Si hay Browser Use: hard-reload `http://127.0.0.1:13000/` (o `:3000` logueado) + `/stock/AAPL`. Captura mesa + verdad + una ficha. No inventar UI.

## Misión

1. Responder las 4 preguntas con evidencia (UI / columnas / ficha), no vibes.  
2. **IA de lectura:** qué es diario en mesa, qué solo en ficha/chart, qué se retira.  
3. **Kill list** de columnas, repeticiones en ficha, y trozos de la verdad.  
4. **3–5 oleadas** implementables (P0→P2), cada una acotada (columnas / hunt-lens / ficha / verdad). Sin reescribir el screener entero.  
5. Qué **no** tocar.

## Fuera de alcance

- Código JSX/CSS/tests.  
- Mini / GHA / finalize RPC / scoring / motor VCP / umbrales.  
- Reabrir aside SHELL, rail de 5 fichas, tokens de marca.  
- Look genérico SaaS.  
- Inventar veredictos de compra (principio 1).

## Formato de retorno (pegar al orquestador)

```
## Resumen
(8–12 líneas: veredicto + dirección)

## Las 4 preguntas
(respuesta corta a cada una, con evidencia)

## IA de lectura (mesa / ficha / verdad)
(qué se ve en cada zoom)

## Kill list
| Superficie actual | Acción (retirar / fusionar / enterrar / mantener / lente-por-ficha) | Motivo |

## Oleadas
| ID | Título | Prio | Zona | Riesgo | Criterio aceptación |

## Qué no tocar
(…)

## LO QUE NO VERIFIQUÉ
(…)
```
