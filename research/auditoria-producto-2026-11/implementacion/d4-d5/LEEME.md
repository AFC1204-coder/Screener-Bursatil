# D4 y D5 — velas intradía y barras corruptas en `daily_bars`

Auditoría de producto 2026-11, sección 2, filas D4 y D5. Nada de esto está comiteado.

## Qué cambia en el código

| Archivo | Cambio |
|---|---|
| `lib/marketCalendar.js` (nuevo) | Calendario de sesiones: huso, apertura y cierre por mercado (EE. UU., Hong Kong, Europa y el resto de sufijos de `lib/symbols.js`), festivos NYSE calculados por reglas (no lista a mano) y utilidades de semana. No había ningún calendario en `lib/`. |
| `lib/dailyBarsCache.js` | D4: no persiste la barra de la sesión en curso; la lectura no da por fresca una última barra escrita antes del cierre + 30 min; una barra cacheada parcial se reescribe aunque el delta diga que no cambió. D5: borrado de fechas ausentes y guard de escala. |
| `app/api/company-brief/route.js` | `freshness.priceIntraday` y `freshness.priceIntradayTime` («14:53 ET»). |
| `app/stock/[symbol]/StockClient.jsx` | Una línea: si el precio es intradía, «último 14:53 ET» en lugar de «cierre 6 nov». |
| `tests/dailyBarsSessionAndPurge.test.js` (nuevo) | 19 tests. |
| `tests/dailyBarsWriteCap.test.js`, `tests/dailyBarsAsOfReplay.test.js` | Solo el fixture de fechas: generaban barras que cruzaban «hoy» y dependían del reloj. |
| `scripts/ops/data-health-check.mjs` (nuevo) | Chequeo de salud de solo lectura (a3, a4, a6, a11). |

### Reglas elegidas

- **D4: no persistir, en vez de `partial=true`.** Guardar la vela marcada exigiría una columna nueva (migración en Supabase y en la copia local) y que todos los lectores de `daily_bars` (scoring, RS, cinta, scripts) aprendieran a ignorarla. Si no se persiste, la tabla solo contiene cierres, que es lo que ya asumen todos. El precio intradía sigue llegando al llamador en el payload en vivo; solo deja de guardarse.
- **Sesión asentada** = cierre oficial (con subasta) + 30 min en el huso del mercado: NYSE 16:00 ET, HKEX 16:10 HKT, LSE 16:35 Londres, Xetra/Euronext/SIX/Madrid/Milán 17:35 CET… Los cambios de horario de verano los resuelve `Intl`. La barra se mapea a su sesión con la convención de Yahoo (fecha UTC de la apertura), así que la barra australiana «del domingo» cuenta como la del lunes.
- **Lectura:** si la última barra cacheada tiene `updated_at` anterior al asentamiento de su sesión, la caché no es fresca (`partialLatest`) y se vuelve a pedir. En la escritura siguiente esa fila se reescribe aunque los valores coincidan, así que su `updated_at` queda después del cierre. Con `refresh-bars --stale-days=1`, las 200 filas parciales US de a6 se reescriben en el siguiente refresco de cada símbolo, sin limpieza manual.
- **D5 (1), fechas ausentes:** en cada escritura se borran las fechas cacheadas del mismo símbolo y proveedor que caen dentro de `[min, max]` de las fechas del payload (tras el tope de barras) y que el payload no trae. Las barras que el payload trae pero se descartan por un guard cuentan como presentes. Si faltan más de 12 fechas, se supone un payload truncado y no se borra nada (`absentDeleteSkipped`). El `DELETE` usa siempre una lista explícita `trade_date=in.(…)`, nunca un rango abierto.
- **D5 (2), guard de escala:** se descarta una barra si su cierre difiere ×5 o más de sus dos vecinas en el mismo sentido y su volumen es ×10 o más el de cada vecina. La serie queda marcada en memoria del proceso (24 h): la lectura no la da por fresca y la siguiente petición va con `refresh:true`, saltándose la caché en memoria del proveedor. La marca se borra tras una escritura limpia. **Limitación:** la marca no sobrevive a un reinicio del proceso, pero el nocturno siguiente vuelve a pasar el guard. Atrapa los 4 picos de VEEA y KITT 2025-10-27. **No atrapa** KITT 2026-03-10 (×4,2, por debajo de ×5), que sí entra en la limpieza.

### Cambio visible en la interfaz

En la cabecera de la ficha (N0), cuando el último precio es de una sesión todavía abierta, o de una fila guardada antes del cierre que se sirve como respaldo, el rótulo pasa de «cierre 6 nov» a «último 14:53 ET». La hora es la `regularMarketTime` del proveedor en el huso del mercado. No lo he comprobado en el navegador: abrir la ficha llama a `/api/company-brief`, y eso escribe en la caché, algo que la tarea prohibía. Las fichas ya guardadas en `company_brief_cache` (v6, como mucho 1 día) no traen el campo y siguen diciendo «cierre» hasta que caducan.

## Limpieza puntual (`limpieza.sql`)

**No se ha ejecutado.** Termina en `ROLLBACK` y hay que cambiarlo a `COMMIT` para que borre. Medido en solo lectura sobre la copia local el 2026-11-07, son **124 filas**:

- **A (107):** acciones US en días sin sesión NYSE. 101 en festivos (20 símbolos × 5 festivos, más JPM 2025-09-01) y 6 en fin de semana (barras mensuales sueltas del día 1).
- **B (18):** los picos de a3. SNOW 2026-05-25 está en los dos grupos.

Las «294» del informe incluían **213 filas de índices extranjeros y divisas** (^N225, ^FTSE, EURUSD=X…) cuyos mercados sí abrieron esos días. No son basura y no se tocan.

```
psql -h 127.0.0.1 -p 55432 -U postgres -d statsedge_local -X -f research/auditoria-producto-2026-11/implementacion/d4-d5/limpieza.sql
```

## Chequeo de salud

```
node scripts/ops/data-health-check.mjs                 # copia local 127.0.0.1:55432/statsedge_local
node scripts/ops/data-health-check.mjs --json          # salida para máquinas
node scripts/ops/data-health-check.mjs --since 2025-06-01 --scans 10 --max-a6 5
STATSEDGE_HEALTH_DATABASE_URL=postgresql://… node scripts/ops/data-health-check.mjs   # otra base
```

- **Solo lectura:** la conexión usa `default_transaction_read_only=on` y todo va dentro de `BEGIN READ ONLY … ROLLBACK`. No imprime credenciales.
- **Salida:** `0` si todo está bajo el umbral (0 por defecto), `1` si alguna comprobación lo supera y `2` si hay un error.
- **a3:** picos de una barra (>40 % y vuelta >30 %) en los símbolos del último nocturno US. La columna `guard_escala` dice si el guard nuevo la habría descartado.
- **a4:** acciones US en días sin sesión NYSE, con el calendario de `lib/marketCalendar.js`.
- **a6:** barras con `updated_at` anterior al cierre + 30 min, para EE. UU., Hong Kong y 8 mercados europeos. La regla es la misma del código.
- **a11:** cambios de `weeklyStageState` entre nocturnos consecutivos que comparten semana oficial. El nocturno del día D trae la última sesión NYSE anterior a D, y la semana oficial es la última cerrada.
- **No está instalado en el Mini ni conectado al cron.** Para conectarlo habría que añadirlo tras el nocturno en el guard y decidir los umbrales; a6 tiene ruido conocido (abajo).

### Salida del 2026-11-07 contra la copia local (código 1)

La salida completa está en `salida-salud-2026-11-07.txt`. Resumen:

- **a3, 18 (FALLA):** 4 de VEEA y 1 de KITT con `guard_escala=true`.
- **a4, 107 (FALLA):** 2025-05-26, 2025-09-01, 2026-01-19, 2026-02-16 y 2026-05-25, más 6 en fin de semana.
- **a6, 249 (FALLA):** 200 de EE. UU. (2026-11-06: 5, 08-10: 106, 07-20: 1, 06-05: 88) y 49 de Europa. Casi todas las europeas son del 27-ago, escritas entre las 17:38 y las 17:40, después de la subasta pero dentro del margen de 30 min. Probablemente estén completas, aunque la regla las cuenta (y el código las reescribirá). Además hay CLN.SW (16:46) y SWED-A.ST (16:41), que sí son intradía.
- **a11, 486 (FALLA):** pares 12→13 oct: 288, 13→14: 127, 14→15: 1, 15→16: 3 y 17→18: 67. Son nocturnos anteriores al arreglo de D1. Hay que volver a medir tras los nocturnos nuevos.
