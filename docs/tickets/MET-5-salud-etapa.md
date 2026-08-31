# MET-5 — Spec índice 0–100 de salud de etapa

**Rama:** `codex/statsedge-ui-polish`  
**Tipo:** solo spec / diseño — **sin código, sin schema, sin escrituras, sin UI, sin scoring de producto**  
**Modelo:** **Fable 5** (juicio metodológico). Fallback: Opus. **No** Composer para contratos vivos.  
**Origen:** decisión dueño 2026-08-27 · backlog `MET-5` · post MET-1…4b (`c46938b`)  
**Entrega:** `docs/spec-salud-etapa.md` (nombre final OK si el autor propone mejor)  
**Copia activa:** `docs/tickets/activo.md`

## Por qué ahora

RS global / país / tema + muletas de sostén (MET-4) ya existen. El dueño pidió un **índice 0–100 de salud de etapa** — ponderado, **no** un interruptor 1–4 ni un semáforo de veredicto. Las muletas son **insumo candidato**, no el índice mismo.

No implementar. Spec que el dueño acepte o rechace. Impl = **MET-5b** solo con OK explícito.

## Contratos a heredar (leer enteros)

1. `docs/spec-muletas-tendencia.md` (aceptado) — tres lecturas independientes; no fusionar MET-4 en un score sin este spec.
2. Specs MET-1/2/3 — scoring off por defecto; una definición por métrica; ausencias con motivo.
3. `docs/principios-producto.md` — clasifica, no recomienda; sin jerga de lab; 7 columnas.
4. `lib/weeklyStage.js` + auditoría etapas — etapa = precio vs media 30 + pendiente; **no** reabrir C-15 (etapa mostrada ≠ filtrada).
5. Backlog: MET-4c (vista rápida / filtro) es opcional y **paralelo**, no requisito de MET-5.
6. MET-6 (RS stress) queda fuera.

## Preguntas que el spec debe responder

1. Qué es «salud de etapa» en una frase de mesa (trader-facing) vs qué no es (setup, VCP, RS score).
2. Insumos: ¿cuáles de las tres muletas + qué más (etapa, pendiente, extensión, RS…)? Lista cerrada.
3. Ponderación / fórmula del 0–100: propuesta + cómo se documenta; alternativa rechazada (caja negra / ML).
4. Relación con `weeklyStageState` (1–4): complemento numérico, **nunca** subtítulo «Etapa 2 sana/débil» dentro del clasificador.
5. Superficie v1: ¿ficha / columna / truth / solo research? Contrato de 7 columnas.
6. Scoring de producto (`objectiveScore` / `weaknessScore` / hunt): default **NO** — ¿alguna puerta futura?
7. Cadencia: derivado en scan/ficha vs job; ¿hace falta `engine_version`?
8. Ausencias: qué pasa si falta una muleta o la etapa; motivo visible.
9. Qué NO es MET-5 (MET-4c, MET-6, VCP, semáforo).

Cada pregunta: **propuesta + alternativa rechazada** (formato MET-1…4).

## Criterios de aceptación

- [ ] Existe `docs/spec-salud-etapa.md` (o nombre acordado) con secciones del formato MET.
- [ ] Las 9 preguntas tienen propuesta + alternativa rechazada.
- [ ] No contradice MET-1…4; no mete el índice en `weeklyStage.js`; scoring off por defecto.
- [ ] Sin diff de código de producto.
- [ ] Dueño acepta o pide recorte **antes** de MET-5b.

## Fuera de alcance

Código, UI, MET-5b, MET-4c, MET-6, VCP, MIGRATE, commit/push.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
(n/a spec)
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
