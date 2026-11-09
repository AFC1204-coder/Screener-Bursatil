# RS global con los HK líquidos (2026-11-09)

## Problema
Solo ~76 de HK están en el universo del RS global (listas curadas de `lib/universes.js`); el RS que ve la pantalla ("RS semanal", filtro `minRsRating`) sale del motor global privado `statsedge-private-global-rs-usd-v1` (línea privada por defecto). Los otros ~690 HK líquidos (corte 5 M HKD/día, `hk-liquid-universe-2026-11-07.json`) no tienen RS y no pueden pasar un filtro que lo exija: hoy pasan 7 de 667 el preset «balanced».

## Qué es y qué NO es
El RS global es **un único ranking** (US equity investable + intl curado): ampliar HK cambia el denominador de TODAS las acciones (invariante 10 del ADR: universo versionado y estable). Por eso la ampliación es **opt-in**: `scripts/rs-global-private.mjs --hk-liquid-list=RUTA`. Sin la opción el RS global es idéntico al de hoy. La lista usada y su huella se guardan en `rs_weekly_snapshots.stats.hkLiquidList` y `universeFingerprint` (reproducible). `--dump-ranked=RUTA` vuelca el ranking sin escribir en la base (diagnóstico).

## Medición (dry-run, base del Mini, 2026-11-09; 26 s cada corrida)
| | Base | Ampliada |
|---|---|---|
| Universo | 6.437 | 7.127 (+690 HK) |
| Rankeados | 5.576 | 6.140 |
| HK rankeados | 74 | **638** (128 excluidos: 119 pocas barras, 9 discontinuas) |
- Efecto en US (4.804 comparadas): RS **+0,9 puntos de media, |Δ| ≤ 2** (3.039 suben, 125 bajan, 1.640 igual). Cruzan RS ≥70: 52 (~1 %); ≥80: 24; ≥90: 16.
- HK nuevos con RS: mediana 33,5; ≥70: 101; ≥80: 74.
- Efecto de continuidad: la serie semanal de cada símbolo tendrá un salto artificial de ≤ 2 puntos en la semana del cambio (la huella del universo cambia).

## Sin tocar (decisiones aparte)
- RS por país de HK (`rs-country-private.mjs`, motor `…-country-rs-local-hk-v1`) sigue con los curados.
- RS de tema (`rs-theme-private.mjs`) usa `intlUniverseRows`: no incluye los HK líquidos.
- La lista líquida cambia con la liquidez: para que el universo sea «estable» conviene **congelarla** (este archivo) y regenerarla a propósito (p. ej. trimestral), con nueva huella.

## Cómo se lanzaría (lo ejecuta el usuario; escribe en la base del Mini)
`~/backfill-b-2026-11-08-hk.sh` es copia de `~/backfill-b-2026-11-08.sh` con un único cambio: el paso 1/4 añade `--hk-liquid-list=research/operacion-diaria-2026-11/hk-liquid-universe-2026-11-07.json`. Túnel por Tailscale: `STATSEDGE_MINI_SSH_HOST=100.104.42.10 npm run ops:mini-tunnel:start`. El script aborta si ya hay snapshots de la fecha. Hay un backup nocturno de las 03:30 previo a las escrituras.

## Tras la escritura (comprobar)
1. `rs_weekly_items` de la semana nueva: ~6.140 rankeados en el motor global.
2. Siguiente scan HK (10:15): cuántos pasan el preset (hoy 7 de 667) y que la columna RS de HK deje de salir «–».
3. Que las series de RS de US no muestren saltos > 2 puntos.

## Resultado (2026-11-09, ~12:40 CET): RS lanzado por el usuario con HK ampliado
El usuario ejecutó `~/backfill-b-2026-11-08-hk.sh` desde la app Terminal de macOS (el chat y el panel de la app no tienen permiso de macOS sobre `Documents`), con túnel por Tailscale. Terminó con `>> FIN PARTE B`.
- Snapshot global `2026-W45` (2026-11-08): **6.140 rankeadas, 987 de exclusión, 638 HK**; huella del universo `508a2ac7…c976f`, 7.127 símbolos, y `stats.hkLiquidList` con los 690 símbolos añadidos guardados.
- Un snapshot por motor, sin duplicados: global, `statsedge-us-equity-rs-v1` (4.804), 19 de país (HK 76, curados) y 13 de tema v2.
- **Reproducibilidad:** 0 símbolos con rating distinto entre la corrida de prueba (`--dump-ranked`) y lo escrito en la base.
- **Extremo a extremo:** `/api/scans?...&markets=HK` del Mini sirve ya `weeklyRsRating` en 618 de 717 filas (semana 2026-W45): ≥70: 123, ≥80: 87.
- Incidente menor: el usuario pegó la salida del script otra vez en el prompt de zsh; todo dio `command not found`, no se re-ejecutó nada ni se crearon archivos. Y si se hubiera re-ejecutado, el script habría abortado en su comprobación de snapshots existentes.
- Pendiente: ver cuántos HK pasan el preset «balanced» en el escaneo de HK de las 10:15 del 10-nov (hoy: 7 de 667 con el RS viejo). RS por país y por tema de HK siguen con los curados (76).
