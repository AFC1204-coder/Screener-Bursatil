# El escaneo del universo sigue muriendo: ¿es un límite de tiempo?

Fecha: 2026-08-10. BASE_SHA: `29326dc`. Rama: `codex/statsedge-ui-polish`.

**Este documento es solo diagnóstico. No se ha modificado ningún archivo de
código, no se ha escrito en Supabase, no se ha ejecutado ningún escaneo y no
se ha hecho commit.** Todas las consultas son de solo lectura contra
producción, vía el servidor MCP `supabase_query` (PostgREST).

---

## Resumen para el dueño (sin jerga)

**La sospecha de partida —"muere siempre entre los dos y los tres minutos,
luego hay un reloj que lo corta"— no se sostiene con los datos.** Las cuatro
corridas fallidas que hay en la base duraron 19 segundos, 1 minuto y 33
segundos, 3 minutos y 55 segundos, y 3 minutos y 40 segundos. No hay ninguna
ventana de 2-3 minutos: hay corridas que mueren mucho antes y corridas que
mueren bastante después.

Lo que sí aparece, y aparece en las tres corridas que llegaron a guardar
resultados, es **otro patrón, mucho más nítido y mucho más útil**:

1. El escaneo guarda resultados con normalidad hasta el final. La última tanda
   de resultados entra en la base a un ritmo perfectamente sano.
2. Y entonces se abre **un agujero de veintitantos segundos en el que no se
   guarda absolutamente nada** — 22,8 s en una corrida, 21,3 s en otra, 54,7 s
   en la tercera.
3. Al final de ese agujero, Postgres cancela la operación y aparece el error.

O sea: no es que el escaneo se vaya frenando hasta agotar un plazo. Es que **una
operación concreta se queda colgada más de veinte segundos y la base de datos
la mata**. El escaneo aguanta hasta que le toca esa mala operación, y eso puede
pasarle a los 19 segundos o a los 4 minutos.

**¿Cuál es esa operación?** No es guardar resultados (eso iba fluido hasta el
último segundo). Es una de las dos operaciones que el escaneo hace sobre **la
ficha del escaneo** — la fila de la tabla `scans` — cada segundo y medio:
leerla entera, o reescribirla entera. Y esa ficha lleva dentro la lista
completa de los 10.000 símbolos del universo.

**Y aquí está la clave de por qué los dos arreglos anteriores ayudaron poco.**
Los dos redujeron lo que viaja *por la red*, pero ninguno redujo lo que
Postgres tiene que *leer y reescribir en disco*: cada latido de progreso sigue
reescribiendo el bloque entero con los 10.000 símbolos dentro, porque así
funciona la instrucción que usa la base (`jsonb_set` reemplaza el valor
completo, no un trocito). Por eso el escaneo llegó más lejos (de 600 a 2.222 a
2.482 símbolos) pero nunca terminó: se aliviaron los síntomas, no la causa.

Nota importante: **no he podido comprobar esto último de forma directa.** La
herramienta de consulta que tengo solo lee las tablas del producto; no me deja
mirar las estadísticas internas de Postgres (tiempos de consulta, tuplas
muertas, configuración de tiempos límite). Todo lo de esta sección es
deducción a partir de marcas de tiempo reales, no medición directa. Ver
"CONFIANZA" y "LO QUE NO HE VERIFICADO" al final.

---

## PARTE A — Todos los límites de tiempo del camino del escaneo

### A.1 Inventario

| # | Límite | Valor | Dónde | ¿Aplica al caso? |
|---|---|---|---|---|
| 1 | `maxDuration` de la ruta que lanza el escaneo | 300 s | `app/api/scan/route.js:15` | No en local (ver A.3) |
| 2 | `maxDuration` de la ruta que encadena eslabones | 300 s | `app/api/scan/continue/route.js:15` | No en local |
| 3 | Tope del INSERT que crea la fila del scan | 12.000 ms | `app/api/scan/route.js:29` | Solo al arrancar |
| 4 | Timeout por defecto de las llamadas a Supabase | **ninguno** | `lib/supabaseServer.js:51-52` | **Sí — ver A.2** |
| 5 | Lectura de la caché de barras | 1.500 ms | `lib/dailyBarsCache.js:7` | Sí, por símbolo |
| 6 | Lectura de la caché de perfiles | 1.500 ms | `lib/fundamentalsCache.js:6` | Sí, por símbolo |
| 7 | Pausa entre latidos de progreso | 1.500 ms | `lib/serverScanRunner.js:45` | Sí (cadencia) |
| 8 | Eslabón considerado muerto | 600.000 ms (10 min) | `lib/serverScanRunner.js:51` | No se alcanza |
| 9 | Sondeo del navegador | 2.000 ms | `lib/screenerConfig.js:45` | Solo la interfaz |
| 10 | Timeout de `getJson` del navegador | 0 = **ninguno** | `lib/clientApi.js:12-14` | Sin efecto |
| 11 | Timeout de las llamadas a Yahoo | **ninguno** | `lib/yahoo.js` (sin `AbortSignal`) | Sí, pero no es el fallo |
| 12 | `statement_timeout` de Postgres | **no legible** | Servidor Supabase | **Sí — es el que dispara** |

### A.2 El más importante: no hay tope en las llamadas a Supabase

`lib/supabaseServer.js:51-52`, literal:

```js
  const timeoutMs = Number(options.timeoutMs || 0);
  const signal = options.signal || (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined);
```

Si quien llama no pasa `timeoutMs`, `signal` queda `undefined` y **el fetch
espera indefinidamente**. Ninguna de las llamadas del bucle del escaneo pasa
`timeoutMs`:

- `patchScan` → `lib/serverScanRunner.js:145-150` (la RPC de progreso), sin `timeoutMs`.
- `readCancelRequested` → `lib/serverScanRunner.js:168-170`, sin `timeoutMs`.
- El INSERT de resultados → `lib/serverScanRunner.js:332-336`, sin `timeoutMs`.
- El DELETE de saneo → `lib/serverScanRunner.js:287-290`, sin `timeoutMs`.

Consecuencia práctica: **el corte no lo pone nuestro código, lo pone Postgres.**
Nuestro proceso esperaría lo que hiciera falta; es la base la que decide
cancelar. Eso encaja exactamente con el error que se guarda (Parte D).

### A.3 Los límites de Vercel no aplican

La aplicación corre ahora mismo en local (`localhost:3000`, `next dev`), así
que los topes de ejecución de Vercel no intervienen. `next.config.js` no
configura ningún límite de tiempo:

```js
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};
```

`maxDuration = 300` es una directiva para el despliegue en Vercel; en `next dev`
no se aplica. Aunque se aplicara, **300 s es por invocación de una ruta, no por
corrida**: cada eslabón es una invocación distinta, y ninguna corrida tuvo un
eslabón que se acercara a 5 minutos. La base de datos, en cambio, sí es la
misma de producción (`dzovggfbcoymjgikkbno.supabase.co`, visible en el error
de la corrida del 15 de julio).

### A.4 ¿Cuál de ellos cae entre los dos y los tres minutos?

**Ninguno.** El inventario completo se agrupa en tres escalas: milisegundos de
cadencia (1,5-2 s), topes de lectura de caché (1,5 s), un tope de arranque
(12 s), y dos topes de 300 s que no aplican en local. Entre 120 y 180 segundos
no hay absolutamente nada.

Esto es coherente con lo que dicen los datos (Parte B): **la ventana de 2-3
minutos no existe.**

---

## PARTE B — Qué dice la base

### B.1 Consulta usada

Servidor MCP `supabase_query` (solo lectura). Consulta exacta:

```
table:  scans
select: id,name,created_at,updated_at,row_count,progress:settings->progress
filter: settings->progress->>status=eq.error
order:  created_at.desc
limit:  8
```

Se pidió `settings->progress` y no `settings` entero deliberadamente: `settings`
lleva dentro la lista completa de símbolos del universo y traerla habría sido
justamente el problema que estamos investigando.

### B.2 Las cinco corridas fallidas que hay en la base

| Fecha (UTC) | id (corto) | eslabón | símbolos procesados | filas guardadas | `startedAt` | último `updatedAt` | **duración** |
|---|---|---|---|---|---|---|---|
| 09-ago 14:50 | `e427d250` | 1 | 300 | 0 | 14:50:11.692 | 14:50:30.285 | **18,6 s** |
| 09-ago 16:07 | `6fb4e02f` | 2 | 600 | 299 | 16:07:12.572 | 16:08:45.955 | **93,4 s** |
| 10-ago 17:32 | `a430e08a` | 8 | 2.222 | 2.083 | 17:32:28.596 | 17:36:23.463 | **234,9 s** |
| 10-ago 18:25 | `a806f52f` | 9 | 2.652 | 2.482 | 18:25:35.824 | 18:29:15.516 | **219,7 s** |
| 15-jul 18:36 | `29dc00e5` | 14 | 4.200 | 3.972 | 18:36:38.931 | 18:40:27.941 | **229,0 s** |

(La de julio pedía un universo de 5.864 símbolos, no 10.000, y falló con **otro
error** — ver Parte D.2. Se incluye por comparación.)

### B.3 El patrón de "2-3 minutos" NO se sostiene

Las duraciones son **18,6 s / 93,4 s / 234,9 s / 219,7 s**. Ni una sola cae
entre 120 y 180 segundos. Dos son mucho más cortas y dos son más largas (3 min
40 s y 3 min 55 s).

Lo que probablemente generó la impresión: las dos corridas más recientes —las
que se hicieron después de los dos arreglos, y por tanto las que más se
recuerdan— duraron **220 y 235 segundos**, es decir, "algo menos de cuatro
minutos". Vistas de reojo pueden parecer "dos y pico". Pero no forman una
ventana con las anteriores.

**Conclusión de la Parte B: la hipótesis del límite de tiempo global queda
descartada por los datos.** No hay un reloj que corte la corrida.

### B.4 Qué SÍ tienen en común las corridas fallidas

Consultas usadas (una por corrida; se muestra la de la última):

```
table:  scan_results
select: rank_index,created_at
filter: scan_id=eq.a806f52f-7840-4348-957c-a718ab3ea539&rank_index=in.(50,150,250,500,750,1000,1250,1500,1750,2000,2100,2200,2300,2350,2400,2450,2482)
order:  rank_index.asc
limit:  20
```

Los cuatro rasgos comunes:

**1. Todas mueren con el mismo mensaje** — `"canceling statement due to
statement timeout"` (las cuatro de agosto; la de julio no, ver D.2).

**2. Todas piden el universo completo** — `total: 10000` en las cuatro. Nótese
que son 10.000 y no 10.234: `normalizeSymbols` recorta en `MAX_SYMBOLS`
(`lib/serverScanRunner.js:42`, `export const MAX_SYMBOLS = 10000;`).

**3. Todas mueren a mitad de trabajo, no al terminar un eslabón** — el cursor
final (300, 600, 2.222, 2.652) y las filas guardadas (0, 299, 2.083, 2.482) no
coinciden: siempre quedan entre 100 y 300 filas en el buffer sin guardar.

**4. Y el hallazgo más informativo: todas terminan con un agujero largo sin
guardar nada.** Comparando la hora de la última fila insertada en
`scan_results` con la hora del error:

| Corrida | última fila guardada | error registrado | **agujero** |
|---|---|---|---|
| 09-ago 16:07 | 16:07:51.263 | 16:08:45.955 | **54,7 s** |
| 10-ago 17:32 | 17:36:02.132 | 17:36:23.463 | **21,3 s** |
| 10-ago 18:25 | 18:28:52.707 | 18:29:15.516 | **22,8 s** |

Durante esos veintitantos segundos el escaneo seguía procesando símbolos (el
cursor avanzó de 2.482 a 2.652 en la última corrida), pero **no consiguió
escribir nada**. Se quedó esperando a la base.

**Dos agujeros casi idénticos —21,3 s y 22,8 s— en dos corridas
independientes** apuntan a un tope fijo del lado del servidor, en algún punto
entre 20 y 23 segundos. No puedo leer su valor exacto (ver "LO QUE NO HE
VERIFICADO").

### B.5 El ritmo de guardado sí se degrada, pero suavemente

De la misma consulta, ritmo de filas guardadas por segundo:

Corrida del 10-ago 18:25 (`a806f52f`):

| tramo | filas | segundos | filas/s |
|---|---|---|---|
| 250 → 1.000 | 750 | 48,5 | **15,5** |
| 1.000 → 1.750 | 750 | 54,6 | **13,7** |
| 1.750 → 2.450 | 700 | 78,5 | **8,9** |

Corrida del 10-ago 17:32 (`a430e08a`):

| tramo | filas | segundos | filas/s |
|---|---|---|---|
| 250 → 1.000 | 750 | 74,2 | **10,1** |
| 1.750 → 2.050 | 300 | 43,9 | **6,8** |

El ritmo cae entre un 33 % y un 43 % a lo largo de la corrida. Es una
degradación real, pero **gradual y modesta**: no explica por sí sola una parada
brusca de 22 segundos. Y tiene al menos una explicación alternativa inocente
que no puedo descartar: los símbolos no están ordenados al azar, así que los
del final del universo pueden ser sistemáticamente más lentos (menos presencia
en la caché de `daily_bars`, más llamadas en vivo a Yahoo).

---

## PARTE C — Qué crece conforme avanza la corrida

### C.1 Candidato 1: la tabla `scan_results` acumula filas e índices — **poco probable**

Cada tanda de 50 filas se inserta aquí (`lib/serverScanRunner.js:332-336`):

```js
        await supabaseRequest("scan_results", {
          method: "POST",
          prefer: "return=minimal",
          body: batch.map((row, index) => resultPayload(row, scanId, ownerId, state.insertedCount + index + 1, settings)),
        });
```

La tabla tiene **ocho índices** que hay que mantener en cada inserción
(`supabase/schema.sql:1521-1528`):

```sql
create index if not exists scan_results_scan_id_idx on scan_results(scan_id);
create index if not exists scan_results_owner_scan_rank_idx on scan_results(owner_id, scan_id, rank_index);
create index if not exists scan_results_symbol_idx on scan_results(owner_id, symbol);
create index if not exists scan_results_owner_created_idx on scan_results(owner_id, created_at desc);
create index if not exists scan_results_owner_sector_created_idx on scan_results(owner_id, sector, created_at desc);
create index if not exists scan_results_owner_industry_created_idx on scan_results(owner_id, industry, created_at desc);
create index if not exists scan_results_owner_theme_created_idx on scan_results(owner_id, theme, created_at desc);
create index if not exists scan_results_owner_country_created_idx on scan_results(owner_id, country, created_at desc);
```

**Por qué lo descarto como causa del fallo**: la evidencia de B.4 dice que las
inserciones iban bien hasta el último instante (la última tanda entró a las
18:28:52, seis segundos después de la anterior). Si el problema fuera insertar,
el fallo aparecería *en* una inserción y el ritmo se habría desplomado antes.
Además el volumen es pequeño: sumando el `row_count` de todos los escaneos
guardados (consulta `table: scans, select: id,created_at,row_count,
status:settings->progress->>status, order: row_count.desc, limit: 12`), los
mayores son 3.972, 2.482, 2.083 y 299 filas; el resto son escaneos del cron con
1-50 filas. Estamos hablando de unas 10.000 filas en total, no de millones.

El DELETE de saneo del arranque de cada eslabón (`lib/serverScanRunner.js:287-290`):

```js
    await supabaseRequest("scan_results", {
      method: "DELETE",
      query: `scan_id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(ownerId)}&rank_index=gt.${state.insertedCount}`,
    });
```

está cubierto exactamente por `scan_results_owner_scan_rank_idx (owner_id,
scan_id, rank_index)`, así que no debería recorrer la tabla entera. Y solo se
ejecuta una vez por eslabón, no en el bucle.

### C.2 Candidato 2: la fila de `scans` se reescribe cada 1,5-3 s — **el más probable**

Este es el bucle completo (`lib/serverScanRunner.js:340-353`):

```js
    while (!state.workersDone) {
      // Cancelación: el flag se relee de Supabase al inicio de cada ciclo de
      // persistencia (no por símbolo). Si está activo, los workers dejan de tomar
      // símbolos nuevos, se persiste lo pendiente y se marca cancelled sin reencolar.
      state.cancelRequested = state.cancelRequested || await readCancelRequested(scanId, ownerId);
      if (state.cancelRequested) break;
      await flushBatches(false);
      // Segunda lectura antes de sobrescribir settings.progress: evita pisar un
      // cancelRequested que haya llegado mientras se persistía el lote.
      state.cancelRequested = state.cancelRequested || await readCancelRequested(scanId, ownerId);
      if (state.cancelRequested) break;
      await patchScan(scanId, ownerId, { rowCount: state.insertedCount, progress: progressPayload("running"), fallbackSettings: settings });
      await sleep(FLUSH_INTERVAL_MS);
    }
```

Cada vuelta toca la fila de `scans` **tres veces**: dos lecturas y una
escritura. Con `FLUSH_INTERVAL_MS = 1500` y las tres llamadas de por medio, una
corrida de 220 segundos da del orden de **80-90 vueltas: ~170 lecturas y ~85
reescrituras de la misma fila**.

**Y esa fila es enorme.** Las dos lecturas son esto
(`lib/serverScanRunner.js:167-172`):

```js
async function readCancelRequested(scanId, ownerId) {
  const [scan] = await supabaseRequest("scans", {
    query: `id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=settings&limit=1`,
  });
  return Boolean(scan?.settings?.progress?.cancelRequested);
}
```

`select=settings` trae **la columna `settings` entera**, con
`settings.scanSymbols` dentro — la lista completa de los 10.000 símbolos. Para
leer un único booleano (`cancelRequested`). Esto se hace **dos veces por
vuelta**, es decir unas 170 veces por corrida. **Ninguno de los dos arreglos
anteriores tocó esta lectura.**

Y la escritura, aunque solo transmite `progress` por la red gracias a la RPC,
hace que Postgres reescriba el JSON completo. Cita literal de la migración
(`supabase/migrations/20260809160000_scan_progress_patch.sql`):

```sql
  update public.scans as s
  set settings = jsonb_set(coalesce(s.settings, '{}'::jsonb), '{progress}', coalesce(p_progress, '{}'::jsonb), true),
      row_count = coalesce(p_row_count, s.row_count),
      updated_at = now()
```

`jsonb_set` **no actualiza un trocito del JSON**: construye un valor JSON nuevo
—los 10.000 símbolos incluidos— y lo guarda entero. Postgres, además, nunca
modifica una fila en el sitio: escribe una versión nueva y marca la vieja como
muerta. Con un valor de este tamaño, esa versión nueva se almacena troceada en
una tabla auxiliar interna (TOAST), lo que multiplica el número de trozos
escritos y marcados como muertos en cada latido.

Detalle agravante: la instrucción también actualiza `updated_at`, y `updated_at`
forma parte de un índice (`supabase/schema.sql:1529`):

```sql
create index if not exists scans_active_idx on scans(owner_id, deleted_at, updated_at desc);
```

Cuando una actualización cambia una columna indexada, Postgres no puede aplicar
su optimización de limpieza rápida en la propia página (*HOT update*): tiene que
añadir una entrada nueva al índice y dejar la anterior muerta. Así que cada
latido ensucia también ese índice.

### C.3 Candidato 3: alguna consulta del bucle crece con lo ya procesado — **no**

Repasadas las cuatro consultas del bucle (las dos lecturas de `scans`, el INSERT
de 50 filas y el DELETE de saneo), **ninguna devuelve más datos según avanza la
corrida**. La única que crecía era `progress.errors`, y eso se corrigió ayer
agrupando por motivo (`lib/scanErrorGroups.js`); se ve en los datos: la corrida
de las 17:32 guardaba 17 entradas individuales y la de las 18:25 ya guarda **un
solo grupo con `count: 19`**.

Es decir: el trabajo por latido es **constante en tamaño de datos**, pero
**creciente en coste**, y lo que crece es el desorden acumulado en la fila
(C.2), no el volumen consultado.

### C.4 (Punto 7) Las tuplas muertas, en castellano llano

Postgres nunca "corrige" una fila existente. Cuando algo cambia, **escribe una
copia nueva y deja la vieja marcada como caducada**. Las copias caducadas siguen
ocupando sitio hasta que pasa el recogedor de basura (el *autovacuum*).

Aplicado a nuestro caso: durante una corrida de tres minutos, la ficha del
escaneo se reescribe unas noventa veces. Al final hay **una copia buena y unas
noventa copias caducadas de la misma ficha**, cada una arrastrando su copia de
la lista de 10.000 símbolos.

La analogía: es como una carpeta en la que cada dos segundos metes una versión
nueva de un documento de cien páginas, sin sacar las anteriores. A los tres
minutos la carpeta tiene noventa documentos de cien páginas y solo uno vale.
Cada vez que alguien quiere consultar "el documento bueno" o meter uno nuevo,
tiene que abrirse paso entre todo lo demás. No es que la operación cambie: es
que el sitio donde se hace está cada vez más lleno de basura.

Sí, **eso puede degradar tanto la lectura como la escritura de esa fila**, y es
uno de los pocos mecanismos conocidos que produce exactamente el síntoma que
tenemos: el coste crece con el **tiempo transcurrido** (número de
actualizaciones), no con el **volumen de trabajo útil** (símbolos procesados).
Que un mismo escaneo muera a los 19 segundos una vez y a los 4 minutos otra
depende de en qué estado estuviera esa carpeta al empezar y de cuándo pase el
recogedor.

**Aviso honesto**: esto es un mecanismo plausible y consistente con lo
observado, **no una medición**. Confirmarlo requiere leer `pg_stat_user_tables`
(cuántas tuplas muertas hay y cuándo fue el último autovacuum), y eso no lo
puedo hacer con la herramienta que tengo.

### C.5 (Punto 8) Qué limpieza hay configurada

Revisado todo el esquema (`supabase/schema.sql` y `supabase/migrations/`):

- **No hay ningún ajuste de autovacuum por tabla.** No existe ni una sola
  sentencia `alter table ... set (autovacuum_...)` en el repositorio. `scans` y
  `scan_results` usan los parámetros por defecto del servidor.
- **Sí hay limpieza programada, pero solo para otra tabla**
  (`supabase/schema.sql:1856-1864`):

```sql
select cron.schedule(
  'statsedge-daily-bars-vacuum-weekly',
  '15 3 * * 0',  -- domingos 03:15 UTC (15 min después del DELETE)
  $cron$
    vacuum (analyze) public.daily_bars;
  $cron$
);
```

Es decir: alguien ya se encontró este mismo problema con `daily_bars` y le puso
un `VACUUM` semanal. **Para `scans` —la tabla que se reescribe noventa veces
por corrida— no hay nada equivalente.**

Con los valores por defecto de Postgres, el autovacuum de una tabla se dispara
cuando hay más o menos "50 + 20 % de las filas" caducadas. `scans` tiene del
orden de 40 filas, así que el umbral son ~58 versiones muertas: una sola corrida
lo supera de sobra. Pero el autovacuum revisa cada cierto tiempo (por defecto,
un minuto) y tarda en ponerse: mientras limpia, la corrida sigue generando
basura. **No he podido verificar los valores reales de este proyecto.**

---

## PARTE D — El error real

### D.1 Sí queda registrado, y es literalmente el de Postgres

El mensaje que ve el usuario es una traducción nuestra. El patrón que la
dispara (`lib/screenerFormat.js:82-86`):

```js
    // Postgres aborta la consulta por exceder su statement_timeout. Es el caso
    // que motivó este mapeo — ver el documento citado arriba.
    test: /canceling statement due to statement timeout/i,
    message: "El servidor tardó demasiado en guardar el progreso del escaneo, probablemente porque el universo pedido era muy grande. Prueba con un universo más pequeño o inténtalo de nuevo en unos minutos.",
```

El texto crudo **se guarda en la propia fila del escaneo**, en
`settings.progress.error` (`lib/serverScanRunner.js:433`, dentro del catch
general). Y ahí está, en las cuatro corridas de agosto:

```
"error": "canceling statement due to statement timeout"
```

Además se escribe en la consola del servidor (`lib/serverScanRunner.js:425-429`,
`console.error("[scan-runner] eslabón fallido", {...})`). **Esa consola no la he
podido leer**: la terminal integrada está vacía y el servidor de desarrollo
corre en otra ventana.

Traducido: *"cancelé esta instrucción porque superó el tiempo máximo que tengo
permitido"*. Lo dice Postgres, no nuestro código, y confirma que el corte viene
de la base de datos y no de un tope nuestro (coherente con A.2: nosotros no
ponemos ninguno).

### D.2 ¿Siempre el mismo error? Casi

- **Las cuatro corridas de agosto**: idéntico, `canceling statement due to
  statement timeout`. Sin variantes.
- **La corrida del 15 de julio** (`29dc00e5`): **error distinto**. Lo que se
  guardó fue una página HTML de error de Cloudflare:
  `"supabase.co | 520: Web server is returning an unknown error"`, con Ray ID
  `a1bae54f0967da9d` y fecha `2026-07-15 18:40:28 UTC`.

El 520 significa que Cloudflare no obtuvo una respuesta válida del servidor de
Supabase. **No es el mismo fallo**, aunque el efecto para el usuario fuera
parecido y la duración (229 s) también. Dos apuntes:

1. Que se guarde una página HTML entera de 8 KB dentro de `progress.error`
   revela que el mensaje de error no se sanea antes de persistirlo — y ese texto
   pasa después a formar parte de la ficha que se reescribe cada 1,5 s. Es un
   problema secundario, real, y ajeno a esta tarea.
2. Un 520 es compatible con "el servidor de base de datos estaba ahogado", que
   es la misma familia de causa que estamos investigando, pero **no lo demuestra**.

Por tanto, para el diagnóstico de agosto: **un solo error, sin variedad.**

---

## PARTE E — Conclusión

### E.1 Lo que queda descartado

**No hay un límite de tiempo global de 2-3 minutos.** Ni en el código (Parte A:
no existe ningún tope entre 120 y 180 s), ni en los datos (Parte B: las
duraciones son 19 s, 93 s, 235 s y 220 s). La observación de partida no se
sostiene; conviene dejarlo dicho para que no oriente los próximos intentos.

### E.2 La causa más probable

**Una operación sobre la fila de `scans` —leerla entera o reescribirla entera—
se cuelga más de veinte segundos y Postgres la cancela.** La corrida muere
cuando le toca esa mala operación, no al cumplirse ningún plazo.

Evidencia que lo sostiene:

1. **El error es de Postgres, no nuestro** (`canceling statement due to
   statement timeout`), y nuestro código no pone ningún tope a las llamadas a
   Supabase (`lib/supabaseServer.js:51-52`). Quien corta es la base.
2. **Guardar resultados no es lo que falla**: la última tanda de 50 filas entró
   con normalidad 6 segundos antes del agujero final, y el ritmo global solo
   cae un 33-43 % en toda la corrida.
3. **El agujero terminal es de 21,3 s y 22,8 s en dos corridas
   independientes** — dos medidas casi iguales apuntan a un tope fijo del
   servidor, no a una degradación difusa.
4. **Durante ese agujero el escaneo seguía trabajando** (el cursor avanzó de
   2.482 a 2.652): no estaba parado, estaba esperando a la base.
5. **Solo hay dos operaciones candidatas**, y ambas son sobre `scans`: la
   lectura `select=settings` de `readCancelRequested` —que arrastra los 10.000
   símbolos para leer un booleano, dos veces por vuelta, y que **nadie ha
   tocado en los dos arreglos anteriores**— y la reescritura vía `jsonb_set`,
   que **reconstruye el JSON completo aunque solo viaje `progress` por la red**.
6. **Encaja con por qué los dos arreglos ayudaron poco**: redujeron los bytes
   que viajan (de 181 KiB a ~2 KiB por latido), pero no redujeron ni un byte lo
   que Postgres lee y reescribe. Y la mejora fue proporcional a eso: de 600 a
   2.222 símbolos con el primero, y solo un 12 % más con el segundo.
7. **El coste crece con el número de actualizaciones, no con el trabajo útil**
   (C.2, C.4), que es exactamente el perfil de un fallo que aparece "a ratos
   antes y a ratos después".

### E.3 Lo que NO puedo determinar y qué haría falta medir

No puedo cerrar el diagnóstico al 100 % porque el servidor MCP disponible solo
lee las tablas del producto. Concretamente, **no puedo saber cuál de las dos
operaciones sobre `scans` es la que se cuelga** — la lectura o la escritura.
Para cerrarlo harían falta cuatro medidas, todas de solo lectura pero fuera del
alcance de esta herramienta:

1. **`show statement_timeout`** para el rol con el que entra PostgREST. Si sale
   un valor entre 20 y 23 s, confirma la lectura de B.4 y cierra el "cuánto".
2. **`select relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze
   from pg_stat_user_tables where relname in ('scans','scan_results')`**,
   tomado antes y después de una corrida. Si `n_dead_tup` de `scans` sube a
   ~90 y `last_autovacuum` no se mueve, confirma C.4.
3. **`pg_total_relation_size('scans')`** y el tamaño de su tabla TOAST, antes y
   después. Confirma cuánto se está reescribiendo de verdad por latido.
4. **`pg_stat_statements`** filtrado por las consultas a `scans`: daría
   directamente `max_exec_time` de la lectura y de la RPC, y con eso se sabría
   cuál de las dos es la culpable sin ambigüedad.

Una quinta medida, más barata y al alcance sin herramientas nuevas: **medir en
el propio código el tiempo de cada llamada** (`Date.now()` alrededor de
`readCancelRequested` y de `patchScan`) y volcarlo a la consola del servidor.
En una sola corrida se vería cuál se dispara. Eso implicaría tocar código, cosa
que esta tarea prohíbe.

---

## CONFIANZA

**Alta (verificado directamente):**

- El inventario de límites de tiempo de la Parte A. Leído del código, con
  archivo y línea.
- Que no existe ningún tope entre 120 y 180 segundos.
- Que las llamadas a Supabase del bucle del escaneo no llevan `timeoutMs` y por
  tanto no tienen límite por nuestra parte.
- Las cinco corridas fallidas, sus duraciones, sus cursores y sus mensajes de
  error. Leídos de producción con las consultas citadas.
- Que la ventana de "2-3 minutos" no existe.
- Los agujeros de 21,3 s / 22,8 s / 54,7 s entre la última inserción y el error.
- Que `readCancelRequested` pide `select=settings` completo dos veces por vuelta.
- Que `jsonb_set` reescribe el JSON entero (es su semántica documentada) y que
  `updated_at` está indexado en `scans_active_idx`.
- Que no hay ningún ajuste de autovacuum por tabla y que el único `VACUUM`
  programado es para `daily_bars`.

**Media (deducido de marcas de tiempo, no medido):**

- Que la operación que se cuelga es sobre `scans` y no sobre `scan_results`. Se
  deduce de que las inserciones iban a ritmo normal hasta 6 segundos antes del
  fallo, y de que durante el agujero el escaneo seguía avanzando. Es una
  deducción sólida, pero indirecta.
- Que el tope del servidor está entre 20 y 23 segundos. Se deduce de dos
  agujeros de 21,3 s y 22,8 s. Dos muestras.
- Que la degradación del ritmo (−33 % a −43 %) se debe a la acumulación en la
  fila de `scans`. Explicación alternativa igualmente viva: los símbolos del
  final del universo son más lentos por sí mismos.

**Baja (mecanismo plausible, sin evidencia directa):**

- Que las tuplas muertas y el TOAST de `scans` sean el motor concreto de la
  degradación. El mecanismo es real y encaja con el síntoma, pero no he medido
  ni una sola tupla muerta.

---

## LO QUE NO HE VERIFICADO

- **El `statement_timeout` real del proyecto.** El servidor MCP solo permite
  consultar las tablas del producto vía PostgREST; no admite SQL arbitrario, así
  que `pg_settings`, `pg_stat_user_tables`, `pg_stat_statements`, `pg_locks` y
  `pg_stat_activity` quedan fuera de alcance. El valor de 20-23 s es una
  inferencia a partir de dos marcas de tiempo, no una lectura.
- **Cuántas tuplas muertas genera realmente una corrida**, ni si el autovacuum
  llegó a pasar durante ella. Es el eslabón débil del diagnóstico.
- **Cuál de las dos operaciones sobre `scans` se cuelga** — la lectura de
  `readCancelRequested` o la escritura de `patchScan`. Sé que es una de las dos;
  no sé cuál.
- **El tamaño real de `settings` para un universo de 10.000 símbolos.** La cifra
  de 181 KiB viene de la tarea anterior; el documento del 9 de agosto midió
  59.688 bytes para 5.864 símbolos (44.575 de ellos en `scanSymbols`), lo que
  extrapolaría a ~76 KB. No he medido el valor actual: pedirlo habría traído los
  10.000 símbolos por la consulta, exactamente lo que estamos investigando.
- **Los logs de la consola del servidor.** El `console.error("[scan-runner]
  eslabón fallido")` debería llevar el mismo mensaje crudo y quizá contexto
  extra, pero la terminal integrada está vacía y el `next dev` corre en otra
  ventana a la que no tengo acceso.
- **Cuántas filas tiene `scan_results` en total.** El MCP no ofrece un recuento;
  la estimación de ~10.000 filas sale de sumar el `row_count` de los escaneos
  guardados, y puede quedarse corta o larga si la purga programada ya borró
  filas cuyo escaneo sigue existiendo.
- **No he reproducido el fallo.** La tarea prohíbe ejecutar escaneos, así que
  todo se apoya en las cinco corridas que ya estaban en la base.
- **La corrida del 15 de julio** (error 520 de Cloudflare) no la he investigado
  a fondo: no comparte mensaje con las de agosto y podría ser otra cosa.
- **El escaneo zombi** `19bab3b4-caa0-4740-8aca-19b5f678f1e9`, del 9 de agosto,
  sigue con `status: "running"` y `link: 0` desde las 18:43 de ese día. No lo he
  investigado ni sé si tiene efecto alguno; lo dejo apuntado porque salió en las
  consultas.
