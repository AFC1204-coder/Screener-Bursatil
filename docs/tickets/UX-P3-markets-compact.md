# UX-P3 — Mercados: regiones primero; banderas colapsables

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-ux-producto-final-2026-08-27.md` · Día 2  
**Principio:** el 95 % del tiempo se opera por **bloques** (Global / EE. UU. / Core intl / Europa / Asia / HK); la rejilla de ~28 chips es personalización, no la UI por defecto.

## Problema

En `ScreenerShell` el `marketPresetBar` y el `marketGrid` de banderas están siempre expuestos; la rejilla ocupa ~200px+ y compite con el resto del sidebar.

## Objetivo

1. **Presets regionales** (`global`, `us`, `core-intl`, `europe`, `asia`, `hk`) = selector principal visible (misma lógica `marketPreset` / `isMarketPresetActive`).
2. **Cuadrícula de banderas** dentro de un `<details>` cerrado por defecto, summary p. ej.  
   `Personalizar mercados (N/M)` donde N = seleccionados, M = `MARKETS.length` (o seleccionables).
3. Comportamiento al personalizar: mismos `setMarketsAndInvalidate`, chips disabled (TW etc.) y dots de stale **sin cambiar**.
4. Si la selección **no** coincide con ningún preset regional, el summary puede indicar «personalizado» (opcional, nice-to-have).
5. Tests unitarios/render: grid no visible en HTML cerrado por defecto (`open` ausente / contenido en details); presets siguen en el DOM principal.

## Alcance

### Dentro

- Bloque `marketPanel` en `ScreenerShell.jsx` (~360–400)
- CSS (`marketGrid` dentro del disclosure)
- Tests nuevos o extensión de tests de shell/mercados
- Sin commit ni push

### Fuera

- UX-6 (bases/editor) salvo no pisar el mismo bloque.
- Cambiar listas de presets regionales o disponibilidad de mercados.
- Auto-cargar materializado (ya existe).

## Verificación (orquestador)

1. Tests en verde.  
2. Browser Use: al cargar, banderas **colapsadas**; clic Core intl / EE. UU. sigue funcionando; abrir «Personalizar…» permite toggle de un país; banner stale+CTA si aplica.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
