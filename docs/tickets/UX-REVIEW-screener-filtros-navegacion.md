# UX-REVIEW — Screener: filtros, resultados y navegación (pasada extensa)

**Rama:** `codex/statsedge-ui-polish`  
**Tipo:** review / QA producto — **sin código salvo hallazgo trivial documentado**  
**Modelo:** Composer o MiniMax M3 · effort **HIGH/MAX** · **Browser Use obligatorio**  
**Origen:** dueño 2026-08-28 — tras oleada UI (UX-P…9) + MET-1b (RS global privado en prod dev)  
**URL:** `http://localhost:3000` (dev reiniciado; hard-reload cada preset)

## Objetivo

Pasada **extensa y real** del screener principal como trader/uso diario: filtros (familias, chips, sidebar, presets), coherencia de **resultados** (conteos, orden, columnas, RS post-global), y **navegación** (tabla → vista rápida → ficha → volver). Entregar informe accionable con tickets propuestos (P0/P1/P2), no opinión genérica.

## Contexto que debes conocer (no reabrir)

- Mesa de vistas: rail de fichas + línea de verdad (`docs/analisis-ux-filtros-ia-2026-08-27.md`).
- RS columna = ranking **global privado curado** (`statsedge-private-global-rs-usd-v1`, W35). Tooltip: «RS global · USD · universo privado curado».
- Modal familia RS aún dice «universo, benchmark, país y grupo» — puede ser deuda copy (verificar si confunde).
- Percentil batch → badge «Ranking provisional» (UX-9).
- Core intl / HK: RS numérico esperado donde el motor rankea; «–» + motivo donde no.

## Matriz mínima de pruebas (todas con evidencia)

### A. Arranque y verdad
1. Hard-reload → esperar carga completa (US ~3319 o conteo coherente en verdad).
2. Línea de verdad: copy claro (sin jerga lab); CTA mercados stale si aplica.
3. Badge ranking provisional cuando `percentileScope=batch`.

### B. Fichas del rail (cada una)
Probar **al menos**: US balanceado / Líderes Etapa 2 / Core intl / Deterioro (ids en `lib/screenerHuntCards.js`).
- Conteo ficha ↔ verdad ↔ tabla (± chips activos).
- Tiempo de respuesta al cambiar ficha (<200 ms percibido en filtros simples; anotar si no).
- Desglose «¿Qué recorta?» coherente con filtros activos.

### C. Filtros (profundidad)
Por **familia** en sidebar (Liquidez, Tendencia, Momentum, **RS**, Cercanía, Volatilidad):
- Abrir modal familia → copy honesto vs lo que hace el filtro.
- Activar/desactivar regla → ¿cambia N visible? ¿chip «+ Filtro» refleja impacto?
- RS: probar `RS min` subiendo (80, 90) — ¿resultados bajan? ¿columna RS coherente?
- RS Bench / País / Grupo / Quality: ¿filtran sin contradecir columna RS global?
- Chips de vista (+ Filtro): añadir/quitar uno; reload — ¿persisten fantasmas? (UX-4 regresión)
- Sort: RS, Rend. 3M/6M/12M, Dist. 52s, Cap — cabecera ↔ filas; reload mantiene sort (UX-3).

### D. Mercados
- Solo US → RS numérico en mayoría.
- **Core intl** o HK → al menos una fila `.HK` / `.TO` / `.L` con **RS numérico** (no solo US).
- Cambio mercado sin scan → banner stale; CTA resuelve o avisa honesto.

### E. Navegación
- Enter / doble clic fila → vista rápida: RS mismo número que tabla.
- «Revisar» → `/review`: RS coherente; cola navegable.
- Ficha `/stock/[symbol]`: RS global; volver al screener conserva preset/filtros.
- Móvil ~390px (resize): rail scroll, drawer filtros usable.

### F. Regresiones conocidas (marcar OK/KO)
- `rsGlobalPct` de lote **no** mostrado como RS.
- HK sin RS mudo sin motivo tras MET-1b.
- Copy «Muestra parcial · percentil por lote» no reapareció (UX-9).

## Severidad

| Nivel | Criterio |
|---|---|
| **P0** | Resultados mentirosos, RS incoherente entre pantallas, filtro no hace lo que dice, bloqueo navegación |
| **P1** | Fricción alta, copy confuso post-RS global, conteos desalineados, gesto >500 ms repetible |
| **P2** | Pulido visual, tooltip, densidad, móvil menor |

## Entregable

Crear `docs/analisis-ux-screener-review-2026-08-28.md` (o fecha real) con:

```
## Veredicto (8–15 líneas)
## Hallazgos (tabla: ID | P | área | evidencia | propuesta ticket)
## Regresiones OK/KO
## Tickets propuestos (UX-10…)
## LO QUE NO PROBÉ
```

**Sin commit ni push** (orquestador decide qué entra al backlog).

## Fuera de alcance

- Cambiar scoring, MET-1c cron, VCP, auth, nocturno.
- Reimplementar filtros o RS.
- Commit/push/código (salvo anotar diff sugerido en el informe).

## Plantilla de retorno (pegar al orquestador)

```
## Resumen
## Archivos
## Tests
(n/a review)
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
