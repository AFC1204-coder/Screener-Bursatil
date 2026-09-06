# LOOK-C3 — Uppercase 3 roles · oleada 2 (ficha + Mercado + satélites)

**Estado:** Cerrado (orquestador 2026-09-06) · smoke `/stock/AAPL` + `/market-health`: meta sentence case; h1/h2/th/eyebrow uppercase  
**Prioridad:** P2 · deuda LOOK-C  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer 2  
**Depende:** LOOK-C2 ✅ (`04d4a0d` · screener home)  
**Tipo:** CSS (+ JSX solo si copy ALL CAPS hardcodeado) · **no scoring**

## Problema

Oleada 1 limpió `screener.css` (85→22). Siguen gritando:

| Archivo | `uppercase` hoy |
|---|---:|
| `styles/stock.css` | 29 |
| `styles/market-health.css` | 22 |
| `styles/components.css` | 44 (compartido; no reabrir home salvo selectores de ficha/Mercado) |
| `styles/ipo-radar.css` | 1 |
| `styles/lists.css` | 3 |
| `styles/review.css` | 3 |
| `styles/sectors.css` | 3 |
| `styles/research-desk.css` | 3 |
| `styles/quality-strip.css` | 1 |

## Los 3 roles (igual que LOOK-C2)

1. Cabecera de sección / eyebrow  
2. Cabecera de tabla (`th`)  
3. Micro-label de métrica grande  

Resto → sentence case; quitar tracking de label donde ya no hay uppercase.

## Alcance

### Prioridad A (obligatorio)

1. `styles/stock.css` — ficha `/stock/[symbol]` (chrome, desk, labels meta, no curva de etapa).  
2. `styles/market-health.css` — `/market-health`.

### Prioridad B (si cabe en el mismo ticket sin diluir A)

3. Satélites con pocos hits: `ipo-radar.css`, `lists.css`, `review.css`, `sectors.css`, `research-desk.css`, `quality-strip.css`.  
4. `components.css` **solo** selectores usados por ficha/Mercado que aún forzan uppercase fuera de los 3 roles — **no** deshacer contrato LOOK-C2 del home (`tests/lookCUppercaseRolesCss.test.js` debe seguir verde).

### Verificación Agent

- Inventario antes→después por archivo en el retorno.  
- Extender o añadir test CSS de contrato (patrón LOOK-C2).  
- `./vfc` tocados.  
- Smoke visual = orquestador (`/stock/AAPL` + `/market-health`).

## Fuera

- Reabrir `screener.css` (salvo bug claro de regresión C2)  
- Scoring · TAPE · Mini · familias tipográficas · LOOK alturas  
- Commit/push desde Agent

## Criterios

1. Baja material de uppercase en `stock.css` y `market-health.css`; leftovers = 3 roles o listados.  
2. Meta/hints/chrome secundario en ficha y Mercado en sentence case (medible con `getComputedStyle`).  
3. Tests LOOK-C2 home siguen pasando.  
4. Sin commit/push; plantilla de retorno.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## Inventario uppercase (antes → después)
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
