# Ticket activo — VCP-1

**Último cerrado:** STAGE-1 `9cc7924`  
**Nota mesa:** columna Etapa con Pre-fuga tras **próximo nocturno** (scan persistido); ficha ya OK.

Detalle: `docs/tickets/VCP-1-etiquetado-tanda3.md`

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/VCP-1-etiquetado-tanda3.md
@docs/tickets/activo.md
@lib/weeklyStageStructure.js
@lib/stageDisplay.js
@docs/auditoria-etapa1-etapa2-2026-09-01.md
@research/contracciones/tanda3-simbolos.md
@research/contracciones/arneses/build-charts.mjs
@research/contracciones/arneses/chart-brief.mjs

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5

VCP-1: cerrar arnés tanda 3 (research). build-charts + chart-brief: ventana 290s; brief usa weeklyStageStructureForBars + stageDisplay (Pre-fuga/Con fuga), no lógica vieja «Etapa 2 + avance 6m». MSI debe coincidir con ficha producto. Generar /tmp/etiquetado-tanda3.html. Solo research/contracciones/. Sin commit ni push.
```
