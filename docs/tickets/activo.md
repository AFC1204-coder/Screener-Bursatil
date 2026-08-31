# Ticket activo — MET-5 (spec salud de etapa 0–100)

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/tickets/MET-5-salud-etapa.md
@docs/spec-muletas-tendencia.md

Rama: codex/statsedge-ui-polish
Modelo: Fable 5 (juicio metodológico). Fallback Opus. No Composer para este spec.
Tipo: SOLO SPEC — sin código, sin schema, sin UI, sin scoring de producto, sin commit/push.

Escribe docs/spec-salud-etapa.md respondiendo las 9 preguntas de MET-5
(propuesta + alternativa rechazada cada una). Hereda MET-1…4 y principios-producto.
Índice 0–100 ponderado; NO interruptor 1–4; NO semáforo de veredicto;
NO modificar la clasificación en weeklyStage.js. Las muletas MET-4 son
insumo candidato, no el índice.

Alcance: spec aceptable por dueño antes de cualquier MET-5b.
Fuera: MET-4c, MET-5b, MET-6, VCP, MIGRATE, commit/push.

Plantilla de retorno:
## Resumen
## Archivos
## Tests
(n/a spec)
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```

---

## Meta

| Campo | Valor |
|---|---|
| Id | MET-5 |
| Tipo | Spec |
| Modelo | **Fable 5** |
| Rama | `codex/statsedge-ui-polish` |
| Entrega | `docs/spec-salud-etapa.md` |
| Commit/push | **Prohibido** |

## Nota

MET-4c (vista rápida / filtro de persistencia) sigue **opcional** y no bloquea MET-5.
