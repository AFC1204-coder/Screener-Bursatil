# Ticket activo — MET-5b (impl salud de etapa)

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/tickets/MET-5b-salud-impl.md
@docs/spec-salud-etapa.md
@lib/trendSupport.js
@scripts/stage-health-calibrate.mjs

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5
Spec MET-5 aceptado; umbrales OK dueño: 26/10 sem · extensión 15/50%. Solo Etapas 2/4.

Ejecuta MET-5b:
1. lib/stageHealth.js (fórmula del spec; reutilizar lógica del calibrate, una sola fuente).
2. Campo stageHealthScore en scan + línea «Salud de etapa: N/100» en ficha (DescriptiveStrip) con desglose; ausencias honestas.
3. Sección metodología; tests (ejemplo 90, espejo E4, todo-o-nada, weeklyStage/scoring untouched).
4. No tocar weeklyStage.js; no scoring; no columna/filtros; no commit/push.
Smoke visual lo hace el orquestador.

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
| Id | MET-5b |
| Spec | `docs/spec-salud-etapa.md` |
| Umbrales | **26 / 10 / 15 / 50** (OK dueño) |
| Commit/push | **Prohibido** (orquestador) |
