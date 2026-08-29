# CHART-NAV — Navegación libre del gráfico (tipo TradingView)

**Estado:** Pendiente · oleada chart (junto a CHART-RS)  
**Origen:** dueño 2026-08-29 — el gráfico se queda «encasillado» en la zona de referencia; quiere moverse como en TradingView.

## Problema

Hoy la ficha/vista rápida parece anclar o limitar el rango visible a una ventana de referencia (etapa / setup / auto-fit), de modo que el usuario no puede explorar con fluidez el histórico completo: pan horizontal, zoom, reset a «ver todo» / «última sesión» a voluntad.

## Objetivo (producto)

1. **Pan** horizontal fluido (arrastre / scroll trackpad) sobre el histórico disponible.  
2. **Zoom** (rueda / pellizco / botones +/−) sin perder el contexto de precio.  
3. **No** quedar atrapado en la ventana de referencia: la zona de interés (base, pivot, etapa) puede **marcarse** (líneas/sombreado) pero no debe **secuestrar** el `timeScale`.  
4. Controles mínimos: «Ajustar a datos» / «Ir a zona de interés» (opcional) como acciones explícitas, no como estado forzado permanente.  
5. Misma sensación en ficha `/stock/[symbol]` y en Vista rápida (si comparten controlador).

## Fuera (v1)

- Clonar TradingView (dibujos, alertas, multi-layout).  
- Cambiar motor de datos OHLC / RS.  
- CHART-RS (overlay RS) — ticket hermano; puede ir antes o en paralelo si no chocan en `timeScale`.

## Referencias probables

- `app/useChartController.js`, `app/chartNativeAdapter.js` (lightweight-charts v5 `timeScale`)  
- Cualquier `setVisibleLogicalRange` / `fitContent` / auto-scroll al cargar  
- Spec gráfica previa: `docs/analisis-grafico-2026-08-14.md`

## Verificación (cuando se programe)

- Smoke: abrir ficha → arrastrar atrás en el tiempo → zoom → volver sin que el chart «salte» solo a la zona de referencia.  
- Tests de controlador si hay helpers de rango visibles.

## Modelo sugerido

Composer 2.5 · MED–HIGH · smoke Browser Use obligatorio (gesto real).
