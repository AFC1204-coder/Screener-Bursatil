# UX-13 — RS en Líderes Etapa 2 (opción D)

## Prompt para Agent chat / Cloud Agent (copiar tal cual)

```
@docs/tickets/activo.md

Rama base: codex/statsedge-ui-polish.
Modelo: Composer 2.5 · MED–HIGH.
Cloud Agent OK (rama propia). Smoke Browser Use = orquestador.

UX-13 opción D (aceptada): en Líderes Etapa 2 / balanced — presentación honesta de RS sin tocar el motor ni exigir weeklyRsAvailable.

1) Sort por RS: filas con RS arriba; «Sin dato» al final (tie-break estable).
2) Chip/verdad local en resultados de la ficha: `RS N/M` (pasan la ficha, no el lote entero).
3) Copy corto: RS = ranking semanal universo privado; ausencia ≠ fallo de etapa.
Fuera v1: ampliar rs_weekly; inventar RS de lote; toggle «Solo con RS» (follow-up); cambiar minRsRating del preset.

Spec: docs/tickets/UX-13-rs-lideres-opcion-d.md
También: docs/analisis-ux-screener-review-2026-08-28.md H-04.
Tests + ./vfc. Plantilla de retorno.
Cloud: commit solo en rama del agent; no merge a statsedge-ui-polish.
```

---

**Rama base:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 · MED–HIGH  
**Prioridad:** P1 presentación RS · **Tras:** FILTERS-6 (`28c472a`)  
**Spec:** `docs/tickets/UX-13-rs-lideres-opcion-d.md`  
**Cloud:** sí

## Problema

~47 % de filas que pasan Líderes Etapa 2 muestran «– Sin dato» en RS. El ranking semanal no cubre todo el lote; no ensanchamos el universo ni exigimos RS en balanced.

## Objetivo

1. Sort RS: con dato arriba; Sin dato al final.  
2. Chip `RS N/M` sobre los que pasan la ficha.  
3. Copy corto honesto (tooltip/línea).  
4. Tests del helper de conteo/orden.

## Fuera

- Opción C (ampliar ranking). RS inventado. Toggle «Solo con RS». FILTERS-7. Scoring/nocturno.

## Verificación

```bash
npm test -- weeklyRs RS lideres huntCardMode
./vfc 'weeklyRs|rsRating|Sin dato|lideres'
```

## Retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin merge a codex/statsedge-ui-polish (cloud: solo rama del agent).
```
