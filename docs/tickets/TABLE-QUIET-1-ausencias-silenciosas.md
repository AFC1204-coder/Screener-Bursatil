# TABLE-QUIET-1 — Ausencias silenciosas VCP / RS tema

Copia de referencia. Ejecutar desde `docs/tickets/activo.md`.

**Estado:** Cerrado · smoke Mini 2026-09-05  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** smoke mesa US 2026-09-05 · ~30/50 VCP + ~29/50 RS tema = MissingValue con InfoHint

## Objetivo

En la tabla, ausencia *esperada* de VCP y RS tema = guion `–` sin InfoHint por fila. La leyenda de cabecera ya cubre el “por qué existe la columna”.

## Criterio

| Caso | UI |
|---|---|
| VCP sin label (`<2` contracciones) | `–` quieto |
| RS tema no available con motivo genérico | `–` quieto |
| Dato no fiable / motivo excepcional | `–` + InfoHint (igual que hoy) |
| VCP / RS tema con valor | sin cambio |

## Fuera

Motor VCP, hydrate RS, chart, Mini ops, quiet global de todas las columnas.
