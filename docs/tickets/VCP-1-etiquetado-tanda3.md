# VCP-1 — Etiquetado tanda 3 (research, fractal)

**Estado:** arnés cerrado 2026-09-01 · HTML `/tmp/etiquetado-tanda3.html` · **pendiente:** etiquetado dueño  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 (arnés HTML + brief)  
**Tipo:** research — **sin** tocar `lib/setupPatterns.js` ni UI producto  
**Prerrequisito:** STAGE-1 cerrado · `lib/weeklyStageStructure.js` en producto  
**Copia activa:** `docs/tickets/activo.md`

## Marco (contrato dueño)

- Bases **fractales**; lecturas **potenciales**; respuestas cortas OK.
- **Estructura vs operable:** usar subestado Weinstein (Pre-fuga / Con fuga), no solo «Etapa 2 confirmada» del MM30s.
- MSI ancla: POTENCIAL · E1 operativo / E2 código.

## Objetivo

1. Página HTML tanda 3 (gráficos sin marcas detector).
2. Brief colaborativo alineado con **STAGE-1** (`weeklyStageStructureForBars` desde `@/lib/weeklyStageStructure.js` — no duplicar candidato B).
3. Plantilla + lista símbolos listos para que el dueño etiquete.

## Alcance Agent

- Terminar `research/contracciones/arneses/build-charts.mjs` + `chart-brief.mjs`:
  - Ventana **290 sesiones** (lookback v4 + SMA150).
  - Brief: código MM30s **+** calificador Pre-fuga/Con fuga + dist techo / rng26 cuando aplique.
  - **No** inferir «primera base E2» solo por avance 6 meses diario.
- Símbolos tanda 3: `research/contracciones/tanda3-simbolos.md` (12 valores; excluir barras corruptas).
- Generar HTML → `/tmp/etiquetado-tanda3.html` (o ruta que documentes).
- Actualizar `research/contracciones/README.md` si hace falta.
- **No** corpus commit hasta que el dueño etiquete (salvo plantilla).
- **No** producto · **no** commit/push.

## Fuera

- Filtro «solo E2 estructural», setupPatterns, mesa screener.
- R7/R8/R2 en detector.

## Cierre orquestador

- [ ] HTML generado y abierto/entregado.
- [ ] Brief MSI muestra Pre-fuga coherente con ficha producto.
- [ ] Sin diff fuera de `research/contracciones/`.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests (arnés o n/a)
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
