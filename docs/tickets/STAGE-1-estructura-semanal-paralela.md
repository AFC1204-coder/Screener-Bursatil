# STAGE-1 — Subestado estructural semanal (screener)

**Estado:** cerrado 2026-09-01 · verify orquestador (81+ tests STAGE, MSI E2_ma_only, ficha localhost:3000)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Grok 4.6 · esfuerzo **High** (multi-archivo + copy UI) · fallback MiniMax M3  
**Tipo:** producto — pipeline + UI + tests · **Browser Use obligatorio** antes de retorno  
**Origen:** VCP-0 cerrado · ADR aceptado · `docs/auditoria-etapa1-etapa2-2026-09-01.md`  
**Bloquea:** VCP-1 tanda 3 (pausado hasta STAGE-1)  
**Copia activa:** `docs/tickets/activo.md`

## Problema

`weeklyStage.js` responde «¿precio > MM30s y pendiente al alza?». Weinstein / criterio operativo del dueño exige además **fuga del techo de la base** (+ HH/HL tras ruptura). MSI: código «Etapa 2 confirmada» pero operativamente **E1 potencial / E2_ma_only**.

Hoy el screener, ficha y vista rápida muestran solo la etapa MM → **error conceptual** en mesa y brief.

## Decisión (ADR VCP-0 — no renegociar)

| Hacer | No hacer |
|-------|----------|
| Campo **paralelo** calculado junto al scan | Cambiar `lib/weeklyStage.js` |
| Mostrar subestado en UI (columna etapa, ficha, quick review) | Cambiar `requireStage2` / `stage2RejectDetail` en v1 |
| Extraer lógica candidato B del arnés research | Nuevo filtro «E2 cazable» en v1 |
| Persistir en `metrics`/`raw` como el resto de etapa | Tocar MET-5 salud de etapa |

## Implementación

### 1. Módulo `lib/weeklyStageStructure.js`

Portar **candidato B** de `research/contracciones/arneses/etapa-codigo-vs-candidato.mjs` (mismos umbrales documentados en auditoría §3.1):

- `E2_ma_only` — código stage2 (o stage1 bajo techo) + caja 26s ≤32% sin fuga techo 52s−4
- `E2_structural` — fuga techo + HH/HL, o tendencia ancha (rng26≥50%) cerca del techo + HH/HL + stage2
- `pre_breakout` — opcional v1: fusionar en `E2_ma_only` si simplifica UI
- `n/a` — stage3/4/insufficient_history o sin datos

Exportar:

```js
weeklyStageStructureForBars(bars, { weeklyStageState }?) → {
  structure, label, resistance, resistanceDate, distResistancePct,
  rng26Pct, ruptura, hhhl, detail
}
weeklyStageStructureFields(struct) → { weeklyStageStructure, weeklyStageStructureLabel, ... }
```

Reutilizar `weeklyBarsFromDaily` de `weeklyStage.js` — **no** duplicar agregación semanal.

### 2. Pipeline

Calcular en los mismos sitios que `weeklyStageForBars`:

- `lib/materializedScanner.js`
- `lib/researchRow.js`
- `lib/trendSupport.js` (si aplica)

Añadir campos a proyección ligera: `lib/scanLightProjection.js`.

### 3. UI — una sola verdad de copy (`lib/stageDisplay.js`)

Extender (sin romper legacy):

- Columna **Etapa** screener: palabra Weinstein actual **+** calificador estructural cuando aplique.  
  Ej. MSI: **«Etapa 2»** · subtítulo o title **«Pre-fuga (MM alza, sin ruptura del techo)»** — no «Etapa 2 confirmada» a secas como única lectura.
- `E2_structural`: **«Avance»** o **«E2 con fuga»** (elige copy claro en español, documenta en comentario).
- Ficha (`DescriptiveStrip`), `QuickReviewModal`, `lib/screenerMarket.jsx` / `screenerColumns.jsx`: misma función, no strings sueltos.
- Tooltip explica: *código = ciclo MM30s; operativo = techo/fuga Weinstein*.

**Filtro «Etapa 2» del rail:** sigue mirando solo `weeklyStageState === stage2`. Opcional: tooltip en el toggle que avise que no distingue pre-fuga.

### 4. Tests

- `tests/weeklyStageStructure.test.js` — casos sintéticos + fixture MSI-like (caja bajo techo, stage2 código).
- Regresión: `weeklyStageForBars` **bit-identical** antes/después (como MET-4 muletas).
- Actualizar proyección / columnas si hace falta.
- `./vfc` o al menos tests tocados.

### 5. Smoke Browser Use

Hard-reload `:3300` o `:3000`: buscar **MSI** (o fila conocida E2_ma_only) — columna etapa muestra calificador pre-fuga, no solo «Etapa 2».

## Fuera

- `chart-brief.mjs` research (STAGE-1b opcional después, reutiliza mismo módulo).
- VCP detector / tanda 3.
- Filtro nuevo «solo E2 estructural».
- commit/push (orquestador).

## Caso ancla

MSI → `weeklyStageState=stage2`, `weeklyStageStructure=E2_ma_only`, techo ~493,57, dist ~−1,7%.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
(comando + resultado)
## Smoke
(MSI / fila E2_ma_only — qué se ve en columna etapa)
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
