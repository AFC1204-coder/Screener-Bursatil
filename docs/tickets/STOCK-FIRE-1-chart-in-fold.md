# STOCK-FIRE-1 — Gráfico visible en el fold (ficha móvil)

**Estado:** listo para Agent  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Prioridad:** fuego UI · ficha `/stock` ≤480 · sin features nuevas  
**Previo:** MOBILE-FIRE-1…3 (mesa) · CHART-UI-1 (prefs compact desktop)

## Evidencia (orquestador 2026-09-02)

Servidor: `http://localhost:3310/stock/AAPL` · viewport **390×844** · `scrollY=0`.

| Bloque | top | height |
|---|---:|---:|
| `.stockVerdict` | 62 | **356** |
| `.stockUserClassification` | 438 | **184** |
| `.stockChartPanel` | 652 | — |
| `.chartPrefs.compact` (dentro panel) | 825 | **336** |
| `canvas` del gráfico | **1175** | 382 |
| `.bottomNav` | 756 | 82 |

- `chartInFold: false` · `usefulChartPx: 0` (ningún píxel de canvas en el fold útil).
- Scroll hasta ver velas: **~1135 px**.
- Sin overflow-x.
- En el primer viewport solo se ve: cabecera/veredicto + clasificación + título «Gráfico» + «Comparar vs» — **cero velas**.

Chrome encima del canvas ≈ veredicto+clasificación (~540) + chrome interno del panel (~523: benchmark + prefs).

## Objetivo

En **≤480 px** (smoke **390×844**), al abrir `/stock/{symbol}` con datos, el usuario ve **superficie útil del gráfico** (canvas) sin scrollear casi un viewport y medio.

## Alcance

1. Compactar / reordenar chrome **por encima** del canvas en móvil:
   - `.stockVerdict` más denso (menos aire; identidad+precio en menos filas).
   - `.stockUserClassification`: nota colapsada por defecto o rail más bajo; botones Candidata/Vigilar/Descartar siguen usables.
2. Compactar chrome **dentro** de `.stockChartPanel` antes del canvas:
   - `.stockChartBenchmarkControl` + `.chartPrefs.compact` en ≤480: menos altura (filas scrollables / clusters / `<details>`), sin quitar controles.
3. Preservar desktop ≥760: no degradar layout actual de ficha.
4. No tocar motor, scoring, VCP unificado, ni contenido de fundamentals debajo.

## Fuera de alcance

- Swipe entre símbolos / raíl Anterior-Siguiente (fricción C10 — otra oleada).
- Rediseño hunt, MIGRATE, auth, nocturno.
- Segunda capa VCP / hunt card.
- PERF cold chart (salvo ganancia de layout).

## Aceptación

```js
// 390×844, /stock/AAPL (o GOOGL), scrollY≈0, chart cargado
const canvas = document.querySelector('.stockChartPanel canvas, .universalChart canvas');
const bottomH = document.querySelector('.bottomNav')?.getBoundingClientRect().height || 0;
const r = canvas.getBoundingClientRect();
const visible = Math.max(0, Math.min(r.bottom, innerHeight - bottomH) - Math.max(r.top, 0));
// visible >= 180  (preferible >= 220)
// r.top < innerHeight - bottomH
```

Sin `document.documentElement.scrollWidth > clientWidth`. Desktop 1280: chart usable como hoy (smoke spot).

## Verificación

- Browser Use / CDP en `:3310` tras hard-reload.
- Tests CSS/viewport existentes del stock si aplica; no inventar suite enorme.
- Sin commit ni push (programación).
