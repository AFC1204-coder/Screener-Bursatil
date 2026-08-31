# Ticket activo — UX-NAC-3

**Cola:** ~~MET-5 uso real~~ (aceptado A) · **UX-NAC-3** → VCP (1/3) · oleada carga/premium después.

Detalle: `docs/tickets/UX-NAC-3-auto-cargar-mesa.md`

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/UX-NAC-3-auto-cargar-mesa.md
@docs/tickets/activo.md

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5

Ticket UX-NAC-3: si selección de mercados ≠ mesa, auto-cargar sin obligar al CTA rojo «Cargar datos de la selección». Progreso neutro mientras carga; CTA solo si falla. Filtros que no cambian mercados no deben disparar ese aviso. Tests + smoke. Sin commit ni push.
```
