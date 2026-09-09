# MH-FILL-5 — Decisiones de producto (dueño 2026-09-10)

**Estado:** decisiones **confirmadas** · implementación = `docs/tickets/MH-FILL-5-regimen-regional.md`  
**Rama destino:** `codex/statsedge-ui-polish`  
**Origen:** chat orquestador · informe criterio libros G4

## Decisiones (autoridad)

1. Termómetro = **ETF líquido** del índice del mercado (no `^…`).
2. Veredictos **en paralelo** (opción A).
3. **Amplitud** = muchas acciones del nocturno por geografía; sin cobertura → ausencia. ETF ≠ amplitud.
4. Sectores SPDR = **solo US** en v1 (ampliable después).
5. Barras ETF vía stack actual; fallo → ausencia.
6. **v1 países:** **US + EU + JP + HK** (AU/CA/GB fuera).

## Mapa ETF v1 (confirmado)

| Clave | ETF |
|---|---|
| US | **SPY** |
| EU | **FEZ** |
| JP | **EWJ** |
| HK | **EWH** |

Posteriores (no v1): EWA, EWC, EWU, ACWI.

Pesos 30/30/20/10/10 del score US **no** se convierten en score mundial en v1.
