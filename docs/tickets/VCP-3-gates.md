# VCP-3-gates — G1 STAGE-1 + G2/G3 selectividad (shadow)

**Estado:** en cola — **activar tras VCP-3-reconfig** (VLO vcp2 match)  
**Rama:** `codex/statsedge-ui-polish`  
**ADR:** `docs/adr-vcp-reconfig-selectividad-2026-09-01.md` (§3, §4)

## Objetivo

Capa **shadow** (research / filtro screener, sin hunt card obligatoria aún):

- **G1:** `weeklyStage === stage2` AND `weeklyStageStructure !== 'E2_ma_only'` (STAGE-1)
- **G2:** tendencia marcada + pausa corta (umbrales a calibrar; MSI fuera, VLO episodios dentro)
- **G3:** pata tight + ATR ancla episodio (arreglar fuga NDAQ si aplica)

Medir en arnés: HPE/BEKE/MSI/NDAQ/ELV/MSGS **0 propuestas**; no perder GOOGL/PNC/KO/MPC/FCX/NDSN/QRVO + VLO vcp1.

Dump opcional en JSON: `primeraEnAtr`, `dispRatio`, flags G1–G3.

## No hacer hasta reconfig OK

Ver ticket VCP-3-reconfig.
