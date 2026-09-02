# El arranque filtra sobre el universo completo — 2026-08-17

<!-- fecha interna: 2026-08-17 · BASE_SHA: 6e2397e · rama: codex/statsedge-ui-polish -->

Continuación de `docs/timeout-arranque-2026-08-13.md`, que puso el tope de
500 filas, y de `docs/analisis-friccion-2026-08-15.md`, que midió el arranque.
Todas las cifras de aquí son **medidas** el 17 de agosto de 2026 contra
producción (lecturas de solo lectura) y contra `next dev` local. Ninguna
escritura en Supabase, ningún escaneo lanzado.

## 1 — El problema, en una línea

El screener decía «Se muestran 500 de 3313 acciones de este escaneo». El
recorte iba por `rank_index`, que ordena por puntuación, así que el usuario
filtraba sobre la mejor sexta parte del universo. Medido: entre las 1.000
primeras filas por `rank_index` hay **0 valores en etapa 4 y 0 débiles**; en el
universo entero hay **655 y 373**. Cualquier filtro de valores débiles devolvía
vacío, y no porque no existieran.

## 2 — Lo que impedía arreglarlo subiendo el número

**PostgREST no devuelve más de 1.000 filas por respuesta**, diga lo que diga el
`limit`. Comprobado contra producción y contra la propia ruta:

| Petición | Filas que llegan | Cabecera |
|---|---|---|
| `scan_results ... limit=3400` | 1.000 | `content-range: 0-999/3312` |
| `GET /api/scans?rowsLimit=3400` | 1.000 | `rowsTruncated: true` |
| `GET /api/scans?rowsLimit=5000` | 1.000 | `rowsTruncated: true` |

Sin paginar, subir `rowsLimit` no trae ni una fila más.

## 3 — Peso y tiempo del universo entero

Lectura de las 3.312 filas del nocturno `materialized:US:2026-08-17` con el
mismo `select` que usa la ruta:

| | Filas | JSON | gzip | Tiempo |
|---|---|---|---|---|
| PostgREST, 4 páginas en serie | 3.312 | 29,4 MB | — | 4,4 s |
| PostgREST, 4 páginas en paralelo | 3.312 | 29,4 MB | 4,2 MB | 2,2-2,7 s |
| Respuesta de `/api/scans` (antes) | 500 | 8,0 MB | — | 3,8 s en frío · 0,05 s cacheada |
| Respuesta de `/api/scans` (ahora) | 3.312 | 26,2 MB | ~2,7 MB | 4,8 s en frío · 0,24 s cacheada |

Cada página tarda entre 0,6 y 2,7 s: muy por debajo del timeout de 8 s de
`SCANS_SUPABASE_TIMEOUT_MS`, que es **por página**, no por lectura completa.

**Por qué la respuesta crece menos que las filas (6,6× filas → 3,3× peso):** la
ruta reconstruía `decisionTrace` fila a fila al servir — 6.682 B por fila, el
**52,6%** del peso de la respuesta— justo el campo que la proyección ligera del
nocturno excluye a propósito y que la persistencia del navegador tampoco
guarda. Los consumidores lo rehacen cuando falta (`decisionTraceForRow`,
`explanationFromTrace`), así que la proyección compacta ya no lo lleva:
15.204 B/fila → 7.908 B/fila. `?full=1` y `?projection=decision` no cambian.

## 4 — El presupuesto del navegador: no cabe, y se dice

El universo entero en proyección de persistencia son del orden de **25 M de
caracteres** contra un presupuesto de **4,5 M** para `statsedge.scans.v1`. No
cabe y no hay forma de que quepa.

Lo medido tras el cambio, en navegador real: `statsedge.scans.v1` = 4.495.605
caracteres con **600 de las 3.312 filas**, elegidas como muestra repartida por
todo el ranking (`spreadSample`), con `rowsSampled: true` y una nota de
almacenamiento. Se transporta el universo (para poder filtrarlo) y se guarda
una muestra sin sesgo (para tener respaldo local honesto). El aviso de la
pantalla lo dice cuando se restaura esa copia.

## 5 — El recorte, si vuelve a existir, no va por puntuación

Hoy no hay recorte: 3.312 filas caben en el tope de 6.000. Si un escaneo futuro
lo supera, `scanResultPageOffsets` reparte las páginas por todo el rango del
ranking (muestreo sistemático) en vez de coger las primeras. Comprobado contra
producción pidiendo 2.000 de 3.312:

```
filas=2000 rowsAvailable=3312 truncado=true muestreado=true
etapas: Stage 2 922 · Base/transición 665 · Stage 4 242 · Débil/mixta 169
```

Con el criterio anterior, esas 242 de etapa 4 y 169 débiles habrían sido 0.
El aviso distingue los dos casos con su motivo (`lib/snapshotFreshness.js`).

## 6 — Dos defectos que la medición destapó por el camino

**6.1 — El 34% de las filas perdía su RS semanal.** `readGlobalRsForSymbols`
pedía lotes de 50 símbolos × 60 filas históricas = 3.000 filas; PostgREST
devolvía 1.000, que cubrían 33 símbolos. Los otros 17 quedaban marcados como
«no está en el ranking semanal» sin estarlo. Medido en un lote real: 1.000
filas, 33 de 50 símbolos cubiertos.

Además los lotes iban en serie: 67 peticiones seguidas para el universo, 14,7 s.

Ahora la lectura arranca por el último snapshot semanal completo (6 peticiones
paralelas, 4.868 filas, 419 ms) y solo cae al camino por símbolo para los que
no estén en él. Ningún símbolo puede tener una fila más nueva que la fecha del
último snapshot, así que la fila que se elige es la misma que antes. Resultado
en la respuesta real: **RS disponible en 3.238 de 3.312 filas (97,8%)** frente
al **66,5%** de antes.

**6.2 — El screener filtraba, de hecho, sobre 41 filas.**
`qualityGateForResearchRow` exige 180 barras diarias (`chartBarsCount`) antes de
aplicar ninguna regla, y la proyección ligera **no incluía ese campo**: de las
3.312 filas servidas, solo 41 lo llevaban —las que ya habían pasado el preset
del nocturno—. Todas las demás se caían con «histórico 0/180». Es decir: el
universo llegaba y el filtro lo tiraba.

Dos correcciones, porque hay dos poblaciones:
- `chartBarsCount` entra en la proyección ligera → los escaneos NUEVOS lo
  llevan y la puerta lo comprueba de verdad.
- Para las filas ligeras ya guardadas, la puerta acepta la ausencia del campo
  apoyándose en la garantía del productor: `baseRejectReason`
  (`lib/materializedScanner.js`) descarta el símbolo con «histórico
  insuficiente <180» **antes** de que pueda convertirse en fila ligera, con el
  mismo umbral. Una fila ligera existe solo si tenía histórico suficiente. La
  excepción se aplica únicamente cuando el campo falta, nunca cuando viene con
  un valor por debajo del mínimo.

## 7 — Antes y después, en el navegador

`next dev` local, `localStorage` limpio, mismo Mac, caché de servidor caliente
en los dos casos:

| | Filas en el universo | Pasan (preset Balanceado) | Tiempo hasta la tabla | `/api/scans` | localStorage |
|---|---|---|---|---|---|
| Antes (`6e2397e`) | 500 de 3.312 (aviso de recorte) | 39 | 8,4 s | 129 ms · 8,0 MB | 3,8 MB |
| Después | 3.312 de 3.312 (sin aviso) | 44 | 8,1 s | 698 ms · 26,2 MB | 4,5 MB |

El filtro de valores débiles («Deterioro técnico», la base que existía y no
devolvía nada):

```
antes:   0 resultados de 3312 analizadas
después: 1024 resultados de 3312 analizadas (filtro aplicado en 1,27 s)
         CRMD Etapa 4 RS 25 · WLDN Etapa 4 RS 37 · AZO Etapa 4 RS 25 · FICO Etapa 4 RS 21
```

## 8 — Los valores elegidos, y por qué

- **`rowsLimit = 6.000`** (`STARTUP_ROWS_LIMIT`, `lib/cloudSyncClient.js`): el
  nocturno del 17 de agosto analizó 5.609 símbolos y guardó 3.312 filas. 6.000
  cubre el universo estadounidense incluso si TODOS los símbolos analizados
  pasaran el filtro base, y queda por debajo del techo de la caché.
- **`CACHEABLE_ROWS_LIMIT = 8.000`** (`app/api/scans/route.js`): antes eran
  5.000, dimensionados cuando el arranque pedía 500 filas. Con 6.000, el
  arranque caía fuera de la caché de 15 minutos justo en la petición más cara de
  la app.
- **Páginas de 1.000**: el techo real de PostgREST, medido, no una elección.
- **4 páginas en paralelo**: 3.312 filas son 4 páginas; más concurrencia no
  ayuda con este tamaño y abre más conexiones simultáneas contra Supabase.

## LO QUE NO HE VERIFICADO

- **Producción.** Todas las cifras de tiempo son de `next dev` en un Mac, con
  la latencia de red de esta máquina hasta Supabase. La forma del coste (una
  petición grande, cacheada 15 minutos, cuatro páginas paralelas) es la misma en
  Vercel, pero los segundos no.
- **El coste de memoria del servidor.** La caché de 15 minutos guarda ahora un
  payload de 26 MB de JSON como objetos JS. No he medido cuánta memoria ocupa
  en una función de Vercel ni si acerca el límite de la instancia.
- **Navegadores que no sean el del panel** ni dispositivos móviles: 26 MB de
  JSON parseado y 3.312 filas en estado de React pueden pesar distinto en un
  móvil. No lo he probado.
- **El efecto sobre las demás superficies** que leen `statsedge.scans.v1` (radar
  de OPVs, sectores, pulso de salud de mercado): ahora encuentran una muestra
  repartida de 600 filas donde antes había 500 filas seguidas por ranking. No he
  revisado una por una si alguna asumía que la copia local estaba ordenada o
  completa.
- **El nocturno con el campo nuevo.** `chartBarsCount` entra en la proyección
  ligera, pero no he ejecutado ningún escaneo (está prohibido en esta tarea),
  así que el primer escaneo que lo escriba será el de esta noche. Hasta
  entonces manda la excepción de `qualityGate` descrita en 6.2.
- **Si algún símbolo del ranking semanal tiene dos motores el mismo día.** La
  ruta rápida se queda con la primera fila de la fecha más reciente, igual de
  arbitrario que antes cuando había empate; en producción hoy solo hay un
  `engine_version` en el último snapshot.
