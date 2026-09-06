# LOOK-D — Aside piel (tarjeta, chips, intensidad, modal, drawer)

**Estado:** cerrado (smoke orquestador OK 2026-09-06; hotfix terminal 2-col + drawer top:0)  
**Rama:** `codex/statsedge-ui-polish` (o `cursor/look-d-…` si Cloud; **no merge** sin smoke)  
**Modelo:** Composer 2  
**Análisis:** `docs/analisis-ux-look-redisenio-2026-09-05.md` §Filtros + oleada LOOK-D  
**Depende:** LOOK-A ✅ (grid) · LOOK-B ✅ (lienzo) · LOOK-C ✅ (controles/tokens)  
**Tipo:** CSS (+ JSX mínimo solo si chips/link/drawer lo exigen) · sin commit/push desde Agent.

## Contexto

Lienzo v2.3 y controles tokenizados ya están. El aside sigue oliendo a lab: apilado verde (lienzo→surface→tarjeta), chips truncados, intensidad «PERSONALIZADO» ámbar, modal con checks verdes Tailwind, drawer con cabecera negra v1. **No tocar cerebro SHELL** (⏻/−N/intensidad/cobertura/modal como único editor).

## Alcance (hacer)

### 1. Aside + tarjeta de familia

- Aside desktop: fondo **`--bg`** (lienzo), no `--surface`. Máximo **2 superficies** visibles: lienzo + panel/tarjeta.
- Tarjeta familia: `--surface` + `--line2` + `--shadow-panel` (si existe; si no, borde `--line2` basta).
- Anatomía (LOOK-A ya fijó grid): `[⏻ --control-m] [cuerpo 1fr: nombre --text-s 600 + meta sentence case --text-xs humo] [ⓘ 24] [Abrir ▸ ghost --control-s]`; con intensidad, barra en fila 2 a lo ancho.
- ⏻ off: ghost (borde `--line`, glifo humo); **no** desvanecer toda la tarjeta (`opacity` en fila off → solo texto humo).
- ⏻ on: `--senal-dim` + `--line3`.
- Meta / «N reglas» / hints: **sentence case**, sin uppercase+tracking (salvo cabecera de sección).

### 2. Chips de mercado

- 272 px: **2 columnas** con etiqueta completa **o** fila scrollable; nada truncado tipo «US+Cor».
- «Personalizar mercados (N/M)» → link `--text-xs` bajo los chips (no botón CTA ancho). JSX mínimo OK.
- Punto rojo junto a MERCADOS → `--senal` **solo** si selección ≠ mesa.

### 3. Intensidad

- Pista `--line2`, relleno `--soft`, tirador tiza ~16 px (hit 24).
- «PERSONALIZADO» ámbar → «Personalizado» tiza 600 `--text-xs`.
- Hint «Mover la barra…» → tooltip de ⓘ si es cambio pequeño; si no, ocultar o sentence case humo (no bloque ámbar).

### 4. Modal de familia

- Inputs numéricos 2 dígitos: `width: 6ch` (o `ch` equivalente), label a la izquierda en fila.
- Checkboxes `#22c55e/#4ade80` → caja `--line3` + check tiza (tokens; sin hex Tailwind).
- Chips «Exigencia»: activo = `--senal-dim` + `--line3`.
- Cabecera: nombre familia en `--display-s` (o `--text-m` 600); subtítulo sentence case. Retirar lavanda `--rs-theme` como color de familia si aparece ahí.
- Objetivo: modal Tendencia cabe en ~844 px de alto sin scroll interno hasta «Ajustes finos» (aprox.).

### 5. Drawer móvil

- Cabecera: **tiza / tokens v2.3**, no `rgba(5,5,6,.96)` negro v1 (`.mobileSidebarHeader`).
- Drawer a pantalla útil: cubrir app bar y bottom nav cuando abierto (z-index / inset); sin contenido tapado por nav.
- Transición entrada: `--t-enter` si toca.

### 6. `!important` (solo esta zona)

Quitar `!important` en `.layerControlRow`, `.mobileSidebarHeader` (y `.marketChip` si lo tocas). No barrer toda la app.

## Fuera de alcance

- LOOK-E (mesa / `.stockPreview` / chrome `/stock`) · LOOK-F (fold completo, sub-barra sticky, viewport)
- SHELL cerebro · `FILTER_FIELDS` · settings/sesión · scoring · hunt semantics
- Cambiar familias tipográficas · Curva de Etapa
- Commit/push / merge a polish

## Tests / verificación Agent

```bash
# muestreo: aside bg, chips, modal checks sin #22c55e
rg '#22c55e|#4ade80|rgba\(5,\s*5,\s*6' styles/screener.css styles/components.css || true
npm test -- tests/lookCControlsCss.test.js tests/btnPrimaryCss.test.js 2>/dev/null || true
# + cualquier test CSS aside/modal existente
./vfc archivos tocados
```

Smoke visual: **orquestador** (home aside 1440 @ ~272 px; abrir modal Tendencia; drawer Filtros @ 390).

## Criterio de aceptación

1. Aside 272 px: ≤ 2 superficies (lienzo + panel); tarjetas legibles sin solapes (LOOK-A intacto).  
2. Chips sin truncado grave; Personalizar como link.  
3. Modal sin checks verdes Tailwind; inputs compactos.  
4. Drawer cabecera no-negra; no tapa bottom nav el contenido crítico.  
5. Sin cambios en claves/settings/comportamiento de filtros.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
