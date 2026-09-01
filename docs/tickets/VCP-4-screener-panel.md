# VCP-4 — Panel VCP en screener (criterios Minervini, sin score)

**Estado:** especificación dueño (2026-09-01 noche)  
**Depende de:** VCP-3-prod-bridge commiteado + `STATSEDGE_VCP_UNIFIED=1` en scan  
**Rama:** `codex/statsedge-ui-polish`

## Decisión de producto (dueño)

- **Una sección** en el screener para VCP / compresiones — no otra ficha de caza ni columna de «puntuación».
- Filtros por **criterios concretos** (número de contracciones, % profundidad, % al pivot, volumen seco, etapa 2…), como en la lectura Minervini (2C, 3C, tight, pre-pivot).
- **No** usar `minPatternQualityScore` ni ranking numérico de «calidad de patrón» como eje principal de esta sección.
- Etiqueta de fila: código corto Minervini (ej. `VCP 2C·PV−2%`) derivado de los mismos campos, solo lectura.

## Qué hay hoy (problema)

| Pieza | Estado |
|-------|--------|
| Motor unificado | Ficha OK con flag; lista usa scan **cacheado** hasta refrescar |
| Familia «patrón» en Más filtros | Mezcla contracciones legacy + `minPatternQualityScore` + presets que activan muchos toggles |
| Columna VCP en tabla | Retirada a propósito — volver solo con **código Minervini**, no score |

## Alcance propuesto

### 1. Sección «VCP» (familia de filtros dedicada)

Ubicación: dentro de **Más filtros** / editor de familias — **una familia `vcp`**, no duplicar la familia `pattern` genérica.

Controles (umbrales explícitos, unidades en UI):

| Control | Campo / métrica | Ejemplo default |
|---------|-----------------|-----------------|
| Solo candidato VCP (motor unificado) | `vcpCandidate === true` | off (usuario enciende) |
| Contracciones mínimas | `contractionCount` | ≥ 2 |
| Última contracción máx. | `lastContractionDepthPct` | ≤ 12 % |
| Distancia al pivot | `distanceToPivotPct` | entre −8 % y +3 % |
| Volumen seco (ratio 10/50) | `volumeDryUpRatio` | ≤ 1.0 |
| Solo etapa 2 | `requireStage2` | on en preset «VCP estricto» |
| Pre-fuga vs con fuga | `weeklyStageStructure` | opcional; no duplicar STAGE-1 en otro sitio |

**Presets dentro de la sección** (no hunt card nueva):

- **VCP Minervini** — 2C+, última tight, E2, candidato motor ON  
- **VCP en formación** — 2C+, sin exigir `vcpCandidate` (FTNT-like)  
- **Apagado** — familia `vcp` off, cero reglas

### 2. Etiqueta en tabla (una columna)

- Cabecera: **VCP** (leyenda Minervini en tooltip).
- Celda: `VCP 2C`, `VCP 2C·form`, `—`.
- Sin color de «score»; tono neutro / watch si `·form`.

Función: `lib/vcpMinerviniLabel.js` ← `contractionCount`, `vcpCandidate`, `distanceToPivotPct`, gates.

### 3. Coherencia con motor

- Filtro «candidato VCP» = `vcpCandidate` del motor unificado (no recalcular reglas a mano en UI).
- Umbrales de % filtran campos ya materializados en fila de scan.

### 4. No hacer

- `minPatternQualityScore` en esta familia.
- Ficha hunt «VCP calidad».
- Segundo indicador paralelo a `vcpReliability` en ficha (mantener auditoría ahí).

## Criterios de aceptación

- Familia VCP off por defecto al abrir screener limpio.
- Activar preset «VCP Minervini» aplica solo reglas de la tabla; no enciende RS/IPO/otras familias.
- Columna muestra código; filtrar por «≥2 contracciones» reduce filas de forma comprensible.
- Smoke: FTNT-like → `VCP 2C·form`; GOOGL golden → `VCP 2C` o candidato; NDAQ → `—`.
- Tests: label + reglas de filtro (sin E2E pesado).

## Referencias

- `lib/screenerFilterCatalog.js` (familia pattern hoy — no copiar tal cual)
- `lib/vcpEngine.mjs`, `lib/setupPatterns.js`
- `docs/rubrica-vcp-producto-2026-09-01.md`
