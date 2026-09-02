# MOBILE-FIRE-1 — Primer resultado visible en el fold (móvil)

**Estado:** Cerrado 2026-09-02 (verify orquestador)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Prioridad:** fuego UI (dueño: adaptar móvil + fluidez; no features nuevas)

## Evidencia (orquestador 2026-09-02)

Servidor: `http://localhost:3310/` (dev aislado; `:3000` no estaba arriba).

| Métrica | 390×844 | 1280×900 |
|---|---|---|
| `.mobileResearchHome` | montado / `block` | no montado |
| `.desktopResultsSection` | no | `block`, 50 filas |
| Overflow-x | no | no |
| Primer `/stock/` `top` | **≈900 px** | n/a |
| `firstInFold` | **false** | — |
| Scroll hasta 1.er ticker | **~840 px** | — |
| `.bottomNav` | **122 px** fijo | `display:none` |

Chrome encima de la lista incluye: top bar, título, banners de estado/fusión/carga, buscador, rail de fichas, verdad, toolbar resultados. Con selección multi-mercado los banners hinchan el fold.

## Objetivo

En **≤760 px** (smoke obligatorio **390×844**), al abrir el screener con datos ya en mesa (o tras carga), el usuario ve **al menos el primer resultado** sin desplazarse casi un viewport entero.

## Alcance

1. Compactar / colapsar / apilar avisos en móvil (fusión parcial, actualizando, filtros actualizados) para no empujar la lista fuera del fold.
2. Reducir densidad del bloque superior (toolbar resultados, periodo, CSV/Guardar/Revisar) en ≤480.
3. Bajar altura de `.bottomNav` (hoy ~122 px) manteniendo tappable + `safe-area-inset-bottom`.
4. Preservar CLEAN-2: no remontar árbol desktop en móvil ni viceversa (760).

## Fuera de alcance

- Rediseño de hunt rail / metodología / VCP / STAGE.
- Perf cold hunt R-06 (salvo que un cambio de layout lo mejore de paso).
- MIGRATE, auth, nocturno.
- Tablet “perfecta” intermedia: smoke 760 ok si no regresa dual DOM.

## Aceptación

```js
// 390×844, scrollY≈0, lista con ≥1 fila
firstStock.getBoundingClientRect().top < innerHeight - bottomNavHeight
// preferible: top < 0.7 * innerHeight
```

Sin `scrollWidth > clientWidth`. Desktop sin bottomNav visible.

## Verificación

- Browser Use / CDP: 390 y ≥760 tras hard-reload.
- Tests existentes del shell/móvil si los hay; no inventar suite enorme.
- Sin commit ni push (programación).
