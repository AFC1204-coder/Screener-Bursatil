# Ticket activo — THEME-SERIES (serie RS tema ≥8 sem)

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/tickets/THEME-SERIES-rs-tema.md

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5
Prioridad: siguiente tras MET-4 spec (54050e0). MET-4b NO — espera OK dueño del spec.

THEME-SERIES: inventariar profundidad de serie RS tema y NO hacer backfill
as-of a ciegas (MET-1 lo prohíbe; tema usa mismo FX USD).

1) Solo lectura: cuántas weekKey tema hay hoy (engines + ejemplos AAPL/MSFT + 1 intl).
2) Si el dueño aún no eligió vía A/B/C del ticket: PARA y reporta inventario + opciones.
3) Si el dueño ya eligió vía en el chat orquestador: ejecuta solo esa (dry-run→write).
4) Tests dedupe serie / lectura ficha si tocas código. Sin commit/push.

Fuera: MET-4b, scoring, MIGRATE, commit/push.

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
| Modelo | Composer 2.5 |
| Rama | `codex/statsedge-ui-polish` |
| Commit/push | **Prohibido** |

## Gate dueño (elige una)

| Vía | Qué |
|---|---|
| **A** | Solo cron hacia adelante (~8 domingos) |
| **B** | Write histórico con FX declarado (excepción MET-1; OK explícito) |
| **C** | Otra (propuesta del inventario) |

## Cola

- MET-4 spec `54050e0` → **pendiente aceptación dueño** antes de MET-4b  
- **THEME-SERIES** (este)  
- MIGRATE aparcado
