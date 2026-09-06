# READ-H — Badge de patrón legible con tarjeta de identidad desplegada

Copia de referencia. Ejecutar desde `docs/tickets/activo.md`.

**Estado:** Cerrado (orquestador 2026-09-06) · smoke `/stock/AAPL` `:3000` OK  
**Prioridad:** P3  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer (CSS + JSX mínimo)  
**Origen:** UX-READ-1 aparcado · `docs/analisis-ux-read-jerarquia-2026-09-05.md` (badge opacity + tarjeta) · inventario `docs/inventario-residuales-ux-read-2026-09-06.md`  
**Tipo:** piel/lectura chart — **no scoring**

## Problema

CHART-BADGE-2 fijó el badge «Base constructiva …» como **frase canónica de estructura** en la ficha. Con la tarjeta 2c desplegada, el badge vive en `.universalChartFloatControls` (`UniversalPriceChart.jsx`), que en desktop usa **`opacity: 0` hasta hover** del lienzo (`styles/components.css`). La frase canónica queda invisible en reposo — contradice la jerarquía de lectura de UX-READ (gráfico + badge = decisión).

En `max-width: 640px` el badge dentro de float controls tiene `display: none`: en móvil la estructura solo se lee en tarjeta/N3, no en el badge flotante.

## Alcance (hacer)

1. **Desktop:** con tarjeta de identidad visible, el badge de patrón (`.universalChartPatternBadge`) debe ser **legible sin hover** — p. ej. opacity 1 solo para el badge, o float controls siempre visibles para patrón mientras la tarjeta está desplegada; la botonera de nav puede seguir en hover si hace falta densidad.
2. **Móvil:** decidir producto mínimo — mostrar badge compacto, o documentar que en ≤640 el badge vive solo plegado/auditoría (si se mantiene oculto, copy en ticket de cierre).
3. No mover el badge al overlay actionable ni tocar gating VCP de CHART-BADGE-2.
4. Hard-reload obligatorio (JSX/CSS).
5. `./vfc` si aplica.

## Fuera de alcance

- Contenido del badge (`setupPattern`, motor VCP, umbrales)
- CHART-BADGE-2 markers vs badge
- Tarjeta 2c densidad / plegado / toggle en nav (comportamiento actual OK)
- Scoring · Mini · merge sin smoke

## Criterios de aceptación

1. `/stock/AAPL` (o valor con `setupPattern` vivo): tarjeta **desplegada**, sin hover — se lee «BASE CONSTRUCTIVA» + evidencia en el badge flotante.
2. Tarjeta **plegada**: comportamiento actual del head/float no empeora (badge sigue visible donde ya lo estaba).
3. Nav/chart interactions intactos (pan, zoom, toggle tarjeta).
4. Smoke orquestador: captura o nota de contraste en Mini `:13000` o aislado `:3300`.

## Archivos probables

- `app/UniversalPriceChart.jsx`
- `styles/components.css` (`.universalChartFloatControls`, `.universalChartPatternBadge`, media 640px)

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
