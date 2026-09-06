# UX-IPO-1 — Brief Fable: IPO ya cotizadas (universo actual)

**Estado:** Cerrado (aceptado 2026-09-07) · retorno → `docs/analisis-ux-ipo-superficie-2026-09-07.md`  
**Impl P0:** IPO-UX-A (activo) · B · C  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Fable 5.1 (preferido) · Grok 4.6 (aceptable si el brief se respeta al pie; frontera dura primero)  
**Tipo:** brief + kill list + oleadas. **Sin código.**  
**Origen:** dueño 2026-09-07 (aclaración).  
**Previo:** IPO-1 / 1a–1c · UX-FILTERS · `docs/tickets/IPO-1-radar-producto.md`

## Frontera dura (leer primero)

**Este encargo NO es operativa pre-IPO.**

| Fuera de este brief (no diseñar, no proponer como P0) | Dentro (demanda del dueño) |
|---|---|
| Avisar al usuario de salidas futuras | **Mostrar** valores **ya incluidos** en el universo / mesa (miles de acciones que ya tenemos) |
| Que el usuario meta a mano empresas «cuando salgan» | Filtrar las que **ya cotizan** y tienen **salida reciente** (`ipoDate`) |
| Vigilancia / seguimiento pre-listado | Revisar ese **grupo de IPOs recientes** en producto |
| Reformar el CRUD de `/ipo-radar` como destino principal | La fecha/ventana la **elige el modelo** (la que mejor encaje swing/stage) |

`/ipo-radar` (vigiladas locales, «próximas 14 días», añadir IPO) es **ruido histórico** para este brief: puedes mencionarlo en kill list («apartar / no confundir»), pero **no** es el problema a resolver ni el destino P0.

Comparar entre IPOs y RS tipo MarketSmith = **oleadas posteriores**, no bloquean P0.

## Demanda (una frase)

En la mesa de miles de tickers **ya analizados**, hacer visible y revisable el subconjunto de **IPO recientes** (ya en bolsa), con la ventana de edad que juzgues más útil.

## Por qué ahora

El dato existe: ficha hunt **Radar IPO** → `ipoDiscovery` pasa ~**286 de 3319** en US (smoke 2026-09-07). El cuello no es `ipoDate` vacío.

El hueco es de **producto / lectura**:

| Pieza hoy | Realidad | Problema para esta demanda |
|---|---|---|
| Ficha **Radar IPO** | Filtro discovery sobre la **misma** parrilla (edad ≤72 m) | Existe el recorte, pero no se siente «estas son las salidas recientes»; ventana poco explícita; columnas = caza genérica |
| `/ipo-radar` | Pre-IPO / vigiladas | **Confunde** con la demanda actual — no usarlo como norte |
| Familia filtros IPO | Intensidad / cobertura | Herramienta, no la experiencia «revisar IPOs recientes» |

## Tres preguntas (un solo juicio)

1. **¿Dónde se lee el cohort?** ¿Basta endurecer la ficha hunt + lente/columnas/ventana visible en la **mesa principal**, o hace falta otra superficie **solo** para cotizadas recientes (sin pre-IPO)? Decisión con evidencia; no mezclar con vigiladas.
2. **Ventana.** ¿Cuántos meses desde `ipoDate` como default? (El dueño dijo «un año o lo que mejor consideres».) Chips/presets si ayudan. Criterio: stage/swing (Weinstein/Minervini), no calendar de banca.
3. **Fila en ~2 s.** En ese cohort, ¿qué 3–5 datos bastan (fecha/edad IPO, RS, etapa, perf, tema…)? ¿Qué de la parrilla actual es ruido?

## Evidencia viva (orquestador 2026-09-07 · `:3000`)

- Mesa US · **Radar IPO**: «**286 de 3319 pasan**» — universo scan ya tiene IPO recientes filtrables.
- Preset: `ipoDiscovery` · `requireRecentIpo` · `maxIpoAgeMonths: 72` (`lib/screenerFilterCatalog.js`).
- `/ipo-radar` = pre-IPO — **fuera del P0** de este brief (solo kill list / no confundir).

## Lecturas obligatorias

| Fuente | Uso |
|---|---|
| `docs/tickets/IPO-1-radar-producto.md` | Decisiones multi-mercado / discovery (contexto dato) |
| `docs/principios-producto.md` | Sin veredictos; ausencia honesta |
| `docs/analisis-ux-filters-presentacion-2026-08-28.md` | Familia IPO; discovery vs strict |
| `lib/screenerHuntCards.js` / `lib/screenerFilterCatalog.js` | Ficha + `ipoDiscovery` |
| `lib/screenerColumns.jsx` | Parrilla actual |
| `docs/analisis-grafico-2026-08-14.md` | Solo contexto oleada **posterior** RS — no scoring aquí |

Browser Use opcional: hard-reload `/` + ficha Radar IPO. **No** hace falta diseñar `/ipo-radar` pre-IPO.

## Misión

1. Responder las 3 preguntas con evidencia.  
2. **Dirección P0:** cómo se **muestran** las IPO ya cotizadas del universo actual (ventana + UI).  
3. **Kill list:** qué apartar para no mezclar con pre-IPO / «añadir cuando salga».  
4. **Oleadas:** P0 = mostrar/revisar cohort; P1 = comparar entre ellas; P2 = RS IPO (MarketSmith) — aparcado, 1 párrafo.  
5. Qué no tocar (scoring, nocturno, feed de pago, CRUD pre-IPO como feature).

## Fuera de alcance

- Código.  
- Operativa pre-IPO (avisos, alta manual, seguimiento «cuando salga»).  
- Feed IPO de pago.  
- Motor RS IPO (solo señalizar P2).  
- Veredictos de compra.

## Formato de retorno (pegar al orquestador)

```
## Resumen
(8–12 líneas: veredicto P0 = IPO ya cotizadas del universo; sin pre-IPO)

## Respuestas
(1–3)

## Destino
(dónde se lee el cohort; cómo se evita confundir con vigiladas)

## Ventana de fecha
(default + por qué; chips si aplica)

## Kill list
(bullets — incluir qué hacer con /ipo-radar pre-IPO: no tocar / ocultar / renombrar / etc.)

## Oleadas
| ID | Qué | Prioridad |
|---|---|---|
| IPO-UX-A | mostrar cohort… | P0 |
…

## P2 aparcado (RS / peer)
## Fuera / no tocar
```

Sin commit de código. Orquestador → tickets solo para P0 tras tu retorno.
