# LOOK-F — Móvil calidad de uso (fold + sticky + teclado)

**Estado:** cerrado (smoke orquestador OK 2026-09-06; hotfix Listo drawer 44px)  
**Rama:** `codex/statsedge-ui-polish` (o `cursor/look-f-…` si Cloud; **no merge** sin smoke)  
**Modelo:** Composer 2  
**Análisis:** `docs/analisis-ux-look-redisenio-2026-09-05.md` §Móvil + oleada LOOK-F  
**Depende:** LOOK-A…E ✅ (layout, tokens, controles, aside, mesa/preview)  
**Tipo:** CSS + JSX mínimo (sub-barra sticky / disclosure estado) · sin commit/push desde Agent.

## Contexto

Ya hay: ✕ Limpiar en input (C), preview flotante (E), drawer full-bleed (D), nav 6 cols + Filtros sticky parcial (A).  
Lo que falta para que el **fold a 390×844** sea usable: estado multi-línea, hunt rail pequeño sin máscara, `body` con padding ~116 px, `maximumScale:1` (malo para a11y), inputs &lt;16 px en sitios, y no hay sub-barra sticky «Filtros · ficha · Revisar».

**No tocar** cerebro SHELL, scoring, chart motor, desktop polish salvo lo que el `@media` móvil requiera.

## Alcance (hacer)

### 1. Fold home @ ≤760 / 390

Objetivo de aceptación: **sin scroll** (o con scroll mínimo) visibles: franja de estado + ficha activa (o acceso) + línea de verdad + **≥ 3 filas** de mesa (o empty state de mesa).

- Estado / fusión: compactar a **1 línea** + disclosure (`FUSIÓN PARCIAL · N mercados ▸` o equivalente). JSX mínimo OK.
- «Limpiar» ancho: ya ✕ (LOOK-C) — verificar que no reaparece fila completa.
- Preview búsqueda: ya popover (LOOK-E) — no debe empujar el fold; no reabrir LOOK-E.

### 2. Sub-barra sticky

Bajo el app bar en home móvil: **`Filtros (n) · [ficha activa ▾] · Revisar`** (copy aproximado Fable).

- `position: sticky` (o fixed bajo top bar); targets ≥ **44 px**.
- JSX mínimo en `ScreenerShell` / chrome móvil; reutilizar disparador Filtros y navegación Revisar existentes.
- No tocar IA del bottom nav.

### 3. Hunt rail

- Altura chip/botón **≥ 40 px** (ideal `--control-l` / 44 CTA).
- Scroll horizontal con **máscara de degradado** en el borde (afordancia).
- No cambiar semántica de fichas de caza.

### 4. Teclado / viewport

- Inputs de búsqueda y umbrales visibles: **`font-size: var(--text-l)` (16 px)** en `≤760`.
- Modal familia: `inputmode="numeric"` (o `decimal`) en inputs numéricos — JSX mínimo en el componente del modal.
- **Quitar** `maximumScale: 1` de `app/layout.jsx` `viewport` (dejar zoom accesible; el 16 px evita zoom iOS).

### 5. Chrome inferior

- `body` / `.page` `padding-bottom` ≈ **altura real bottom nav** (~56–64 + safe-area), no 116 px heredado.
- Bottom nav: 56 px + safe-area; sin flotante raro `bottom: 6px` si aún resta en rutas tocadas (LOOK-A ya 6 cols).
- Consolidar breakpoints **solo** en bloques que edites (preferir 760 / 480; no inventar 430/420 nuevos).

## Fuera de alcance

- SHELL / scoring / nocturno / Mini / chart adapter  
- Rediseño desktop aside/mesa (A–E)  
- Safari iOS real (smoke CDP Chrome; zoom iOS = dueño/BrowserStack)  
- Commit/push / merge a polish

## Tests / verificación Agent

```bash
rg 'maximumScale' app/layout.jsx   # objetivo: ausente o no 1
rg 'padding-bottom:\s*116|padding-bottom:calc\(116' styles/ || true
npm test -- tests/lookEMesaStockChrome.test.js tests/lookDAsideCss.test.js tests/stockFire1MobileFold.test.js tests/screenerHuntCardRail.test.js 2>/dev/null || true
./vfc archivos tocados
```

Smoke visual: **orquestador** (home 390×844: fold + sticky + hunt rail; abrir Filtros; focus input).

## Criterio de aceptación

1. A 390×844: estado + ficha/acceso + verdad + ≥ 3 filas mesa en primer viewport (medición CDP).  
2. Targets primarios (Filtros sticky, Revisar, hunt chips, CTA drawer) ≥ 44 px.  
3. `maximumScale: 1` eliminado; inputs clave a 16 px.  
4. `padding-bottom` coherente con nav real.  
5. Sin regresión grave desktop 1440.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
