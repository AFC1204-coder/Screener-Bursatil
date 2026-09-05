# LOOK-A — Fixes visibles P0 (grid familias · bottom nav · Filtros sticky)

**Estado:** listo para Agent  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2 / GPT-5.6 Terra (mecánico + CSS; sin juicio de paleta)  
**Análisis:** `docs/analisis-ux-look-redisenio-2026-09-05.md` (oleada LOOK-A)  
**Tipo:** CSS (+ JSX mínimo solo si el sticky de «Filtros» exige wrapper) · un commit lo hace el **orquestador** tras smoke.

## Contexto

UX-LOOK-1 (Fable) midió tres bugs en HEAD que rompen uso antes de cualquier rediseño de piel. Esta oleada **solo** esos tres. No tokens v2.3, no tipografía, no kill-list hex.

## Alcance (hacer)

### 1. Grid `.layerControlRow` (aside filtros)

En `styles/screener.css` (~5590–5713):

- Hoy: `grid-template-columns: auto minmax(0,1fr) 24px auto` + `.infoHint { grid-row: 1/-1 }` **sin** `grid-column` → el ⓘ cae a la columna 1fr y aplasta el cuerpo; «Abrir ▸» pisa el título en familias sin `.hasIntensity`.
- Objetivo anatomía (piel mínima, sin cambiar ⏻/−N/intensidad):

```
[⏻ 32] [nombre + meta] [ⓘ 24] [Abrir ▸]
```

- Asignar columnas explícitas: power col 1, body col 2, infoHint col 3, openBtn col 4.
- Con `.hasIntensity`: intensidad en fila 2, `grid-column: 2 / -1` (ya existe patrón; no romper RS).
- `.layerControlRow.simple` (sin Abrir): mantener coherente (3 cols).
- Desktop 272 px aside y drawer móvil: ningún «Abrir» solapa el título.

### 2. `.bottomNav` 6 columnas

- `app/BottomNav.jsx`: **6** `NAV_ITEMS` (Screener…Mercado).
- `styles/components.css` `.bottomNav` (~4279): `repeat(5,…)` → **`repeat(6, minmax(0,1fr))`**.
- Altura útil ~56 px en móvil (una fila); targets ≥ 44 px donde el CSS actual lo permita sin rediseño LOOK-F.
- Revisar overrides `@media` que redefinan columnas a 5 o estrechen la barra hasta forzar wrap (p.ej. `max-width:760` con `width:min(286px,…)` puede seguir apretando — no inventar LOOK-F; si 6 cols caben en viewport, priorizar una fila legible; no quitar ítems).

### 3. «Filtros» sticky en `≤760`

- Disparador actual: `.btn.btnMobileOnly` en cabecera no-sticky (`ScreenerShell.jsx` ~608); tras scroll queda fuera de viewport.
- Hacer el acceso a filtros **siempre alcanzable** tras scroll en home móvil: sub-barra sticky bajo el app bar **o** sticky del propio botón / wrapper mínimo.
- Criterio: tras ~600 px de scroll en home a 390 de ancho, «Filtros» (o equivalente sticky) sigue visible y abre el drawer.
- **No** implementar aún el resto del fold LOOK-F (estado 1 línea, ✕ en input, etc.).

## Fuera de alcance

- Tokens / paleta v2.3 / tipografía / transiciones / kill-list hex  
- SHELL cerebro (mapa familias, ⏻ semantics, modal campos)  
- LOOK-B…F · scoring · chart motor · Mini · commit/push desde este Agent

## Tests / verificación Agent

- Si hay tests de layout/aside existentes, correr los relevantes; si no, no inventar suite grande.
- `./vfc` solo si el ticket toca archivos que el script ya cubre; si no aplica, decirlo.
- Smoke visual lo hace el **orquestador** (Browser Use), no el dueño.

## Criterio de aceptación

1. A 272 px y ~390 px: ningún «Abrir» solapa el título de familia; ⓘ en columna propia.  
2. Bottom nav: **una** fila, 6 ítems.  
3. Home 390: «Filtros» visible tras scroll largo (~600 px).

## Plantilla de retorno

```
## Resumen
(1–4 bullets)

## Archivos
(lista real)

## Tests
(comando + resultado)

## LO QUE NO VERIFIQUÉ
(…)

Sin commit ni push.
```
