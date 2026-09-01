# Ticket activo — VCP-3-prod-bridge

**Último cerrado:** VCP-3-gates — shadow G1–G3 (golden OK dueño 2026-09-01).  
**Spec:** pendiente (`docs/tickets/VCP-3-prod-bridge.md` o escribir al activar)  
**ADR:** `docs/adr-vcp-reconfig-selectividad-2026-09-01.md` (§5 fases 3–4)

## Verificación VCP-3-gates ✓

- `npm test -- tests/rubricGap.test.js` → **13/13**
- shadow especificidad NO **10/10** (0 FP en anclas)
- recall E2 **8/8** propuesta; golden dueño OK
- MSI/HPE/NDAQ/ELV/MSGS/BEKE → 0 propuestas; GOOGL + VLO `::vcp1`/`::vcp2` → propuesta

## Cola

VCP-3-prod-bridge (P2): shadow → mesa (cap, retirada episodio N tras fallo, sin copiar v4 a prod).

---

## Prompt para Agent chat (copiar al activar bridge)

_Pendiente — escribir tras definir alcance mesa con dueño._
