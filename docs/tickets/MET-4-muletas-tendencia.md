# MET-4 — Spec muletas de tendencia

**Rama:** `codex/statsedge-ui-polish`  
**Tipo:** solo spec / diseño — **sin código, sin schema, sin escrituras, sin UI, sin scoring**  
**Modelo:** **Fable 5** (juicio metodológico). Fallback: Opus. **No** Composer para contratos vivos.  
**Origen:** decisión dueño 2026-08-27 · backlog `MET-4` · post MET-1…3 + BUG-HUNT-1b (`e90dc59`)  
**Entrega:** `docs/spec-muletas-tendencia.md` (nombre final OK si el autor propone mejor)  
**Copia activa:** `docs/tickets/activo.md`

## Por qué ahora

Ejes RS global / país / tema cerrados en producto. Siguiente capa acordada: **muletas de tendencia** (persistencia MA, aceleración, volumen) — lectura operativa de si la tendencia «aguanta», no un score compuesto. Después: MET-5 índice salud de etapa.

No implementar. Spec que el dueño acepte o rechace. Impl = **MET-4b** solo con OK explícito.

## Contratos a heredar (leer)

1. Specs MET-1/2/3 aceptados — RS ≠ lote; scoring off por defecto.
2. `docs/principios-producto.md` — verdad de mesa, sin jerga de lab en copy.
3. Stage analysis en producto (Weinstein/Minervini) — no reinventar etapa 1–4 como interruptor.
4. Backlog: MET-5 es índice 0–100 salud etapa **después** de MET-4; no fusionar ambos en un solo spec.
5. No tocar pin RS ni motores semanales salvo referencias de convivencia.

## Preguntas que el spec debe responder

1. Qué son las «muletas» (lista cerrada de señales) vs qué queda fuera (VCP, RS stress, MET-5).
2. Persistencia de medias: qué MAs, horizonte, definición de «encima / pendiente».
3. Aceleración: precio vs momentum; horizonte; ausencia de dato.
4. Volumen: qué ratio/serie; relación con up/down vol ya en filas.
5. Superficie mínima: ¿ficha / truth / columna / solo research? Etiquetas trader-facing.
6. Scoring: default **NO** — ¿alguna muleta alimenta filtros hunt o solo lectura?
7. Cadencia: ¿derivado de barras diarias en scan vs job aparte?
8. Relación con etapa semanal existente (`weeklyStage*`) — complemento, no duplicado.
9. Qué NO es MET-4.

Cada pregunta: **propuesta + alternativa rechazada** (formato MET-1/2/3).

## Criterios de aceptación

- [x] Existe `docs/spec-muletas-tendencia.md` (o nombre acordado) con secciones del formato MET.
- [x] Las 9 preguntas tienen propuesta + alternativa rechazada.
- [x] No contradice MET-1…3; no introduce scoring por defecto; no fusiona MET-5.
- [x] Sin diff de código de producto (spec).
- [x] Dueño acepta **2026-08-31** → MET-4b activo.

## Fuera de alcance

Código, schema, UI, scoring, MET-4b, MET-5, THEME-SERIES backfill, MIGRATE, commit/push.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
(n/a spec)
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
