# Ticket activo — MET-4d (filtro persistencia MA 30s)

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/tickets/MET-4d-filtro-persistencia.md
@docs/spec-muletas-tendencia.md
@lib/screenerFilterCatalog.js
@lib/screenerFilters.js
@lib/scanLightProjection.js

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5
MIGRATE fuera.

Ejecuta MET-4d — filtro hunt persistencia:
1. minWeeksAboveSma30w sobre weeksAboveSma30w solo si weeksAboveSma30wAbove===true; neutro 0.
2. UI en familia Tendencia; sin meter en presets por defecto; scoring untouched.
3. Sin dato + umbral>0 → no pasa. Tests + sin commit/push.
Smoke lo hace el orquestador.

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
| Id | MET-4d |
| Nota | Persistencia en DB completa tras próximo nocturno; hasta entonces cobertura parcial |
| Commit/push | **Prohibido** |
