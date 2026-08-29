# UX-16 — Líderes intl: guardrail datos ≠ mercados

## Prompt para Agent chat / Cloud Agent (copiar tal cual)

```
@docs/tickets/activo.md

Rama base: codex/statsedge-ui-polish.
Modelo: Composer 2.5 · MED–HIGH.
Cloud Agent OK (rama propia). Smoke Browser Use = orquestador.

UX-16: guardrail en ficha «Líderes intl» cuando los datos cargados no cuadran con mercados intl.
Caso H-07: solo US cargado (~3320) + ficha Líderes intl → miles de filas 🇺🇸; confuso.

Objetivo:
1) Detectar desalineación datos↔mercados (p.ej. preset intl / ficha lideres-intl activa pero lote mayoritariamente US, o mercados sidebar sin intl cargados).
2) Aviso claro en verdad/rail (no silencioso): datos cargados ≠ expectativa intl — CTA sugerido (cargar Core intl / quitar US / cambiar a Líderes E2).
3) No vaciar la tabla ni cambiar filtros a espaldas; el aviso es el producto v1.
Fuera: redefinir scoring intl; auto-fetch mercados; cambiar umbrales.

Spec: docs/analisis-ux-screener-review-2026-08-28.md H-07 / ticket UX-16.
Tests + ./vfc. Plantilla de retorno.
Cloud: commit solo en rama del agent; no merge a statsedge-ui-polish.
```

---

**Rama base:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 · MED–HIGH  
**Prioridad:** P1 rail · **Tras:** FILTERS-7  
**Spec:** `docs/analisis-ux-screener-review-2026-08-28.md` H-07  
**Cloud:** sí

## Problema

Con solo US cargado, la ficha **Líderes intl** puede mostrar miles de tickers 🇺🇸. El usuario cree ver intl; ve US bajo un preset discovery/intl.

## Objetivo

1. Detectar desalineación datos ↔ mercados / ficha.  
2. Aviso en UI + CTA honesto.  
3. Sin mutar resultados en silencio.

## Fuera

- Auto-cargar mercados. Cambiar scoring. FILTERS nuevos.

## Verificación

```bash
npm test -- intl lideres huntCard market
./vfc 'intl|lideres-intl|misalignment|guardrail'
```

## Retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin merge a codex/statsedge-ui-polish (cloud: solo rama del agent).
```
