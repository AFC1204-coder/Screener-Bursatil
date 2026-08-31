# Ticket activo — THEME-SERIES vía B (backfill FX as-of)

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/tickets/THEME-SERIES-rs-tema.md

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5
Decisión dueño 2026-08-31: vía B estricta — backfill RS tema ≥8 weekKey
con FX por fecha de barra (pickFxObservation). Prohibido FX spot de hoy
para todo el histórico. Prohibido reabrir --as-of en rs-global-private.mjs
(excepción solo motor tema + flag --backfill-weeks o equivalente).

Inventario: 12 engines · solo 2026-W36 · faltan 7 semanas.

Ejecuta THEME-SERIES B:
1. Implementa truncado de barras a fin de semana objetivo + write por week_key.
2. Dry-run 1 theme × 1 semana; luego write del déficit (7 semanas × 12 themes).
3. Verifica readThemeRsSeriesForSymbol AAPL/MSFT/NVDA/0981.HK ≥8 weekKeys.
4. Tests del área + documenta excepción en script/backlog note.
Sin commit ni push. Fuera: MET-4b, MIGRATE, scoring, motor global --as-of.

Plantilla de retorno:
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```

---

## Meta

| Campo | Valor |
|---|---|
| Id | THEME-SERIES |
| Vía | **B estricta** (dueño OK 2026-08-31) |
| Modelo | Composer 2.5 |
| Rama | `codex/statsedge-ui-polish` |
| Commit/push | **Prohibido** |

## Decisión FX

FX **por fecha** de cada barra/semana. No FX actual sobre el pasado. Excepción MET-1 documentada; motor global sin `--as-of`.

## Cola

- MET-4 spec → pendiente OK dueño para MET-4b  
- **THEME-SERIES B** (este)  
- MIGRATE aparcado
