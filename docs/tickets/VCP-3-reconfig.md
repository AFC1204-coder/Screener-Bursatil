# VCP-3-reconfig — Detector episodios + re-ancla

**Estado:** cerrado 2026-09-01 (verify: v7, VLO vcp1/vcp2 match, recall 11/13)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 · esfuerzo **High** · fallback Grok 4.6 / MiniMax M3  
**ADR:** `docs/adr-vcp-reconfig-selectividad-2026-09-01.md` (§2.4, §6)

## Objetivo

Extender el detector **research** (nuevo `v7.mjs` o evolución de `v4.mjs` — decidir en implementación) para:

1. **Cerrar episodio N** cuando el precio rompe el techo del episodio y **cierra de vuelta debajo** en ≤ X sesiones (calibrar; VLO: ruptura 18-may, stop ~26-may).
2. **Re-anclar** episodio N+1 desde el máximo **post-fallo**, no desde el techo de 140 barras de VCP1.
3. Si aparece **`reexpansion`** a mitad de secuencia: no abortar el símbolo entero; cerrar N si ya tenía ≥2 contracciones con última pata tight; reintentar ancla en barras posteriores.
4. Exigir **pata final tight** en N+1 (última ≤ 3× ATR del ancla nuevo, coherente con v4).

**Prohibido:** parche v5 `fuera_de_rango` como cierre; v6 monotonía relajada (fusiona episodios).

## Criterios de aceptación (arnés)

Ejecutar `research/contracciones/arneses/rubric-gap.mjs` contra `tanda3-gap-casos.json` + corpus:

| Caso | Resultado esperado |
|------|-------------------|
| `VLO-tanda3::vcp1` @ 2026-05-15 | **match** (regresión) |
| `VLO-tanda3::vcp2` @ 2026-07-08 | **match** (nuevo) |
| `VLO-tanda3` primary @ 2026-07-08 | puede seguir miss / n/a (bloque unido no es unidad) |
| Corpus 21 primary | no empeorar recall v4 **10/13** ni añadir FP en NO |

Integrar detector en `rubric-gap.mjs` como columna **v7** (o flag `--detector=v7`) sin tocar prod.

## Entregables

- `research/contracciones/detector/v7.mjs` (o extensión documentada de v4)
- `rubric-gap.mjs` actualizado + JSON regenerado
- Tests: VLO vcp2 match + GOOGL regresión + NDAQ sigue NO (no FP nuevo)
- Nota breve en `research/contracciones/README.md`

## No hacer

- `lib/setupPatterns.js` / pipeline scan / hunt card UI
- Commit ni push

## Verificación

```bash
npm test -- tests/rubricGap.test.js   # ampliar si hace falta

node --env-file=.env.local --loader ./scripts/loader.mjs \
  research/contracciones/arneses/rubric-gap.mjs
```
