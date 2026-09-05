# READ-F — Etiqueta RS (no FR) en la tarjeta de identidad

Copia de referencia. Ejecutar desde `docs/tickets/activo.md`.

**Estado:** Cerrado · smoke Mini 2026-09-05 (`docs/evidence/read-f-smoke-2026-09-05.md`)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** UX-READ-1 · dueño «menos jerga de laboratorio» · smoke AAPL tarjeta `FR 64 universo`

## Qué

En `ChartIdentityCard` el RS canónico se etiqueta **FR**. En mesa, vista rápida y `lib/rsCanonical.js` la etiqueta de producto es **RS**. Unificar a **RS**.

## Cambios

1. `app/stock/[symbol]/ChartIdentityCard.jsx` — label visible `FR` → `RS` (caption `universo` puede quedarse).
2. Tests que aserten `FR` en la tarjeta (`fichaRetiradas`, `descriptiveStrip`, identity card) → `RS`.
3. Comentarios de UI que digan «FR» al usuario → «RS». No hace falta renombrar variables internas.
4. `./vfc` en tocados.

## Fuera

- Cambiar el número / fuente (`rsUniverse`, weekly ranking)
- Overlay país/tema · READ-E
- Mini / GHA / scoring
- Renombrar mercados país `FR` (Francia)

## Criterio

AAPL: tarjeta muestra `RS 64` (o el rating vivo), no `FR`.
