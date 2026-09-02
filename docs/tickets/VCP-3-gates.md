# VCP-3-gates — Verificar + calibrar selectividad (shadow)

**Estado:** Cerrado 2026-09-02 (verify orquestador · evidence + JSON corpus · sin calibrar)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer (plan Cursor; Grok OK si hace falta juicio de umbrales)  
**ADR:** `docs/adr-vcp-reconfig-selectividad-2026-09-01.md` §3–§4  
**Previo:** VCP-3-reconfig cerrado (v7) · `evaluateUnifiedVcpFromDailyBars` ya aplica `propuestaProducto = v7 ∩ G1∩G2∩G3` con `STATSEDGE_VCP_UNIFIED=1`  
**Evidencia:** `docs/evidence/vcp-3-gates-2026-09-02.md` · `research/contracciones/resultados/rubric-gap-2026-09-02.json`

## Objetivo

Cerrar el ticket de gates con **medición real**, no más UI:

1. Correr `research/contracciones/arneses/rubric-gap.mjs` (bars reales / `.env.local`).
2. Comprobar aceptación ADR:

| Caso | `propuestaProducto` esperado |
|------|------------------------------|
| NDAQ, ELV, MSGS, BEKE, HPE, MSI (y FP stage2) | **false** |
| GOOGL, PNC, KO, MPC-asc, FCX, NDSN, QRVO + VLO vcp1 (y vcp2 si aplica) | **true** donde v7 BASE y etapa/estructura OK |

3. Si falla: **solo** calibrar `DEFAULT_SHADOW_GATE_SETTINGS` / lógica G2–G3 en `lib/vcpEngine.mjs` + tests. No bajar umbrales a ciegas para recuperar recall.
4. Escribir evidencia corta: `docs/evidence/vcp-3-gates-YYYY-MM-DD.md` (tabla + JSON path del arnés).
5. Ampliar tests unitarios con los casos sintéticos/ancla que falten (MSI-like, NDAQ-like primera superficial, etc.) si el harness revela huecos.

## Fuera de alcance

- Hunt card VCP / filtrar mesa por defecto (bridge = ticket posterior).
- MIGRATE, UI screener, nocturno, cambiar `weeklyStage.js`.
- Etiquetado tanda 3 nuevo del dueño (salvo leer etiquetas ya en repo).

## Aceptación

- `npm test -- tests/vcpEngine.test.js tests/rubricGap.test.js` verde.
- Corrida rubric-gap documentada: FP listados arriba con `propuestaProducto: false`; recall de BASE stage2 usable no derrumbado vs v7 solo.
- Evidence md sin secretos.
- Sin commit ni push (programación).

## Comando harness

```bash
node --env-file=.env.local --loader ./scripts/loader.mjs \
  research/contracciones/arneses/rubric-gap.mjs
```
