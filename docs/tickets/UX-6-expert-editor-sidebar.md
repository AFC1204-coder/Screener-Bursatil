# UX-6 — Sidebar: fichas como eje; editor experto sin duplicar estrategia

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-ux-producto-final-2026-08-27.md` · Día 2  
**Principio:** el **HuntCardRail** es el mando de estrategia diaria; el sidebar no ofrece un segundo “preset de caza” al mismo nivel.

## Problema

`FilterTemplatePanel` sigue mostrando «Filtro editable · Base {Balanceada|…}» y «Bases opcionales» (strict/early/broad) cerca del tope del sidebar, compitiendo con las 5 fichas del centro. La «Configuración avanzada» mezcla capas, toggles y finos sin leerse como editor experto honesto.

## Objetivo

1. **Cabeza del sidebar:** dejar de vender la base/preset como mando principal. Copy tipo «Ajustes de sesión» / «Mercados y afinado» — si se muestra el nombre interno del preset, que sea **secundario** o solo cuando la base **no** es una ficha del rail (`optionalBase` / plantilla).
2. **Bases opcionales** (`strict` / `early` / `broad` vía `optionalBasePresetEntries`): no en el primer viewport del sidebar. Moverlas **dentro** de «Configuración avanzada» (o disclosure «Más bases de filtro» debajo de mercados), con copy claro: *no sustituyen el rail; cambian umbrales*.
3. **Plantillas** («Mis plantillas»): pueden quedarse, preferible colapsadas; no subir de peso visual al rail.
4. **Editor experto (mínimo viable de este ticket):**
   - Mantener capas + condiciones + ajustes finos + auditoría, pero con jerarquía legible (p. ej. Capas → Condiciones → Finos → Auditoría).
   - No listar como controles activos reglas **claramente muertas / off-by-design** si ya están documentadas y no aplican (si el coste es alto, documentar en retorno qué quedó y ticket follow-up; no inventar umbrales nuevos).
5. Tests: bases opcionales ya no en el HTML “above the fold” del panel de plantillas (o no fuera de advanced); rail intacto.

## Alcance

### Dentro

- `lib/screenerFiltersView.jsx` (`FilterTemplatePanel`)
- `app/components/screener/ScreenerShell.jsx` (orden del sidebar: mercados vs advanced vs bases)
- CSS mínimo
- Tests existentes `screenerHuntCardRail` / panel de bases + los que haga falta
- Sin commit ni push

### Fuera

- UX-P3 (colapsar banderas) — ticket hermano; no rehacer grid salvo mover bloque.
- UX-7 chips de vista.
- Cambiar umbrales de presets / motor de filtrado.
- Borrar presets del catálogo.

## Verificación (orquestador)

1. Tests en verde.  
2. Browser Use: sidebar sin “segunda barra de caza”; fichas del centro siguen mandando; bases opcionales solo tras abrir advanced/«Más bases»; abrir advanced no rompe capas.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
