# Ticket activo — SHELL-A

**Estado:** MIGRATE-1 aparcado por el dueño (4 sep) · **SHELL-A en curso**  
**Último cerrado:** TABLE-FIRE-1 — tabla sin solape al resize · smoke 820 `overlaps:0`  
**Siguiente (independiente):** SHELL-B — plomería plantillas/bases → ⋯

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
Rama: codex/statsedge-ui-polish (o la rama del PR SHELL-A si ya está fusionada)
Modelo: Composer / el que indique el orquestador

SHELL-B (independiente de A): plomería del aside a ⋯.
- Meter plantillas / nube / «Más bases» / Ajustes de sesión en el menú ⋯.
- Retirar FilterTemplatePanel + OptionalBasePresets + viewLayerMini del aside (retirar, no colapsar).
- No tocar scoring, hunt rail, VCP, settings keys, sesión v4, MIGRATE, ni el editor de familia de SHELL-A.
- Tests de superficies tocadas + ./vfc.
- Sin commit ni push.
```

## Gate SHELL-A (HEAD `066ffbe` → este PR)

**Hallazgo:** `FilterFamilyModal` **ya** exponía reglas de campo por familia para las **14** familias (`FILTER_FAMILY_ORDER`), no solo IPO/RS.

- Campos: `FILTER_FIELDS.filter(field => fieldLayerKeys(field).includes(layerKey))` — misma fuente que el árbol legado.
- Interruptores: `SETTING_LAYER_DEPENDENCIES` (Etapa 2 / Pulso / Volumen+ / IPO / Estructura / VCP).
- Medias semanales de etapa: ya estaban en el modal Tendencia (`stageFastWeeks` / `stageSlowWeeks` / `stageSlopeWeeks` / `stageFlatPct`).
- Intensidad / cobertura / −N siguen siendo piloto IPO+RS (UX-FILTERS-3…5). Eso no es hueco de reglas de campo.

No hizo falta completar cobertura del modal antes de retirar el árbol. Test de contrato: `FilterFamilyModal · cobertura por familia (gate SHELL-A)`.

## Verificación

- `npx vitest run tests/screenerFiltersView.test.js tests/screenerViewportMount.test.js` → 20/20.
- `npx eslint` de archivos tocados + `npm run lint` → OK.
- `./vfc` → lint OK; `npm test` de la suite completa falla en **4 tests preexistentes** ajenos a SHELL-A (`sessionStorage` en node en C-03; copy «Sesión restaurada» vs «Sesión recuperada» en P4). No tocados.
- Smoke en página: no (este entorno no tiene sesión logueada en `:3000`).

PR: `https://github.com/AFC1204-coder/Screener-Bursatil/pull/2`

## Ahora (SHELL-A)

Un solo editor: el aside pierde el árbol «Condiciones + Ajustes finos». Las medias de etapa viven solo en Tendencia. Los interruptores huérfanos viven en su familia. Queda **Resetear criterios** (⋯ / móvil).

## Qué no se toca

Scoring, hunt rail, VCP, semántica de settings, sesión v4, MIGRATE, taxonomía UX-FILTERS, tarjetas de familia, Mercados.

## Post-MIGRATE

SHELL-B (independiente) → C → D · `docs/analisis-ux-shell-aside-2026-09-03.md`
