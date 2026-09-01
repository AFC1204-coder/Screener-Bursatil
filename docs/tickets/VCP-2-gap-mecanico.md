# VCP-2 — Arnés gap mecánico (rúbrica sep 2026)

**Estado:** activo  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 · esfuerzo medio  
**Depende de:** `docs/rubrica-vcp-producto-2026-09-01.md`, gap preliminar `docs/evidence/vcp-gap-mecanico-2026-09-01.md`

## Objetivo

Arnés reproducible que evalúe **v4**, **v5** (si aplica) y **producción**
(`setupPatternForBars`) contra:

- `research/contracciones/corpus-manual.json`
- Borrador `research/contracciones/tanda3-etiquetas.md` (HPE, VLO + futuros)

En cada `asOf` del caso, reportar:

- veredicto dueño, `weeklyStageState`, v4/v5/prod
- match / miss / false positive
- **reconfig:** si el caso dueño tiene dos episodios (VLO), evaluar detección
  en fin de VCP1 y fin de VCP2 por separado (fechas dueño en notas o ampliar JSON)

## Entregables

1. `research/contracciones/arneses/rubric-gap.mjs` — CLI, salida JSON + tabla stdout
2. `research/contracciones/resultados/rubric-gap-YYYY-MM-DD.json`
3. Actualizar README contracciones con comando
4. Tests mínimos: corpus ICE miss, GOOGL hit, VLO reconfig miss documentado

## No hacer

- No tocar `lib/setupPatterns.js` ni pipeline scan
- No commit ni push

## Verificación

```bash
node --env-file=.env.local --loader ./scripts/loader.mjs \
  research/contracciones/arneses/rubric-gap.mjs
```

Comparar recall/specificidad con evidencia preliminar (v4 10/13, VLO FN).
