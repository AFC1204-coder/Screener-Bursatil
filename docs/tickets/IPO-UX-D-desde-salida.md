# IPO-UX-D — Rendimiento «Desde salida» (mesa)

**Estado:** Cerrado `2a657a0` · smoke OK 2026-09-07 · residual cobertura → D2  
**Prioridad:** P1  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-ux-ipo-superficie-2026-09-07.md` · UX-IPO-1 oleada P1 «comparar entre ellas»  
**Tipo:** producto mesa — **no scoring · no motor RS IPO (F) · no CRUD `/ipo-radar`**

## Problema

Con la lente A–C se ve *quién* salió y *cuándo*, pero no se puede comparar *cómo les fue desde la salida* en la misma parrilla.

## Alcance

1. Métrica **% desde salida** (precio actual vs primer cierre usable ≥ `ipoDate`, o convención documentada en código/test).
2. Columna contextual **«Desde salida»** cuando ficha «IPO recientes» / `ipoDiscovery` (mismo patrón que Salida en B). Sortable.
3. Ausencia honesta («—» + motivo) si no hay `ipoDate` o no hay barra para anclar.
4. Preferir **dato ya en fila / serie ya disponible** al hidratar o proyectar. **No** inventar feed de pago. Si hace falta campo nuevo persistido en nocturno → **parar y reportar** (gate datos); no escribir Mini/scan a ciegas.
5. Tests + `./vfc`. Sin commit/push.

## Fuera

- IPO-UX-E (ficha `/stock` — cola aparte)  
- IPO-UX-F RS IPO / peer  
- Scoring / `ipoScore` / setup `ipoRecent`  
- Nav / chips edad / Salida (A–C)

## Criterios

1. En «IPO recientes», columna visible con % (o —) por fila.
2. Orden por esa columna cambia la mesa.
3. Sin dato → no inventar número.
4. Vitest afectados verdes.

## Residual (smoke)

Con `chartPreview` ~48 sesiones, IPOs con edad >~2 m no anclan → «—». Cobertura útil de cohort 12–24 m → **IPO-UX-D2** (persistir ancla, gate datos).
