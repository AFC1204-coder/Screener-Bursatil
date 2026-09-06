# IPO-UX-C — Kill list IPO (nav, copy, categoría)

Copia. Activar tras A (puede solaparse con B si A cerrado).

**Estado:** Cola · **nav bloqueado a decisión dueño**  
**Prioridad:** P0  
**Rama:** `codex/statsedge-ui-polish`  
**Origen:** `docs/analisis-ux-ipo-superficie-2026-09-07.md`

## Alcance

1. **Nav (previo OK dueño):** sacar «IPO» del header **o** renombrar a «Vigiladas pre-IPO». `/ipo-radar` intacto.
2. Copy familia IPO generado desde regla («Cotizadas con salida ≤ N m»), no «setup IPO».
3. Retirar chip de vista «IPO categoría» de la UI de resultados (lógica `verifiedIpoCategory` puede quedar para CSV).
4. Panel «qué aplica» alineado con lente (si no quedó cerrado en A).

## Fuera

- CRUD `/ipo-radar` · scoring · RS IPO
