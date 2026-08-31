# Ticket activo — MET-4c (muletas en vista rápida)

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/tickets/MET-4c-muletas-vista-rapida.md
@docs/spec-muletas-tendencia.md
@lib/trendSupport.js
@app/components/screener/QuickReviewModal.jsx

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5
MIGRATE fuera. MET-4c = solo vista rápida.

Ejecuta MET-4c:
1. Bloque «Sostén de la tendencia» en QuickReviewModal (mismas 3 lecturas que ficha vía buildTrendSupportLines / campos de fila).
2. Ausencias honestas; sin semáforos; sin filtro hunt; sin Salud de etapa; sin scoring; sin columna.
3. Tests + sin commit/push.
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
| Id | MET-4c |
| Fuera | Filtro persistencia · salud en modal · MIGRATE |
| Commit/push | **Prohibido** |
