# Ticket activo — STOCK-FIRE-1 (chart in fold)

**Estado:** listo para Agent  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Tipo:** apagar fuego UI · ficha `/stock` móvil ≤480 · sin features nuevas  
**Evidencia orquestador (2026-09-02):** `http://localhost:3310/stock/AAPL` · **390×844** · canvas `top≈1175` · `usefulChartPx: 0` · veredicto 356 + clasificación 184 + prefs 336 empujan el gráfico fuera del fold.

**MIGRATE-1:** mañana 3 sep — no mezclar.

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md @docs/tickets/STOCK-FIRE-1-chart-in-fold.md

Rama: codex/statsedge-ui-polish
Modelo: Composer

Alcance STOCK-FIRE-1 SOLO:
En viewport ≤480 (prioridad 390×844), al abrir /stock/{symbol} el canvas del gráfico debe tener superficie útil visible sin scrollear ~1100px.
Compactar .stockVerdict + .stockUserClassification (nota colapsable OK) y chrome pre-canvas (.stockChartBenchmarkControl + .chartPrefs) en móvil.
Desktop ≥760 sin degradar. Sin motor/scoring/VCP/MIGRATE/auth/nocturno/swipe entre símbolos.
Aceptación: usefulChartPx ≥ 180 (preferible ≥220) con scrollY≈0; sin overflow-x.
Tests del área si toca. Smoke :3310 si está arriba.
Sin commit ni push. Devuelve plantilla de retorno.
```

## Contexto

Mesa móvil (MOBILE-FIRE-1…3) y poda filtros (FILTER-SHELL) ya cerradas. Siguiente fuego natural: ficha `/stock` — hoy el fold solo muestra veredicto + clasificación + controles; las velas empiezan ~1175 px.

## Archivos probables

- `app/stock/[symbol]/StockClient.jsx`
- `styles/stock.css`
- `app/ChartPreferences.jsx` / CSS prefs (solo densidad móvil)
- Tests viewport/CSS stock si existen

## Fuera

MIGRATE · VCP · scoring · swipe entre tickers · rediseño fundamentals.
