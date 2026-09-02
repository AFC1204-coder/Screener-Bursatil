# Ticket activo — CLEANUP-C-09-C-10

**Estado:** listo para Agent chat de programación  
**Rama:** `codex/statsedge-ui-polish`  
**Specs:** `docs/tickets/CLEANUP-shadow-2026-09-01.md` (C-09, C-10)

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md @docs/tickets/CLEANUP-shadow-2026-09-01.md

Rama: codex/statsedge-ui-polish
Modelo: Composer

Alcance CLEANUP P2 final:
1) C-09 — Ampliar tests de pullCloudState / fallo de nube (partir de tests/cloudSyncClientStartupRequest.test.js). Cubrir al menos un caso de fallo (respuesta no ok / configured false) sin inventar E2E de navegador.
2) C-10 — Barrido docs/ (+ ADR si aplica) de comentarios «caché 2 min» / TTL desfasado → alinear a 15 min (LATEST_SCAN_TTL_MS) o borrar nota obsoleta. No reescribir historia de análisis enteros; solo correcciones puntuales de cifras/TTL.

Fuera: scoring, nocturno, auth, UI copy.

Tests: npm test -- tests/cloudSyncClientStartupRequest.test.js (y los nuevos que crees).
Sin commit ni push. Devuelve plantilla de retorno.
```

## Cerrado (verify 2026-09-02 tarde)

| ID | Evidencia |
|----|-----------|
| C-06 + C-07 + C-08 | tests 35/35 · diff real OK · commit pendiente orquestador |
| UX-COPY-1 · C-01…C-05 | `d06010b` |

## Verificación orquestador pendiente

Smoke VCP en screener (local o Vercel logueado): columna con etiquetas tras nocturno 2026-09-02.
