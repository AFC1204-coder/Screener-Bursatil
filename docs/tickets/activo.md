# UX-FILTERS-7 — Migración / restore compat

## Prompt para Agent chat / Cloud Agent (copiar tal cual)

```
@docs/tickets/activo.md

Rama base: codex/statsedge-ui-polish.
Modelo: Composer 2.5 · MED–HIGH.
Cloud Agent OK (rama propia). Smoke Browser Use = orquestador.

UX-FILTERS-7: migración y compat al restaurar sesión/plantillas pre-rediseño.
1) Inferencia de modo al restore (cosmética: si falla → «personalizado», nunca cambiar resultados).
2) Tests: restore sesión pre-rediseño → mismos activeSettings efectivos; plantilla guardada pre-rediseño → ídem.
3) Contrato de capas: scripts/filter-layer-contract-audit.mjs sigue pasando; v3 solo si FILTERS-2 exigió rename (hoy no forzar v3).

Spec: docs/analisis-ux-filters-presentacion-2026-08-28.md §4 y §5 FILTERS-7.
Invariantes §4: ninguna sesión v4 válida queda peor; inferencia no muta resultados.
Fuera: scoring/nocturno; cambiar umbrales; rediseño UI nuevo.
Tests + ./vfc. Plantilla de retorno.
Cloud: commit solo en rama del agent; no merge a statsedge-ui-polish.
```

---

**Rama base:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 · MED–HIGH  
**Prioridad:** P1 cierre oleada UX-FILTERS · **Tras:** UX-13 (`08c10fe`)  
**Spec:** `docs/analisis-ux-filters-presentacion-2026-08-28.md` §4–§5  
**Cloud:** sí

## Problema

Tras FILTERS-1…6, restaurar sesiones/plantillas antiguas puede desalinear el modo declarado (discovery/strict/balanced/personalizado) o romper el contrato de capas si no hay tests de restore.

## Objetivo

1. Inferencia de modo al restore (solo etiqueta; fallback «personalizado»).  
2. Tests de restore sesión + plantilla pre-rediseño → mismos settings efectivos.  
3. `filter-layer-contract-audit` verde; no inventar v3 si no hace falta.

## Fuera

- Cambiar resultados del screener. Scoring/nocturno. UI nueva de familias.

## Verificación

```bash
npm test -- restore session template filterLayer contract
./vfc 'restore|filterLayer|session|template|strictness'
```

## Retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin merge a codex/statsedge-ui-polish (cloud: solo rama del agent).
```
