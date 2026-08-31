# Ticket activo — MET-4b (impl muletas tendencia)

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/tickets/MET-4b-muletas-impl.md
@docs/spec-muletas-tendencia.md

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5
Spec MET-4 aceptado por dueño 2026-08-31. Implementa MET-4b.

Alcance (unidad mínima del spec):
1. Tres muletas: persistencia MA 30w/10w (contadores estrictos), aceleración
   perf3m vs tramo de perf6m (banda 5 pp), volumen upDownVolRatio (umbrales 1/1,25).
2. Superficie: solo ficha, bloque «Sostén de la tendencia» (no «muletas» en UI).
3. Sin columna, sin filtros hunt, sin scoring, sin job nuevo, sin modificar la
   clasificación en lib/weeklyStage.js (solo leer/compartir medias).
4. Ausencias con motivo. Tests (etapa intacta, scoring untouched) + ./vfc scoped.
5. Smoke visual: lo deja el orquestador.

Fuera: MET-4c, MET-5, MIGRATE, commit/push.

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
| Id | MET-4b |
| Spec | `docs/spec-muletas-tendencia.md` (aceptado 2026-08-31) |
| Modelo | Composer 2.5 |
| Rama | `codex/statsedge-ui-polish` |
| Commit/push | **Prohibido** |
