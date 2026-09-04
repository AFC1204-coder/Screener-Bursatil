# Ticket activo — SHELL-D

**Estado:** SHELL-C cerrado · **siguiente SHELL-D**  
**Último cerrado:** SHELL-C — aside = Mercados + familias de ficha; sin `advancedOpen` forzado; contadores duplicados retirados del aside  
**Base:** merge SHELL-A (`cursor/shell-a-aside-editor-685f`) + SHELL-B (`cursor/shell-b-plomeria-menu-f44f`)

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
Rama: cursor/shell-c-aside-families-62d8 (o rama SHELL-D nueva desde HEAD de SHELL-C)
Modelo: Composer

SHELL-D: laboratorio fuera del aside + ScreenerSidebar.jsx + purga CSS.
- Sacar Diagnóstico / auditoría / cobertura intl del aside (no colapsar: retirar).
- Extraer aside a ScreenerSidebar.jsx si conviene.
- Borrar CSS huérfano acumulado (advancedConfigPanel, filterArchitectureHead, etc.).
- No tocar scoring, hunt rail, VCP, settings keys, sesión v4, MIGRATE, taxonomía UX-FILTERS.
- Tests de superficies tocadas + ./vfc.
- Sin commit ni push.
```

## SHELL-C (cerrado)

- Aside primer nivel: **Mercados** + tarjetas de familia de la ficha activa (`huntCardSheetFamilyKeys`).
- Otras familias en `<details>` con «Volver a la ficha»; Régimen en otras familias.
- Retirado panel «Configuración avanzada» del aside (y sus contadores `advancedChangeCount` / `executionRuleActive`).
- `persistAdvancedOpen(true)` eliminado de ModeStrip «Abrir familia» y «Ver auditoría».

## Verificación SHELL-C

- `npx vitest run tests/screenerFiltersView.test.js tests/screenerViewportMount.test.js tests/huntCardModeDisclosure.test.js`
- `npx eslint` archivos tocados + `npm run lint`
- `./vfc` si aplica
- Smoke en página: no (este entorno no tiene sesión logueada en `:3000`)

## Qué no se tocó

Scoring, hunt rail semántica, VCP, settings keys, sesión v4, MIGRATE, `/stock`, tokens nuevos, taxonomía UX-FILTERS intensidad/−N.

## Post-MIGRATE

SHELL-D · `docs/analisis-ux-shell-aside-2026-09-03.md`
