# Análisis UX-IPO — superficie IPO ya cotizadas (2026-09-07)

**Estado:** Aceptado (orquestador) · retorno Fable/Grok sobre UX-IPO-1  
**Brief:** `docs/tickets/UX-IPO-1-fable-superficie-ipo.md`  
**Rama:** `codex/statsedge-ui-polish`

## Veredicto

El cohort de IPO **ya cotizadas** se lee en la **mesa principal** vía ficha del rail convertida en **lente solo por edad** (no setup). Pre-IPO (`/ipo-radar`) apartado. Default ventana **24 m**; chips 6/12/24/36.

## Hallazgo verificable (código)

`ipoDiscovery` usa `setupMode: "ipoRecent"`. Ese modo en `lib/screenerFilters.js` (≈657–680) exige, además de edad:

- contrato de lista `ipo` (`ipoScore≥45 ∨ total≥50 ∨ RS≥55` + longBias — `listRationale.js` ≈177)
- `distance52w ≥ -35`
- extensión SMA50 ≤ umbral
- momentum presente y ≥ mínimo
- **métrica ausente = no pasa**

Los «286 de 3319» no son «salidas recientes»; son IPO con sesgo largo/fuerza. Salidas &lt;3 m y bases 35–60 % bajo máximos quedan fuera.

Columna `ipoDate`/edad: **ausente** en `screenerColumns.jsx`. Empty state y merge vigiladas empujan pre-IPO (`ipoDiscoveryView.js`, `mergeIpoDiscoveryRows.js`).

## Oleadas → tickets

| ID | Prioridad | Ticket |
|---|---|---|
| IPO-UX-A | P0 | Lente cohort (preset + chips + sin merge) |
| IPO-UX-B | P0 | Columna Salida + orden + empty state |
| IPO-UX-C | P0 | Kill list (nav = **decisión dueño**, copy, categoría) |
| IPO-UX-D/E | P1 | Desde salida / ficha valor |
| IPO-UX-F | P2 | RS IPO (aparcado) |

## Decisión pendiente dueño

Nav: ¿sacar «IPO» del header, o renombrar a «Vigiladas pre-IPO»? No bloquea IPO-UX-A/B.
