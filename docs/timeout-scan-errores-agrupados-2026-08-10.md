# Segunda causa del timeout al guardar el progreso: el array de errores

Fecha: 2026-08-10. BASE_SHA: `4414f74`. Rama: `codex/statsedge-ui-polish`.

Continuación de `docs/timeout-scan-universo-2026-08-09.md`. **No se ha escrito
en Supabase, no se ha tocado la RPC `scan_progress_patch`, no se ha cambiado el
encadenamiento ni el tamaño de tramo, y no se ha ejecutado ningún escaneo
real.**

---

## El síntoma

Un escaneo de "Todo el universo" (10.234 símbolos) llegó a 2.222 y falló con
"El servidor tardó demasiado en guardar el progreso del escaneo" — el mismo
timeout de Postgres del 9 de agosto, con otra causa.

El fix anterior quitó del latido de progreso los 10.234 símbolos del universo
(181 KiB): `patchScan` pasó a transmitir solo `progress` vía la RPC
`scan_progress_patch`. Pero `progress` lleva dentro el array de errores, y ese
array crecía con la corrida:

- `MAX_STORED_ERRORS = 300` entradas `{ symbol, reason, kind, status }`.
- ~160 bytes por entrada, de los cuales el campo `reason` repetía literalmente
  el mismo texto largo:
  `"Yahoo historico insuficiente · Stooq fallback sin STOOQ_API_KEY · Alpha
  Vantage sin ALPHA_VANTAGE_API_KEY"` — 110 de esos 160 bytes.
- Con el tope lleno: **~48 KiB reescritos cada 1,5-3 segundos** durante toda la
  corrida.

## El cambio

`progress.errors` deja de ser una lista de entradas por símbolo y pasa a ser
una lista de **grupos por motivo** (`lib/scanErrorGroups.js`):

```json
[{ "reason": "…", "kind": "unknown", "status": null, "count": 40, "symbols": ["…"] }]
```

- Un grupo por `(reason, kind, status)`. Los cuarenta símbolos sin histórico
  pasan de cuarenta entradas con el mismo texto a una sola.
- `MAX_SYMBOLS_PER_ERROR_GROUP = 20` ejemplos por motivo. `count` conserva el
  recuento entero del grupo aunque solo se guarden veinte símbolos.
- `MAX_STORED_ERROR_GROUPS = 25` sustituye a `MAX_STORED_ERRORS = 300`. Con
  agrupación, 300 motivos distintos ya no ocurren: los mensajes de error del
  camino del scan son plantillas fijas y ninguna lleva el símbolo dentro, así
  que la cardinalidad no crece con el universo. Inventario de plantillas
  realmente alcanzables desde el worker: ~18 de `fetchYahooChart`
  (`Yahoo chart HTTP <status>` con nueve códigos plausibles, "Yahoo historico
  insuficiente", "Sin historico Yahoo", red y parseo), 2 de `buildResearchRow`
  y ~5 de la lectura de `daily_bars` vía Supabase → 25. En la configuración
  actual (sin `STOOQ_API_KEY` ni `ALPHA_VANTAGE_API_KEY`) el sufijo de
  fallbacks es constante, así que 25 cubre el inventario entero sin truncar; en
  la corrida del incidente se veían 3-6 motivos distintos.
- **El recuento total no se pierde nunca**: el agregador cuenta siempre, aunque
  no pueda almacenar ni el símbolo (grupo lleno) ni el grupo (tope alcanzado).
  Ese total se persiste aparte en `progress.errorsTotal`, y es el que alimenta
  el contrato de completitud (`computeTerminalCompleteness`) y el contador de
  la interfaz.

## La medición

300 errores con la composición del caso real (40 símbolos sin histórico + 404s
+ 429s + "sin histórico" + fallos de red), serializados como JSON:

| | antes (lista plana) | después (grupos) | factor |
|---|---|---|---|
| solo `errors` | 48.781 B (47,6 KiB) | 1.690 B (1,7 KiB) | **28,9×** (−96,5 %) |
| objeto `progress` completo | 49.040 B (47,9 KiB) | 1.967 B (1,9 KiB) | **24,9×** (−96,0 %) |

Los 300 errores caen en 5 grupos y la suma de `count` sigue siendo 300.

## Compatibilidad

`normalizeScanErrorGroups()` acepta también el formato plano antiguo, porque
hay tres sitios donde puede aparecer: scans en curso cuando se despliegue,
filas históricas de `scans`, y sesiones del screener guardadas en
`localStorage`. Los consumidores del cliente pasan por esa función antes de
leer.

## Consumidores actualizados

- `app/page.jsx` — el polling normaliza `progress.errors` a grupos y lee
  `errorsTotal` para el contador "errores N"; `failSummary` suma `count` por
  grupo; la restauración de sesión normaliza el formato viejo.
- `lib/screenerPipeline.js` — `scanDiagnosticsSummary` expande los grupos a
  items con peso (`count`), de modo que `providerRejected` y el bloque "Datos
  proveedor" del panel de diagnóstico siguen mostrando el número real de
  símbolos afectados, no el número de motivos. El detalle de cada bloque ahora
  dice el motivo y cuántos símbolos lo comparten.
- `app/api/scan/route.js` — el progreso inicial siembra `errorsTotal: 0`.
