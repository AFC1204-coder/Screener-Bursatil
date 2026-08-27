# UX-5 — Rail de fichas de caza (propuesta A)

**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer · **Medium** (si el layout se atasca, Fable para decisión de UI menor)  
**Origen:** `docs/analisis-ux-filtros-ia-2026-08-27.md` · P0 cerrado (UX-4/3/2)  
**Principio:** un eje visible — «¿qué cazo?» = una ficha, no preset + bases + modo.

## Objetivo

Sustituir el flujo diario de **selector de preset / bases opcionales** por un **rail de 5 fichas de caza** en lenguaje de stage analysis. Cada ficha aplica un preset existente + orden por defecto + columnas coherentes. La línea de verdad (UX-2) debe mostrar el **nombre de la ficha**, no solo «Balanceado» interno si difiere.

## Las 5 fichas (mapear a presets actuales)

| Ficha (UI) | Preset key | Orden por defecto | Notas |
|---|---|---|---|
| **Líderes Etapa 2** | `balanced` | periodo de rendimiento activo (invariante UX-3) | Default US |
| **Cerca de pivot** | `nearPivot` | `distance52w` asc (cerca del máximo) o la sort key real de Dist. máx 52s | Columna Dist. visible |
| **Deterioro** | `weakness` | `weaknessScore` | Debe aparecer columna Deterioro (ya condicional) |
| **Líderes intl** | `intl` | periodo rendimiento / discovery | Auto-switch existente sin US → esta ficha; con US no forzar |
| **Radar IPO** | `ipo` | coherente con IPO (p. ej. perf reciente) | |

Presets restantes (`strict`, `early`, `broad`, …): **no** en el rail diario; quedan en «Bases opcionales» / configuración avanzada o un disclosure «Más criterios» — no borrarlos del catálogo.

## Alcance

### Dentro

1. **Catálogo de fichas** (helper nuevo p. ej. `lib/screenerHuntCards.js`): id, label, presetKey, defaultSort, opcional `requiresNoUs` / flags. Tests unitarios del mapa y de «ficha activa desde presetKey + markets».
2. **UI rail** en la zona principal del screener (cerca de la línea de verdad / resultados; reutilizar o sustituir `SetupChipRail` móvil si encaja). Escritorio: visible sin abrir sidebar. Una ficha activa a la vez.
3. **Al activar ficha:** `setPreset(presetKey)` + `setSort(defaultSort)` (vía invariante UX-3) + capas del preset. No reinventar umbrales.
4. **Auto-switch intl** (`shouldAutoApplyIntlFilterPreset` / restore balanced): al cambiar mercados, la ficha activa debe **reflejarse** (pasar a Líderes intl / volver a Líderes Etapa 2), no solo el preset interno.
5. **Línea de verdad:** `presetName` = label de la ficha activa (o el de `PRESETS` si no hay ficha).
6. **Hero / título:** preferir el nombre de la ficha (p. ej. «Líderes Etapa 2») en lugar de «Balanceado» opaco, o ambos con ficha como primaria.
7. Sidebar: el selector grande de preset del flujo diario deja de ser la puerta principal; «Bases opcionales» puede listar el resto.
8. Tests + sin commit ni push.

### Fuera

- UX-6 editor experto / reglas muertas.  
- UX-7 chips de vista.  
- UX-8 desglose al clic en «pasan».  
- Nuevos presets o cambiar umbrales de `balanced`/`intl`.  
- Rediseño de ficha `/stock`.

## Archivos probables

- `lib/screenerHuntCards.js` (nuevo)
- `app/components/screener/ScreenerShell.jsx`
- `app/components/screener/SetupChipRail.jsx` o componente nuevo `HuntCardRail.jsx`
- `app/page.jsx` (auto-switch ↔ ficha)
- `lib/screenerTruthLine.js` (si hace falta aceptar `huntLabel`)
- `styles/screener.css`
- tests nuevos + truth line / intl preset si aplica

## Verificación (orquestador)

1. Tests en verde.  
2. Browser Use:  
   - Arranque US → ficha **Líderes Etapa 2** + línea de verdad con ese nombre.  
   - Clic **Deterioro** → columna Deterioro visible + sort coherente.  
   - Clic **Cerca de pivot** → orden por Dist.  
   - Sin US (p. ej. CA o Core intl) → ficha **Líderes intl** (auto o manual) y filas >0.  
   - Volver EE. UU. → **Líderes Etapa 2** / Balanceado.

## Plantilla de retorno

```
## Resumen
(1–4 bullets)

## Archivos
(lista real)

## Tests
(comando + resultado)

## LO QUE NO VERIFIQUÉ
(…)

Sin commit ni push.
```
