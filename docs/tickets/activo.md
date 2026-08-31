# Ticket activo — MET-5-calibrate (muestreo umbrales)

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/tickets/MET-5-calibrate-umbrales.md
@docs/spec-salud-etapa.md

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5
Spec MET-5 aceptado (2026-08-31): solo Etapas 2/4; 1/3 diferidas a VCP.
Orquestador exige muestreo read-only ANTES de MET-5b.

Ejecuta MET-5-calibrate:
1. Script read-only con fórmula del spec (pesos 25/10/20/25/20, sat 26/10, extensión 15/50).
2. Percentiles + histogramas en Etapa 2 y 4; ejemplos con desglose.
3. Recomendación breve: ¿mantener umbrales o recortar X→Y?
Sin write de producto, sin UI, sin scoring, sin commit/push.

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
| Id | MET-5-calibrate |
| Tras esto | Dueño mira números → confirma umbrales → **MET-5b** |
| Commit/push | **Prohibido** |
