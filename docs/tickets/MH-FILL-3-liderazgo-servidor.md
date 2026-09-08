# MH-FILL-3 — Liderazgo de Mercado desde servidor

**Estado:** prep (siguiente tras STAGE-3)  
**Prioridad:** P1  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer (o CA en rama propia si polish ocupado)  
**Origen:** `docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md` · MH-FILL-3  
**Tipo:** market-health · dato en `scan_results` · falta API/UI server

## Problema

En `/market-health`, leadership pulse y tarjetas regionales salen de `localStorage` (snapshot del screener). Sin snapshot local la sección queda vacía aunque el dato exista en `scan_results`.

## Alcance (cuando se active)

1. Exponer liderazgo / amplitud regional desde API (lectura de scan vigente), no solo `localStorage`.
2. UI de Mercado consume el payload server; ausencia honesta si el nocturno no trae dato.
3. Tests + `./vfc`. Sin régimen regional nuevo (MH-FILL-5) · sin STAGE-4.

Sin commit/push hasta activación.
