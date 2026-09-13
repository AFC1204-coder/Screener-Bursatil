# Ticket activo — SCANS-RS-COUNTRY-REUSE-1 (prep)

**Estado:** prep — espera aprobación dueño para lanzar Agent  
**Rama:** `codex/statsedge-ui-polish`  
**Previo:** SCANS-RS-HYDRATE-1 ACCEPT INVESTIGATE  
**Ticket:** `docs/tickets/SCANS-RS-COUNTRY-REUSE-1.md`

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/SCANS-RS-COUNTRY-REUSE-1.md

Rama: codex/statsedge-ui-polish.
Modelo: Composer 2.5 High.

Alcance: reutilizar el mapa RS global ya cargado para US country RS en hydrateRs=1 (eliminar re-read con bulkSnapshot:false del mismo engine). Sin cambiar semántica RS. Opcional: cacheKey incluye hydrateRs si cabe en el mismo diff pequeño.

MUST NOT TOUCH: writers/motores RS, theme hydrate, nocturno, gzip, reviewSession, FILTER-ANNOTATION.

PASS: tests hydrate + identidad weeklyCountryRs* US; con túnel UP documentar before/after TTFB o conteo HTTP. Si túnel caído: patch+unit tests y declarar LO QUE NO VERIFIQUÉ (no PASS perf).

Precheck: nc -zv 127.0.0.1 15432
Tests: npx vitest run tests/scansApiRsHydrateDefer.test.js (+ nuevos)

Sin commit ni push. Devuelve plantilla de retorno del orquestador.
```
