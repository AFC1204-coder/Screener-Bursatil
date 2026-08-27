# INT-1-HK-AU — Materializado HK/AU usable para el selector

**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer  
**Origen:** `docs/tickets/INT-0-audit.md` §7 P1 · tras INT-1-P1/P0  
**Contexto:** Inventario universo HK ~2770 / AU ~684; último scan útil era `US,HK,AU` con **2 filas**. INT-1-P1 exige scan exacto `markets=["HK"]` / `["AU"]` y umbral ≥15 filas (`MATERIALIZED_MIN_ROWS_HK_AU`).

## Problema

1. El grupo cron `core-us-hk-au` (`lib/cronPlan.js`: limit 12, perMarket 4) mezcla US+HK+AU en **un** `settings.markets`, produce casi nada, y **no** sirve al lookup de INT-1-P1 (match exacto de conjunto).
2. US ya tiene nocturno completo (`scan-universe`); no necesita este lote mixto.
3. Al elegir solo HK/AU, la UI avisa «no hay materializado» (correcto) pero el usuario privado **quiere** poder cargar esos mercados como CA/JP.

## Objetivo

Que existan (o queden programados) scans materializados **separados** `markets=["HK"]` y `markets=["AU"]` con **≥15 filas** publicables, de modo que el preset/chip de un solo mercado cargue datos vía INT-1-P1.

## Alcance

### Dentro

1. **Cron plan**
   - Quitar HK y AU del grupo `core-us-hk-au` (dejar el grupo solo US con límite bajo **o** eliminarlo si es redundante con el nocturno US — justificar en comentario).
   - Añadir grupos dedicados, p. ej.:
     - `asia-hongkong`: `markets: ["HK"]`, `limit`/`perMarket` ≥24 (alineado a CA/JP).
     - `oceania-australia`: `markets: ["AU"]`, mismo orden de magnitud.
   - Asegurar que `materializedScanLocalId` / escritura del cron produce `settings.markets` = `["HK"]` o `["AU"]` (no mezclas).

2. **Tests**
   - `SCAN_CRON_GROUPS` contiene cohorts HK y AU separados; ningún grupo restante tiene `["US","HK","AU"]` juntos.
   - Si hay helper de rotación, cubrir que la clave nueva entra en la rotación.

3. **Opcional (si es barato):** script o nota en el ticket de cómo invocar una vez `/api/cron/scan-refresh` / job con `?markets=HK` en staging — **sin** depender de que el agente espere la noche.

4. **No** marcar HK/AU como `selectable: false` (eso sería el plan B si el dueño prefiere solo honestidad UI; este ticket busca datos).

5. Sin commit ni push.

### Fuera

- Universo HKEX/ASIC completo en una sola corrida (maxDuration 60s); lotes rotativos como CA están OK.
- Fusión multi-mercado en la UI.
- Arreglar TWSE (TW sigue no seleccionable tras P0).

## Archivos probables

- `lib/cronPlan.js`
- `app/api/cron/scan-refresh/route.js` (solo si la rotación hardcodea keys)
- tests de `cronPlan` / scan-refresh

## Verificación (orquestador)

1. Tests del ticket en verde.
2. Tras el cambio, si hay un scan HK/AU ≥15 en Supabase (cron manual o ya corrido): Browser Use preset/chip HK → tabla con ≥15 filas; si aún no hay datos, confirmar que el plan de cron es el correcto y dejar nota «pendiente primera corrida».

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
