# VCP-3-prod-bridge — evidencia cierre (2026-09-02)

Ticket: `docs/tickets/VCP-3-prod-bridge.md` · Gates previos: [`vcp-3-gates-2026-09-02.md`](./vcp-3-gates-2026-09-02.md) · ADR: `docs/adr-vcp-reconfig-selectividad-2026-09-01.md` §5.

## Flag `STATSEDGE_VCP_UNIFIED`

| Valor | Comportamiento |
|-------|----------------|
| **OFF** (default en tests; ausente en `.env`) | `setupPatternForBars` usa la lógica legacy de seis puertas en `lib/setupPatterns.js` (`vcpCandidate` = consolidación + contracciones + volumen + profundidad base). |
| **ON** (`STATSEDGE_VCP_UNIFIED=1` en `.env.example`, GHA, Vercel) | `vcpCandidate = propuestaProducto` (v7 + G1–G3 vía `lib/vcpEngine.mjs`). |

Puente: `setupPatternForBars` → `isVcpUnifiedEnabled(options)` → `evaluateUnifiedVcpFromDailyBars`. Research reutiliza el mismo camino con `vcpUnified: true` en `rubric-gap.mjs`.

## Tests

```bash
npm test -- tests/vcpEngine.test.js tests/rubricGap.test.js
```

**Resultado (2026-09-02, con `.env.local` / Supabase):** 24/24 passed.

| Suite | Qué cubre |
|-------|-----------|
| `isVcpUnifiedEnabled` | OFF por defecto; ON con env u option |
| `setupPatternForBars unified bridge` | OFF no altera fixture mínimo; unified no deja `failed_breakout` si propone VCP |
| `legacy flag OFF (Supabase)` | Anclas golden: legacy estable; `vcpUnified: false` ≡ default; NDAQ/HPE/MSI/ELV/MSGS/BEKE → no; GOOGL/VLO → sí |
| `prod unified bridge (Supabase)` | Flag ON: `prod.vcpCandidate === shadow.propuestaProducto` en mismas anclas |
| `shadow gates corpus anchors` | Shadow G1–G3 en anclas (sin flag prod) |

**Nota corpus:** en las 23 evaluaciones primarias actuales, OFF y ON coinciden en `vcpCandidate`; el flag sigue siendo necesario para alinear producto con v7+G123 donde legacy y shadow diverjan en el futuro.

## Golden ON ≈ shadow (gates)

Alineado con [`vcp-3-gates-2026-09-02.md`](./vcp-3-gates-2026-09-02.md):

| id | propuesta / prod ON |
|----|---------------------|
| GOOGL-2026-02 | **sí** |
| VLO-tanda3::vcp1, ::vcp2 | **sí** |
| NDAQ-2025-11, HPE-tanda3, MSI-tanda3, ELV-2026-08, MSGS-2026-08, BEKE-2026-08 | **no** |

Recall shadow 8/13; especificidad NO 10/10; FP 0.

## Smoke ficha `/stock` (Browser Use, `:3310`)

Símbolos: **GOOGL**, **VLO**, **NDAQ** (hard-reload, datos cargados).

| Check | GOOGL | VLO | NDAQ |
|-------|-------|-----|------|
| Sección «Evidencia VCP» (única) | 1× h2 | 1× h2 | 1× h2 |
| Toggle gráfico «VCP» | sí | sí | sí |
| `vcpQualityProposal` / hunt card / segunda capa | no | no | no |

Sin UI VCP duplicada; labels existentes (evidencia + overlay chart).

## Riesgo scoring

- **`vcpCandidate`:** con flag ON sustituye el boolean legacy; afecta filtros screener (`requireVcpCandidate`), columna VCP-4 y `patternFamily` cuando unified propone candidato (p. ej. `failedBreakout` no bloquea si unified dice sí).
- **`breakoutQualityScore`:** suma +20 si `vcpCandidate`; puede variar al activar el flag en símbolos donde legacy ≠ shadow (no observado en corpus golden actual).
- **`patternQualityScore` / metodología:** no pasan por `vcpEngine`; sin cambio en este ticket.
- **Sin cambios** en `setupPatterns.js` / `vcpEngine.mjs` en esta verificación — solo tests + evidence.

## Conclusión

Bridge prod cerrado: motor unificado ya en HEAD; flag documentado; tests OFF/ON verdes; golden ON = shadow; smoke ficha sin segunda capa VCP. Siguiente fuera de alcance: MIGRATE-1, retirar copy «VCP estricto» vs «plan válido».
