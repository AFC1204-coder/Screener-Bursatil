# IPO-UX-A — Lente de cohort «IPO recientes»

Copia de referencia. Ejecutar desde `docs/tickets/activo.md`.

**Estado:** Cerrado `78b35e4` · smoke visual pendiente sesión dueño  
**Prioridad:** P0  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-ux-ipo-superficie-2026-09-07.md` · UX-IPO-1  
**Tipo:** producto mesa — **no scoring / no motor RS / no tocar CRUD `/ipo-radar`**

## Problema

La ficha «Radar IPO» (`ipoDiscovery`) no muestra el cohort por edad: `setupMode: ipoRecent` aplica puertas ocultas (contrato lista `ipo`, 52w, SMA50, momentum; ausencia = rechazo). Pre-IPO se mezcla vía `augmentIpoDiscoveryFilteredView`.

## Alcance (hacer)

1. **Preset `ipoDiscovery`:** receta tipo `intl` — `setupMode: "any"`, `filterStrictness: "discovery"`, umbrales abiertos; **sí** `requireRecentIpo: true` + `maxIpoAgeMonths: 24` (techo de ficha 36 vía chips, no 72). Liquidez de supervivencia mínima (como discovery actual), **sin** puertas de tendencia/momentum/52w del modo `ipoRecent`.
2. **Ficha hunt:** label **«IPO recientes»** (id puede seguir `radar-ipo` si evita churn; o renombrar id con compat). `defaultSort` provisional: dejar o preparar para Salida desc en B — si hace falta clave de sort nueva, stub mínimo o documentar que B la cablea.
3. **Chips de ventana** 6 / 12 / **24** / 36 m en la barra de resultados **cuando la ficha está activa**; cada chip escribe `maxIpoAgeMonths` y muestra **N** (patrón impacto UX-FILTERS-5). Chip activo = valor actual de la regla.
4. **Sin merge vigiladas** en esta lente: `augmentIpoDiscoveryFilteredView` / merge no inyecta placeholders `watch:*` cuando `presetKey === "ipoDiscovery"` (o flag de lente). Mesa = solo filas de scan con `ipoDate`.
5. **Disclosure** (UX-FILTERS-6): «lente · 1 puerta: salida ≤ N m · liquidez mínima · sin puertas de tendencia».
6. Tests: catálogo preset, huntCards label, filter-ui-regression / merge tests actualizados (sin vigiladas en vista discovery). `./vfc` si aplica.
7. Sin commit / sin push.

## Fuera de alcance

- Columna **Salida** / orden cronológico / empty state copy → **IPO-UX-B**
- Nav «IPO» / copy familia / chip categoría → **IPO-UX-C** (nav = OK dueño)
- Preset institucional `ipo` y `SETUP_MODE_DEFAULTS.ipoRecent` (siguen)
- `/ipo-radar` CRUD, scoring, RS IPO, «Desde salida»

## Criterios de aceptación

1. Activar «IPO recientes»: pasan filas con edad ≤ ventana **sin** exigir RS/momentum/52w/contrato lista `ipo`.
2. Chips 6/12/24/36 cambian `maxIpoAgeMonths` y el N / verdad se actualiza.
3. Ninguna fila «Vigilada» / `watch:` en la mesa con esta ficha.
4. Vitest afectados verdes.

## Archivos probables

- `lib/screenerFilterCatalog.js`
- `lib/screenerHuntCards.js`
- `lib/huntCardModeDisclosure.js`
- `lib/mergeIpoDiscoveryRows.js` (+ call sites)
- UI barra resultados / chips (buscar patrón hunt + filter intensity)
- `tests/screenerHuntCards.test.js`, `tests/huntCardModeDisclosure.test.js`, `tests/mergeIpoDiscoveryRows.test.js`, filter-ui-regression

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
