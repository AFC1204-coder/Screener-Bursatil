# UX-FILTERS-6 — Ficha hunt declara modo + puertas

## Prompt para Agent chat / Cloud Agent (copiar tal cual)

```
@docs/tickets/activo.md

Rama base: codex/statsedge-ui-polish.
Modelo: Composer 2.5 · MED–HIGH.
Cloud Agent OK (rama propia). Smoke Browser Use = orquestador.

UX-FILTERS-6: cada ficha hunt declara su modo (discovery|strict) y un panel corto «Qué aplica esta ficha» con las puertas/familias relevantes + enlace a Abrir familia cuando exista.
filterStrictness visible como atributo de la ficha activa (no solo clave enterrada en settings).
Fuente: presets en screenerFilterCatalog + HUNT_CARDS; helper puro testeable (p.ej. huntCardModeDisclosure).
Pilot: badge/chip en rail o franja bajo rail al activar ficha; panel expandible o popover — sin rediseñar todo el screener.
Pilot Radar IPO → discovery; Deterioro/Líderes estrictos → strict; balanced/intl según catalog.

Spec: docs/analisis-ux-filters-presentacion-2026-08-28.md §2 P3, §5 FILTERS-6.
Copia: docs/tickets/UX-FILTERS-6-ficha-modo-puertas.md.
Tests + ./vfc. Plantilla de retorno.
Cloud: commit solo en rama del agent; no merge a statsedge-ui-polish.
```

---

**Rama base:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 · MED–HIGH  
**Prioridad:** P1 presentación filtros · **Tras:** FILTERS-5 (`0e69c73`)  
**Spec:** `docs/analisis-ux-filters-presentacion-2026-08-28.md` §2 P3, §5  
**Cloud:** sí

Copia: `docs/tickets/UX-FILTERS-6-ficha-modo-puertas.md`

## Problema

`filterStrictness` vive en settings pero la ficha hunt no lo declara (P3). El usuario no ve si Radar IPO es *discovery* o si Deterioro es *strict*, ni qué puertas/familias definen la ficha.

## Objetivo

1. **Modo por ficha:** helper que, dado `presetKey` / `cardId`, devuelve `{ mode: "discovery"|"strict", label, doors[] }` a partir del preset (`filterStrictness` + setup/puertas relevantes).  
2. **UI:** al activar una ficha del rail, mostrar el modo (badge o texto corto) y un control «Qué aplica» (panel/popover) listando puertas mínimas o familias clave — no volcar las 66 reglas.  
3. **Enlace:** desde una puerta/familia del panel → abrir `FilterFamilyModal` de esa familia si el cableado ya existe (`setActiveFilterFamily`); si no cabe limpio, solo texto + «Abrir en Filtros».  
4. **Piloto de copy:** al menos **Radar IPO** (discovery) y **Deterioro** o **Líderes Etapa 2** (balanced/strict según catalog). Resto de fichas con el mismo helper.  
5. Tests del helper (preset → mode + doors); smoke render opcional en tests de HuntCardRail.

## Fuera

- FILTERS-7 (migración restore). UX-13 (decisión de producto RS). Cambiar umbrales/scoring.  
- Rediseño grande del rail. Browser Use (orquestador).

## Verificación

```bash
npm test -- huntCardMode HuntCard screenerHunt filterStrictness
./vfc 'huntCard|HuntCard|filterStrictness|screenerHunt'
```

## Retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin merge a codex/statsedge-ui-polish (cloud: solo rama del agent).
```
