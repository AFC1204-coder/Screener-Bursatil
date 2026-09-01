# Ticket activo — UX-COPY-1-mensajes-usuario

**Estado:** listo para Agent chat de programación  
**Spec:** `docs/tickets/UX-COPY-1-mensajes-usuario.md`  
**Rama:** `codex/statsedge-ui-polish`

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md @docs/tickets/UX-COPY-1-mensajes-usuario.md

Rama: codex/statsedge-ui-polish
Modelo: Composer (o el que prefieras para copy + tests)

Alcance: UX-COPY-1 — reescribir banners (snapshotFreshness, screenerFilterLayers auth/upgrade), setStatus ruidosos en page.jsx, etiquetas GlobalCoveragePanel. Ampliar tests/detallesInternosFuera.test.js con palabras prohibidas en UI. Sin cambiar lógica de negocio.

Tests: npm test -- tests/detallesInternosFuera.test.js tests/snapshotFreshness.test.js (y los que toques).

Sin commit ni push. Devuelve plantilla de retorno del ticket.
```

## Cola (siguiente chat)

| Orden | ID | Archivo |
|-------|-----|---------|
| 2 | C-05 | `docs/tickets/C-05-hydrate-rs-contrato.md` |
| — | C-01 | `docs/tickets/C-01-vcp-vercel-ops.md` (ops dueño, no agente) |

### Prompt C-05 (cuando UX-COPY-1 esté en verify)

```
@docs/tickets/C-05-hydrate-rs-contrato.md

Rama: codex/statsedge-ui-polish
Alcance: tests de contrato hydrateRs core vs extended + call sites cliente con hydrateRs=1 en mesa.
Tests: npm test -- tests/scansRsHydration.test.js tests/cloudSyncClientStartupRequest.test.js tests/scansApiRsHydrateDefer.test.js
Sin commit ni push.
```

## Cerrado recientemente (orquestador)

- C-02 auth banner · C-03 filter layers notice · C-04 familyIntensity en restoreSnapshot (`946e7d0`)

## Para el dueño (ops, no agente)

C-01 VCP: ver `docs/tickets/C-01-vcp-vercel-ops.md`
