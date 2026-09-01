# Propuesta de auditoría — Etapa 1 vs Etapa 2 (gráfico semanal)

<!-- 2026-09-01 · origen: etiquetado MSI (tanda 3) + criterio del dueño -->
<!-- Naturaleza: diseño y medición. No toca código hasta cerrar definición. -->

## Por qué ahora

En la tanda 3, **MSI** expuso el desajuste:

- El producto (`weeklyStageForBars`) dice **«Etapa 2 confirmada»** (precio
  sobre media 30 semanas + pendiente ascendente).
- El dueño lee en **semanal** una **base larga** (aprox. 11-sep-2025 → hoy),
  casi cerrada, **sin ruptura** — es decir, **etapa 1 potencial**, no el avance
  operable que se caza con VCP en etapa 2.
- El borrador automático de `chart-brief.mjs` confundió un tramo alcista diario
  (jun–ago) con una consolidación; el patrón real del dueño es **otra escala y
  otro periodo**.

Sin cerrar esta frontera, el etiquetado VCP y el brief colaborativo seguirán
mezclando **escalas** y **fases del ciclo**.

---

## Lo que el código hace hoy

`lib/weeklyStage.js` (post-auditoría 2026-08-16) clasifica con **dos inputs**:

1. Precio vs media de 30 semanas (arriba / abajo).
2. Pendiente de esa media (ascendente / plana / descendente), con banda muerta
   `flatPct` y contexto previo para distinguir etapa 1 vs 3 cuando la media
   está plana.

**Etapa 2 confirmada** = `precio > MM30s` **y** `pendiente MM30s > flatPct`.

No entra en la clasificación:

- Ruptura de resistencia de la base.
- Sucesión de máximos y mínimos crecientes (estructura HH/HL).
- Volumen en la ruptura (Weinstein: 2× media del mes anterior, etc. —
  documentado en `docs/diseno-indicadores-mercado-2026-08-17.md` §A.2.1).
- Si el precio lleva meses **laterales bajo el techo** de una base larga aunque
  la media ya gire al alza.

La auditoría de agosto (`docs/auditoria-etapas-2026-08-16.md`) ya midió
divergencias entre implementaciones y la metodología; el refactor añadió etapas
1 y 3. **No resolvió** la pregunta operativa: *¿cuándo empezó de verdad la
etapa 2 en sentido de avance post-ruptura?*

---

## Criterio del dueño (borrador a contrastar con libros)

> Etapa 2 en semanal no es solo MM30s con pendiente al alza. Es cuando, además,
> **se han roto resistencias clave** y **se van formando sucesiones de máximos y
> mínimos crecientes**.

Traducción operativa propuesta para la auditoría:

| Dimensión | Etapa 1 (semanal) | Etapa 2 (semanal) |
|-----------|-------------------|-------------------|
| Media 30 sem | Plana o empezando a curvar | Ascendente, precio generalmente encima |
| Estructura de precio | Rango / base / techo horizontal | HH + HL tras salir del rango |
| Evento disparador | Aún dentro o en el borde del rango | **Ruptura** de resistencia clave de la base |
| Volumen | Secado en contracciones (VCP) | Expansión en ruptura (Weinstein / Minervini) |
| Lectura VCP | Bases **en formación** o pre-pivot | Bases **en avance** o reconfiguración dentro de E2 |

Esto es coherente con Weinstein (fases 1→2 en la ruptura de la base) y con el
uso Minervini/O'Neil del pivot, pero **hay que citarlo con precisión** desde
`research/books/` (PDFs locales del dueño: Weinstein, Minervini, O'Neil, etc.;
no trackeados en git).

---

## Preguntas que la auditoría debe responder

1. **Definición canónica** — ¿Qué frases literales (o parafraseo trazable) usan
   Weinstein, Minervini y O'Neil para el *inicio* de etapa 2 vs el final de
   etapa 1?
2. **Resistencia clave** — ¿Techo de la base? ¿Máximo de 52 semanas? ¿Último
   máximo semanal significativo? ¿Cómo se opera el caso **base ascendente**
   (MPC en corpus)?
3. **HH/HL** — ¿Cuántos pares mínimos hacen falta para decir «avance
   establecido»? ¿Qué pasa con reconfiguraciones (NDSN)?
4. **Gap con el código** — Sobre una muestra (p. ej. MSI, AAPL, los 12 de tanda
   3, + 20 del nocturno): ¿cuántos «Etapa 2 confirmada» del código serían E1 o
   «E2 tentativa» con el criterio del dueño?
5. **Producto** — ¿La etapa del screener cambia, o se añade un subestado
   (`stage2_structural` / `stage2_ma_only` / `pre_breakout`)? La auditoría de
   agosto advierte contra re-normalizar etapas en continuo (`spec-salud-etapa.md`).
6. **VCP** — ¿El filtro de contexto del detector v4 (pendiente MM30s) basta, o
   hace falta puerta de **ruptura + HH/HL** antes de buscar contracciones?

---

## Entregables propuestos

| # | Entregable | Tipo |
|---|------------|------|
| 1 | Tabla libro ↔ criterio ↔ medible en código | Doc |
| 2 | Muestra etiquetada a mano: 15–20 valores con veredicto dueño «E1 / E2 / dudoso» en semanal | Corpus auxiliar |
| 3 | Script read-only que compare `weeklyStage` actual vs criterio candidato | `research/contracciones/arneses/` o `scripts/` |
| 4 | Recomendación: cambiar clasificador vs añadir campo paralelo vs solo UI | ADR corto |
| 5 | Actualizar `chart-brief.mjs` para no decir «Etapa 2» sin el subestado | Tras (4) |

---

## Orden sugerido (antes de seguir etiquetando VCP)

1. **Esta auditoría** (etapa semanal).
2. Retomar etiquetado tanda 3 con brief que distinga **etapa código** vs **etapa
   operativa**.
3. Solo entonces fusionar aprendizajes al detector / screener.

---

## Caso ancla: MSI

| Lectura | Periodo | Notas |
|---------|---------|-------|
| Dueño | 2025-09-11 → 2026-08-31 | Base larga, sin ruptura; E1 potencial en semanal |
| Código | Hoy | Etapa 2 confirmada (MM30s + pendiente) |
| Brief erróneo | 2025-06-16 → 2025-08-17 | Tendencia diaria, no consolidación |

Etiqueta provisional del dueño:

```
MSI · POTENCIAL · PERIODO: 2025-09-11→2026-08-31 · base larga sin ruptura ·
contexto semanal E1, no E2 operable · jun-ago = tendencia, no es el VCP
```

---

## Relación con trabajo previo

- `docs/auditoria-etapas-2026-08-16.md` — siete implementaciones, refactor a
  cuatro etapas; no cubre ruptura ni HH/HL.
- `docs/temporalidad-contracciones-2026-08-21.md` — fractalidad; complementa
  pero no sustituye la frontera E1/E2 semanal.
- `lib/trendStructure.js` — Trend Template Minervini **aparte** de etapa Weinstein;
  no debe confundirse con la respuesta a esta auditoría.

---

## Próximo paso

Dueño confirma alcance → ticket **VCP-0** (no MET-6; ese id = RS stress) →
agente con PDFs en `research/books/` redacta §1–2 con citas → muestra MSI +
14 valores → medición → decisión de producto.
