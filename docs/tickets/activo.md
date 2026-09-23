# Ticket activo — SCANS-HYDRATERS-COLD-1

**Estado:** prep · listo para Agent chat  
**Rama base:** `codex/statsedge-ui-polish` @ `dadcba1`  
**Rama trabajo:** `cursor/hydrate-rs-cold-a41e`  
**Modelo:** Composer  
**Ticket:** `docs/tickets/SCANS-HYDRATERS-COLD-1.md`

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/SCANS-HYDRATERS-COLD-1.md
@docs/tickets/activo.md

Eres programación StatsEdge (NO orquestador). Base polish @ dadcba1.
Rama: cursor/hydrate-rs-cold-a41e
Modelo: Composer

Ticket SCANS-HYDRATERS-COLD-1 (S–M) — cola fricción #2: residual cold
hydrateRs ~+9 s tras REUSE/BOOTSTRAP. Primer paint NO debe esperar
hydrateRs=1; recortar trabajo extended post-bootstrap o diferir más
agresivo (idle/post-paint). Medir TTFB core vs extended / delta con
research/screener-bootstrap-core-first-1 y/o wave5-remeasure (túnel
:15432). Touch: scansRsBootstrap · cloudSyncClient · page beginExtended*
(± hydrate server mínimo si el probe apunta ahí).
No FIRDS, Twelve Data, scoring, auth, semántica RS writers.

Tests: screenerBootstrapCoreFirst + cloudSyncClientStartupRequest
(+ tocados). Smoke lo hace el orquestador.

Commit+push solo en cursor/hydrate-rs-cold-a41e (+ PR draft si cloud).
SIN merge a polish. Plantilla de retorno.
```

## Notas orquestador

- Cola fricción #1 cerrado: CAZA-CHARTPREVIEW-ENTRY-1 (`dadcba1` / #52) · smoke entry POST=25.
- Tras retorno: `git diff`, tests, smoke Browser Use cold US → commit polish si OK.
- No scoring / nocturno / auth / FIRDS / Twelve Data → no gate dueño salvo sorpresa RS.
- Aparcado: D Twelve Data / Hito 1B · FIRDS on.
