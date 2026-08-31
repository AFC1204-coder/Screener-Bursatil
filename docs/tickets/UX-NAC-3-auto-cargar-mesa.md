# UX-NAC-3 — Auto-cargar mesa sin avisos rojos ni CTA

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 (thinking si toca race loadScan / restore)  
**Origen:** dueño 2026-08-31 noche — al cambiar filtros/fichas salen avisos rojos («cargar acciones de otros países» / US todavía en mesa); pide que eso ocurra **solo**, sin botones ni esperas largas percibidas.  
**Prerreq:** UX-NAC-1/2 · UX-14 (CTA) · YIELD-1  
**Copia activa:** `docs/tickets/activo.md`

## Problema

Hoy, si la **selección de mercados** no coincide con lo **cargado en mesa**, la UI enseña `scanStaleNotice` (rojo) + botón **«Cargar datos de la selección»** (`ScreenerShell` · `marketsMisalignment`).

Eso es honesto (UX-2/UX-14) pero en uso real se siente a medio hacer: el usuario cambia ficha/filtro y recibe un semáforo de fallo en vez de que el producto complete la mesa.

## Objetivo

Experiencia **premium / seria**:

1. Ante desalineación selección ↔ mesa (cambio de mercados, preset regional, ficha hunt que implica otros mercados, restore de sesión): **disparar automáticamente** `loadScanForMarketSelection` (o el camino ya usado en UX-NAC-1), sin exigir clic.
2. Mientras carga: estado de progreso claro (copy neutro / no alarma roja de «error»).
3. El CTA «Cargar datos…» queda como **fallback** solo si el auto-load falla o el usuario cancela — no como paso obligatorio del flujo feliz.
4. No spamear avisos al cambiar filtros que **no** cambian mercados (solo criterios): ahí no debe aparecer el banner de mercados.

## Alcance

- Detectar el punto donde hoy solo se pinta `marketsMisalignment` y enganchar auto-load (con debounce / single-flight; no dobles fetches).
- Ajustar copy/estilo del notice en estado «cargando» vs «falló».
- Tests de la regla (misalignment → se invoca load; filtro sin cambio de mercados → no).
- Smoke Browser Use: US cargado → elegir Core intl / HK / Líderes intl → **sin** quedarse bloqueado en banner rojo esperando clic; mesa acaba coherente o empty honesto.

## Fuera

- Ampliar yield intl / crons (YIELD ops).
- Rediseño entero de carga «premium» (oleada posterior: latencia R-06, skeleton, etc.) — este ticket es el **gesto automático**, no toda la perf.
- VCP, scoring, MIGRATE.
- commit/push.

## Criterios de aceptación

- [ ] Cambio de selección de mercados dispara carga sola.
- [ ] Flujo feliz: usuario no necesita pulsar «Cargar datos de la selección».
- [ ] Filtros que no tocan mercados no muestran el aviso de mercados.
- [ ] Si falla la carga: aviso + CTA de reintento (único caso «rojo» aceptable).
- [ ] Smoke orquestador OK.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
