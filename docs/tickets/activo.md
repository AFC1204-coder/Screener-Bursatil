# Ticket activo — (ninguno)

**Último cerrado (arnés):** VCP-1 — HTML tanda 3 + brief STAGE-1 alineado.

**Tu turno:** abrir `/tmp/etiquetado-tanda3.html` y etiquetar (plantilla en `research/contracciones/plantilla-tanda3-vcp1.txt`).

Formato mínimo por símbolo:
```
SYM · BASE|NO|POTENCIAL · PERIODO: fecha→fecha · nota
```

**MSI ancla sugerida:**
```
MSI · POTENCIAL · PERIODO: 2025-09-11→2026-08-31 · base larga sin ruptura · semanal E1 potencial
```

**Cola:** etiquetado dueño tanda 3 → nocturno (mesa Pre-fuga) → carga/premium.

Regenerar HTML:
```bash
node --env-file=.env.local --loader ./scripts/loader.mjs \
  research/contracciones/arneses/build-charts.mjs
```
