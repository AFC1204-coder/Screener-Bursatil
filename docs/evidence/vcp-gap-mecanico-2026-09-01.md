# VCP — gap mecánico (2026-09-01)

Corrida orquestador: `corpus-manual.json` (21) + HPE + VLO tanda 3, cortados en
`asOf` de cada caso. Detectores: `detectV4`, `setupPatternForBars` (prod),
`weeklyStageForBars`.

Rúbrica: `docs/rubrica-vcp-producto-2026-09-01.md`.

## Resumen

| Métrica | v4 | Producción |
|---------|-----|------------|
| Recall BASE (13) | **10/13** (77%) | **0/13** |
| Especificidad NO (10) | **6/10** | 10/10 |

## Hallazgos alineados con la rúbrica

1. **VLO (reconfig):** veredicto dueño BASE · etapa 2 · **v4 = no** → gap
   prioritario (reconfig / segundo episodio).
2. **Etapa 1/3:** ICE (E1) miss; DECK (E3) miss; HPE (E3) v4 BASE pero contexto
   confuso (dueño: lateral previo) → gate etapa confirma selectividad.
3. **Falsos positivos v4 en NO:** NDAQ, BEKE, ELV, MSGS → riesgo “producto cutre”
   si se publican sin gate tendencia/etapa.
4. **Producción:** no valida ningún BASE del corpus en `asOf` → desacople total
   research/producto en calibración.

## Detalle por caso

| id | sym | asOf | esp | stage | v4 | prod | nota |
|----|-----|------|-----|-------|-----|------|------|
| ICE-2026-01 | ICE | 2026-04-13 | BASE | stage1 | no | no | claro dueño, slope MM30s |
| GOOGL-2026-02 | GOOGL | 2026-04-24 | BASE | stage2 | BASE | no | OK v4 |
| PNC-2026-02 | PNC | 2026-06-08 | BASE | stage2 | BASE | no | OK v4 |
| KO-2026-02 | KO | 2026-05-13 | BASE | stage2 | BASE | no | OK v4 |
| MPC-2026-03-asc | MPC | 2026-06-02 | BASE | stage2 | BASE | no | OK v4 |
| MPC-2026-02-sierra | MPC | 2026-03-30 | NO | stage2 | no | no | OK |
| NDAQ-2025-11 | NDAQ | 2025-12-17 | NO | stage2 | **BASE** | no | FP v4 |
| V-2026-07 | V | 2026-07-24 | NO | stage1 | no | no | OK |
| ORCL-2026-04 | ORCL | 2026-05-28 | NO | stage1 | no | no | OK |
| AMT-2026-08 | AMT | 2026-08-19 | NO | stage1 | no | no | OK |
| BEKE-2026-08 | BEKE | 2026-08-19 | NO | stage1 | **BASE** | no | FP v4 |
| CPT-2026-08 | CPT | 2026-08-19 | NO | stage2 | no | no | OK |
| DECK-2026-02 | DECK | 2026-08-19 | BASE | stage3 | no | no | FN v4 · E3 |
| ELV-2026-08 | ELV | 2026-08-19 | NO | stage2 | **BASE** | no | FP v4 |
| FCX-2026-08 | FCX | 2026-08-19 | BASE | stage2 | BASE | no | OK v4 |
| FLG-2026-02 | FLG | 2026-08-19 | BASE | stage3 | BASE | no | E3 · dueño BASE |
| IP-2026-02 | IP | 2026-08-19 | BASE | stage1 | BASE | no | E1 · FP? |
| MSGS-2026-08 | MSGS | 2026-08-19 | NO | stage2 | **BASE** | no | FP v4 |
| NDSN-2026-02 | NDSN | 2026-08-19 | BASE | stage2 | BASE | no | OK v4 |
| QRVO-2026-08 | QRVO | 2026-08-19 | BASE | stage2 | BASE | no | OK v4 |
| VPG-2026-08 | VPG | 2026-08-19 | NO | stage3 | no | no | OK |
| HPE-tanda3 | HPE | 2026-04-17 | BASE | stage3 | BASE | no | dueño: lateral · v4 sí |
| VLO-tanda3 | VLO | 2026-07-07 | BASE | stage2 | **no** | no | **reconfig FN** |

## Siguiente paso

- Ticket **VCP-2-gap:** arnés reproducible + columnas reconfig + episodios múltiples.
- Ticket **VCP-2-audit (Grok):** ADR tras ≥3 etiquetas dueño más y arnés estable.
- Dueño: seguir etiquetado (MSI ancla POTENCIAL; casos etapa 2 tight).
