# MET-5-calibrate — Muestreo umbrales salud de etapa (read-only)

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  
**Spec:** `docs/spec-salud-etapa.md` (aceptado 2026-08-31 + addendum)  
**Tipo:** script / informe — **sin write a DB de producto, sin UI, sin scoring**

## Objetivo

Antes de congelar en MET-5b las constantes **26 / 10 semanas** y extensión **15% / 50%**, medir sobre universo real (Etapas 2 y 4) si discriminan o se apelotonan.

## Alcance

1. Script read-only (p. ej. `scripts/stage-health-calibrate.mjs`) que, sobre una muestra o el lote materializado disponible:
   - histograma / percentiles de `weeksAboveSma30w`, `weeksAboveSma10w` (o recalculo vía `trendSupport`);
   - histograma / percentiles de `|distanceSlowMaPct|` separado Etapa 2 vs 4;
   - distribución del índice propuesto (fórmula del spec) en Etapa 2 y 4;
   - 8–12 ejemplos nombrados (líderes / deterioro conocidos) con desglose.
2. Informe breve en stdout o `docs/` scratch (si escribe markdown, solo docs de informe, no producto).
3. Recomendación de 1–3 frases: ¿dejar 26/10/15/50 o sugerir recorte concreto?

## Fuera

MET-5b UI, writes Supabase de scores, cambiar `weeklyStage`, scoring, commit/push.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
