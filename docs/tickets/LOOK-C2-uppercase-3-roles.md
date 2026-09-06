# LOOK-C2 — Uppercase solo en 3 roles

**Estado:** Cerrado (orquestador 2026-09-06) · smoke home: meta `layerControlMeta`/`huntCardModeBadge` = `none`; cabeceras/métricas = uppercase  
**Prioridad:** P2 · deuda LOOK-C  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer 2  
**Origen:** `docs/analisis-ux-look-redisenio-2026-09-05.md` · LOOK-C cerrado parcialmente (`1c958ce`) · deuda «uppercase 3 roles»  
**Tipo:** CSS (+ JSX solo si el copy en mayúsculas está hardcodeado en markup) · **no scoring**

## Problema

LOOK-C dejó controles/transiciones/escala, pero `text-transform: uppercase` sigue masivo (p. ej. ~85 en `screener.css`, ~44 en `components.css`). Meta, hints y chips de laboratorio siguen gritando en mayúsculas + tracking → olor a panel de lab.

## Los 3 roles permitidos (Fable / LOOK-C)

Uppercase + tracking **solo** en:

1. **Cabecera de sección** (eyebrow / título de bloque corto)
2. **Cabecera de tabla** (`th` / labels de columna densos)
3. **Micro-label de métrica grande** (label encima de cifra hero: Universo / Pasan / Score, etc.)

Todo lo demás → **sentence case**, sin `letter-spacing` de tracking de label salvo esos 3 roles.

## Alcance (hacer) — oleada 1 = superficie screener home

1. Inventario corto en el retorno: cuántos `uppercase` había vs quedan en archivos tocados.
2. Prioridad: `styles/screener.css` (home / mesa / aside chrome). Luego, si cabe sin expandir: `styles/components.css` solo selectores que el screener importa a la vista home.
3. Quitar uppercase de: meta de tarjeta, «N reglas», hints, badges secundarios, botones de chrome que no sean los 3 roles, footers, empty states.
4. **No** tocar: Display Archivo en títulos de pantalla ya correctos; curva de etapa; firma de chart.
5. Test CSS de contrato si ya hay patrón (`lookCControlsCss` / similar): pin de que meta/hints no usan uppercase, o snapshot de selectores allowlist.
6. `./vfc` tocados.

## Fuera de alcance

- `stock.css` / `market-health.css` / IPO / lists / review (oleada 2 si hace falta)  
- Scoring · TAPE · Mini · cambiar familias tipográficas  
- Reabrir alturas/transiciones de LOOK-C  
- Commit/push desde Agent

## Criterios de aceptación

1. En home screener (Browser Use): meta «N reglas», hints y chips no gritados en ALL CAPS; cabeceras de sección/tabla/métrica grande sí pueden seguir en uppercase.
2. `rg 'text-transform:\s*uppercase' styles/screener.css` baja de forma material (documentar antes/después); leftovers justificados = los 3 roles o listados en LO QUE NO.
3. Sin regresión grave de layout (tracking quitado no rompe wrap de chips).

## Archivos probables

- `styles/screener.css`
- `styles/components.css` (acotado)
- tests CSS nuevos o extensión `tests/lookC*.test.js`

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## Inventario uppercase (antes → después)
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
