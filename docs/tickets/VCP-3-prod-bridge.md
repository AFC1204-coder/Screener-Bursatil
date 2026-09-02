# VCP-3-prod-bridge — Cierre verify (motor unificado ya en prod)

**Estado:** Cerrado 2026-09-02 (verify orquestador · tests 24 + smoke GOOGL · sin cambio motor)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**ADR:** `docs/adr-vcp-reconfig-selectividad-2026-09-01.md` §5  
**Decisión dueño:** un solo VCP en producto; **no** segunda ficha hunt ni `vcpQualityProposal`.  
**Evidencia:** `docs/evidence/vcp-3-prod-bridge-2026-09-02.md`

## Qué ya está (no reimplementar)

- `lib/vcpEngine.mjs` — v7 + G1–G3  
- `setupPatternForBars` con `STATSEDGE_VCP_UNIFIED=1` → `vcpCandidate = propuestaProducto`  
- UI VCP-4 (columna/filtros) + flag en GHA/Vercel/`.env.example`  
- VCP-3-gates evidence 2026-09-02: shadow ≈ prod unificado (FP 0, recall 8/13)

## Objetivo de este ticket

Cerrar el bridge con **pruebas y evidencia**, rellenar huecos mínimos:

1. **Flag OFF:** tests que demuestren legacy `vcpCandidate` (comportamiento pre-unificado) no se rompe.  
2. **Flag ON:** golden alineado con shadow (GOOGL/VLO sí; NDAQ/HPE/MSI/ELV/MSGS/BEKE no) — reusar arnés / tests existentes; ampliar solo si falta un caso.  
3. **Smoke Browser Use** (ficha `/stock/…`, 2–3 símbolos): píldora/labels VCP existentes; **sin** segunda capa VCP en UI.  
4. **Evidence** `docs/evidence/vcp-3-prod-bridge-YYYY-MM-DD.md`: qué hace el flag, enlace a gates evidence, resultado smoke, nota de riesgo scoring (`breakoutQualityScore` / metodología).  
5. Si falta en README research la sección «prod = mismo motor», completar en una frase (ya hay mención — verificar).

## Fuera

- Nueva hunt card / cap de mesa / MIGRATE / nocturno nuevo.  
- Cambiar umbrales G1–G3 (ya cerrados).  
- Retirar copy «VCP estricto» vs «plan válido» (UX aparte).

## Gate dueño

Tocar `vcpCandidate` puede mover scoring colateral. Si este ticket **solo** documenta + tests + smoke sin cambiar motor: orquestador puede commit. Si cambia lógica de `setupPatterns` / scores: **no commit** hasta OK dueño.

## Aceptación

| Check | Esperado |
|-------|----------|
| Tests OFF/ON | verde |
| Golden ON | mismos sí/no que shadow (gates) |
| Smoke ficha | sin UI VCP duplicada |
| Evidence md | presente |
| Sin commit/push | programación |

Sin commit ni push.
