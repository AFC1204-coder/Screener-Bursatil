# Ticket activo — VCP-0

**Cola:** ~~VCP-1~~ (pausado) · **VCP-0** → retomar VCP-1 tanda 3 → VCP-2.

Detalle: `docs/tickets/VCP-0-auditoria-etapa1-etapa2.md`  
Propuesta: `docs/auditoria-etapa1-etapa2-semanal-propuesta-2026-09-01.md`

**MSI ancla:** POTENCIAL · E1 semanal sin ruptura (no E2 cazable).

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/VCP-0-auditoria-etapa1-etapa2.md
@docs/auditoria-etapa1-etapa2-semanal-propuesta-2026-09-01.md
@docs/tickets/activo.md
@lib/weeklyStage.js
@docs/auditoria-etapas-2026-08-16.md

Rama: codex/statsedge-ui-polish
Modelo: Fable 5

Ticket VCP-0: auditoría read-only Etapa 1 vs 2 semanal. Citas desde research/books/ (PDFs locales). Tabla libro→criterio→medible; muestra 15–20 con MSI ancla; script comparación weeklyStage vs criterio candidato; ADR recomendación (clasificador vs campo paralelo vs UI). No tocar weeklyStage ni producto. Sin commit ni push.
```
