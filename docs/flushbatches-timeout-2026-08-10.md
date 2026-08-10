# Por qué se cuelga `flushBatches`: qué se escribe en `scan_results` y cuánto pesa

Fecha: 2026-08-10. BASE_SHA: `4a2deaa` (rama `codex/statsedge-ui-polish`).

**Documento de diagnóstico. No se ha modificado ningún archivo de código, no se
ha escrito nada en Supabase, no se ha ejecutado ningún escaneo y no se ha hecho
commit ni push.** Todas las consultas son de solo lectura.

---

## Resumen para el dueño (sin jerga)

Cada símbolo escaneado se guarda como una fila. Esa fila **no es una fila
normal**: lleva dentro dos bloques de JSON (`raw` y `metrics`) que suman
**89 KB de texto por símbolo**. Para hacerse una idea: eso es más o menos el
texto de un capítulo de novela corta, por cada acción de la lista.

Como el escaneo guarda de 50 en 50, **cada envío al servidor son unos 4,5 MB**.
Y hay que hacer unos 36 envíos por corrida (1.786 símbolos / 50).

Eso tiene tres consecuencias medidas, no supuestas:

1. **Una sola tanda de 50 tarda 1,3 segundos de media dentro de Postgres, y ha
   llegado a tardar 6,6 segundos.** (Medido: 180 ejecuciones reales.)
2. **Hay un límite de 8 segundos por operación** que aplica a todas las
   llamadas del producto a la base de datos. Cuando una tanda pasa de ahí,
   Postgres la mata y el escaneo entero se cae con el error exacto que aparece
   guardado: *"canceling statement due to statement timeout"*.
3. **`flushBatches` no escribe una tanda: vacía todas las tandas pendientes de
   golpe, en fila.** Por eso los 24,8 s y 20,3 s del informe de medición no son
   "una escritura lenta": son **cinco o seis escrituras seguidas** de 4-5 s
   cada una. El reloj de 8 s no se aplica a esos 24,8 s (se aplica a cada
   escritura por separado), pero sí explica por qué el margen es tan estrecho.

Y sobre "por qué se degrada": la premisa de que *"cada eslabón empieza de cero
y aun así se atasca"* **no se sostiene con los datos**. La degradación no es por
eslabón: es continua a lo largo de toda la corrida. En las cuatro corridas de
hoy, las primeras 12 tandas tardan 2,4-3,8 s entre sí y a partir de la tanda 25
tardan 4,8-6,0 s — el doble, de forma monótona, atravesando las fronteras entre
eslabones.

**La causa más probable, en una frase:** se escriben 89 KB de JSON por símbolo
en una tabla que ya acumula 481 MB, sobre una instancia de 1 GB de RAM, y el
tope de 8 segundos por operación no deja margen para el peor caso. Los tres
factores son necesarios; ninguno solo lo explica.

**Y sí, hay un componente de recursos**, tal y como se pedía comprobar: la base
ocupa 2.467 MB y la memoria de caché de Postgres son 256 MB. No cabe. Pero
subir la instancia mueve el techo, no quita el multiplicador: mientras cada
símbolo cueste 89 KB, cualquier universo grande vuelve a acercarse al tope.

---

## PARTE A — Qué hace `flushBatches`

### A.1 Cita literal

`lib/serverScanRunner.js:352-363`:

```js
    // Escritor único: lotes de 50 a scan_results + progreso/cursor en scans.settings.progress.
    const flushBatches = async (force = false) => {
      while (state.buffer.length >= RESULT_BATCH_SIZE || (force && state.buffer.length)) {
        const batch = scoreRowsForServerScan(state.buffer.splice(0, RESULT_BATCH_SIZE));
        await supabaseRequest("scan_results", {
          method: "POST",
          prefer: "return=minimal",
          body: batch.map((row, index) => resultPayload(row, scanId, ownerId, state.insertedCount + index + 1, settings)),
        });
        state.insertedCount += batch.length;
      }
    };
```

**Qué escribe, en qué tablas y en qué orden:**

- Escribe **en una sola tabla: `scan_results`**. Un único `POST` de PostgREST,
  que se traduce en un `INSERT` con 50 filas.
- **No hay `UPDATE`, no hay segunda tabla, no hay escritura derivada.** Ni
  disparadores (*triggers*): revisado `supabase/schema.sql` y las 15
  migraciones — ningún `create trigger ... on public.scan_results`.
- El orden dentro del bucle es: (1) sacar 50 filas del búfer y puntuarlas en
  memoria con `scoreRowsForServerScan`, (2) convertirlas a payload con
  `resultPayload`, (3) enviar el `INSERT`, (4) sumar al contador.

**Lo importante es el `while`.** No es "escribe una tanda"; es "sigue
escribiendo tandas mientras queden 50 o más en el búfer". Los cinco
trabajadores en paralelo (`SCAN_CONCURRENCY = 5`, `lib/serverScanRunner.js:38`)
siguen llenando el búfer mientras tanto. Si cuando entra a `flushBatches` hay
250 filas acumuladas, hace **cinco `INSERT` seguidos sin soltar el hilo**.

Ahí está la reconciliación con la medición: ninguna sentencia SQL de toda la
base de datos ha superado los 6,95 s (ver B.4), así que **un `flushBatches` de
24.829 ms no puede ser una escritura**. Son 5-6.

Coherente con el propio fichero de medición: en el eslabón que registra
`flushBatches ms=20320`, solo hubo **dos vueltas** de bucle (`vuelta=1
flushBatches ms=0`, `vuelta=2 flushBatches ms=20320`). Los trabajadores se
comieron los ~255 símbolos del eslabón casi de golpe y la segunda vuelta tuvo
que vaciar el atasco entero.

### A.2 Qué significa exactamente `RESULT_BATCH_SIZE = 50`

`lib/serverScanRunner.js:39`:

```js
export const RESULT_BATCH_SIZE = 50;
```

**Cincuenta filas por petición, y cincuenta símbolos: es uno a uno.** Cada
símbolo procesado con éxito produce exactamente un `push` al búfer
(`lib/serverScanRunner.js:341`) y cada elemento del búfer produce exactamente
una fila (`batch.map(...)`, línea 359). Los símbolos que fallan no entran al
búfer: van al agregador de errores (líneas 342-346).

Comprobado contra los datos reales: las tandas de la corrida fallida tienen 50
filas exactas por marca de tiempo.

```sql
select created_at, count(*) as filas_en_esa_marca
from public.scan_results where scan_id='37c7fb87-afd5-4143-829e-857876ca5e8d'
group by created_at order by created_at limit 12;
```

→ `50, 50, 50, 50, 50, 49, 50, 50, 50, 50, 50, 46`.

(Las dos tandas de 49 y 46 filas son una anomalía menor que **no he
investigado**; ver "LO QUE NO HE VERIFICADO".)

### A.3 ¿Escribe en varias tablas? ¿Cuál es la lenta?

Solo escribe en `scan_results`. La medición no necesita distinguir nada porque
no hay nada que distinguir.

Ahora bien — y esto sí importa para el diagnóstico — **el resto del escaneo sí
está escribiendo en otras tablas al mismo tiempo**, desde el mismo proceso. Ver
D.2.

### A.4 ¿Hay `upsert` con clave de conflicto?

**No.** Es un `INSERT` limpio. Lo confirma la sentencia real registrada por
Postgres:

```sql
select calls, round(total_exec_time::numeric,0) as total_ms, round(mean_exec_time::numeric,1) as media_ms,
  round(max_exec_time::numeric,0) as max_ms, rows,
  left(regexp_replace(query,'\s+',' ','g'),110) as consulta
from extensions.pg_stat_statements
where query ilike '%scan_results%'
order by total_exec_time desc limit 8;
```

→ La entrada principal es
`WITH pgrst_source AS (INSERT INTO "public"."scan_results"("company_name", "country", "industry", "metrics", "m...`
— sin `ON CONFLICT`. **180 llamadas, 241.323 ms totales, media 1.340,7 ms,
máximo 6.599 ms.**

Tampoco hay ninguna restricción de unicidad que obligue a comprobar duplicados
más allá de la clave primaria (ver C.4).

---

## PARTE B — Cuánto pesa cada fila

### B.1 Las columnas

`supabase/schema.sql:24-43`, literal:

```sql
create table if not exists scan_results (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  scan_id uuid not null references scans(id) on delete cascade,
  symbol text not null,
  company_name text,
  country text,
  sector text,
  industry text,
  theme text,
  rank_index integer,
  total_score numeric,
  weinstein_score numeric,
  minervini_score numeric,
  risk_score numeric,
  rs_rating numeric,
  metrics jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

Más seis columnas añadidas después y que en la práctica van siempre a `NULL`
(`supabase/migrations/20260717100000_scan_result_sets_foundation.sql:146-151`):
`result_set_id`, `work_index`, `identity_key`, `payload_hash`, `row_hash`,
`integrity_class`.

Todo lo que no es `metrics` y `raw` ocupa unas pocas decenas de bytes. Las
grandes son las dos JSONB.

### B.2 El tamaño real de una fila (medido)

```sql
select
  avg(octet_length(raw::text))::bigint as raw_json_bytes_sin_comprimir,
  avg(pg_column_size(raw))::bigint as raw_bytes_almacenados,
  avg(octet_length(metrics::text))::bigint as metrics_json_bytes,
  (select current_setting('default_toast_compression')) as compresion
from public.scan_results where created_at >= '2026-08-10T21:15:00Z';
```

| Medida | Valor |
|---|---|
| `raw`, texto JSON tal cual viaja por la red | **61.660 bytes** |
| `raw`, ya comprimido y almacenado | 20.818 bytes |
| `metrics`, texto JSON | **27.577 bytes** |
| Fila completa almacenada (media / máx) | **28 KB / 31 KB** |

**Texto JSON por símbolo: ~89,2 KB. Almacenado tras comprimir: ~28 KB.**

Dónde está ese peso, campo a campo:

```sql
select k, pg_size_pretty(avg(pg_column_size(v))::numeric) as tam_medio
from public.scan_results t, lateral jsonb_each(t.raw) as e(k,v)
where t.created_at >= '2026-08-10T21:15:00Z'
group by k order by avg(pg_column_size(v)) desc limit 15;
```

| Campo dentro de `raw` | Tamaño medio |
|---|---|
| `chartPreview` | **21 kB** |
| `objectiveMetricAudit` | **20 kB** |
| `decisionTrace` | 8,0 kB |
| `growthMetrics` | 5,3 kB |
| `signalCoverage` | 1,2 kB |
| (los otros 261 campos) | < 1 kB cada uno |

`raw` tiene **266 claves**. Tres de ellas son el 80% del peso.

Y la misma consulta sobre `metrics`:

| Campo dentro de `metrics` | Tamaño medio |
|---|---|
| `objectiveMetricAudit` | **20 kB** |
| `decisionTrace` | 8,0 kB |
| el resto | < 60 bytes cada uno |

**`objectiveMetricAudit` y `decisionTrace` se guardan DOS veces en cada fila**,
una en `raw` y otra en `metrics` — unos 28 KB duplicados por símbolo. Es
consecuencia directa del código: `resultPayload` mete `preparedRow` entero en
`raw` (`lib/serverScanRunner.js:114`) y `scanDecisionMetrics` vuelve a copiar
esos dos campos dentro de `metrics`
(`lib/scanDecisionProjection.js:92-93`).

### B.3 Cuánto pesa una tanda de 50

- **Por la red y por el parseador de PostgREST: ~4,46 MB** (50 × 89,2 KB de
  texto JSON).
- **Escrito en disco: ~1,4 MB** (50 × 28 KB), más el registro de transacciones
  (WAL) correspondiente.

Ese es el número que importa para entender los 24,8 s: `flushBatches` puede
llegar a mover **20-25 MB de JSON en una sola llamada** cuando vacía cinco o
seis tandas atascadas.

### B.4 Sí, hay compresión, y sí, se guarda fuera de línea

`default_toast_compression` = **`pglz`** (el algoritmo antiguo de Postgres, más
lento que `lz4`). Comprime 61.660 → 20.818 bytes, un 3:1.

Y lo que se sospechaba está confirmado: **casi toda la tabla vive fuera de
línea**, en la tabla auxiliar TOAST.

```sql
select
  pg_size_pretty(pg_total_relation_size('public.scan_results')) as total,
  pg_size_pretty(pg_relation_size('public.scan_results')) as heap,
  pg_size_pretty(pg_indexes_size('public.scan_results')) as indexes,
  pg_size_pretty(pg_total_relation_size(reltoastrelid)) as toast,
  reltuples::bigint as est_rows
from pg_class where oid = 'public.scan_results'::regclass;
```

| Parte | Tamaño |
|---|---|
| Total | **490 MB** |
| Tabla propiamente dicha | 4.032 kB |
| Todos los índices juntos | 5.360 kB |
| **TOAST (los JSON fuera de línea)** | **481 MB (98%)** |

Y cuántos trozos son:

```sql
select c.relname, s.n_live_tup, s.n_dead_tup, s.last_autovacuum, s.autovacuum_count,
  pg_size_pretty(pg_relation_size(c.oid)) as size
from pg_stat_all_tables s join pg_class c on c.oid = s.relid
where c.relname = 'scan_results' or c.oid = (select reltoastrelid from pg_class where oid='public.scan_results'::regclass);
```

| Tabla | Filas vivas | Tamaño | Último autovacuum |
|---|---|---|---|
| `scan_results` | 14.004 | 4.032 kB | 2026-08-10 19:23:20 |
| `pg_toast_33561` (su TOAST) | **142.382** | 475 MB | **2026-08-10 21:16:30** |

142.382 trozos para 14.004 filas: **unos 10 trozos TOAST por fila**. Escribir
una tanda de 50 filas no son 50 escrituras: son **50 + ~500 trozos TOAST + el
índice del TOAST + 9 índices de la tabla**. Del orden de **1.000 inserciones
físicas por tanda**.

Fíjese además en la fecha del último autovacuum del TOAST: **21:16:30**, dentro
de la ventana de la corrida que falló (21:15:17 → 21:17:39). Ver D.2.

---

## PARTE C — Cuántas filas hay y cómo afecta

### C.1 Cuántas filas hay hoy (contado, no estimado)

```sql
select count(*) as filas_totales, count(distinct scan_id) as scans,
  min(created_at) as mas_antigua, max(created_at) as mas_reciente
from public.scan_results;
```

→ **14.004 filas, de 76 escaneos distintos**, desde el 2026-06-20 hasta el
2026-08-10.

Confirmado que **no hay retención**: la fila más antigua tiene casi dos meses.
El único borrado programado es de `scans` (semanal, domingos a las 3:00), que
arrastra `scan_results` por cascada a los 30 días — pero de `updated_at`, así
que un escaneo tocado recientemente no caduca nunca.

En perspectiva: **una sola corrida del universo completo (10.000 símbolos)
añadiría ~280 MB**, es decir, más de la mitad otra vez de lo que hay acumulado
desde junio.

Y el contexto de la instancia: la base de datos entera ocupa **2.467 MB**
(`select pg_size_pretty(pg_database_size(current_database()))`).

### C.2 Los índices

`supabase/schema.sql:1521-1528`, literal:

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

Más la clave primaria y uno parcial de
`supabase/migrations/20260717100000_scan_result_sets_foundation.sql:360`.
Tamaños reales:

```sql
select indexname, pg_size_pretty(pg_relation_size(indexname::regclass)) as size, indexdef
from pg_indexes where schemaname='public' and tablename='scan_results'
order by pg_relation_size(indexname::regclass) desc;
```

| Índice | Tamaño |
|---|---|
| `scan_results_owner_scan_rank_idx` | 1.240 kB |
| `scan_results_owner_industry_created_idx` | 928 kB |
| `scan_results_symbol_idx` | 752 kB |
| `scan_results_pkey` | 632 kB |
| `scan_results_owner_theme_created_idx` | 472 kB |
| `scan_results_owner_sector_created_idx` | 448 kB |
| `scan_results_owner_country_created_idx` | 248 kB |
| `scan_results_owner_created_idx` | 224 kB |
| `scan_results_scan_id_idx` | 216 kB |
| `scan_results_result_set_work_item_idx` (parcial) | 8.192 bytes |

**Nueve índices que mantener en cada inserción** (el décimo es parcial y no se
toca, porque `result_set_id` va siempre a `NULL`).

**Pero no son el problema.** Los nueve juntos suman 5,4 MB — caben de sobra en
memoria, y el propio Postgres reporta un 90,9% de aciertos de caché en sus
páginas de índice. Comparado con los 481 MB del TOAST, son ruido. Es
importante decirlo: **quitar índices aquí no compraría casi nada.**

### C.3 ¿Índices sobre columnas JSON o caros de mantener?

**No hay ninguno sobre `raw` ni sobre `metrics`.** Ningún GIN, ningún índice de
expresión. Todos son B-tree sobre columnas escalares pequeñas.

El único con una pega teórica es `scan_results_pkey`, sobre un `uuid` aleatorio
(`gen_random_uuid()`): las inserciones caen en posiciones dispersas del índice
en vez de al final. Con 632 kB de índice es irrelevante hoy; se menciona solo
para dejar constancia de que se ha mirado.

### C.4 ¿Restricciones de unicidad?

**Solo la clave primaria** (`id uuid primary key`), sobre un valor generado
aleatoriamente en el propio Postgres. No hay ningún `unique (owner_id, scan_id,
symbol)` ni similar. Es decir: **el `INSERT` no tiene que buscar duplicados por
símbolo.**

Las restricciones que sí existen son de comprobación (`check`) y de clave
foránea, y todas son baratas:

- `scan_results_hito_1a_legacy_barrier_check` y las otras `check`
  (`20260717100000_...:315-345`) — comparaciones contra `NULL` y una constante.
- `scan_results_result_set_fk` y `scan_results_work_item_fk` — declaradas
  `not valid` y `deferrable initially deferred`, y además **no llegan a
  dispararse** porque `result_set_id` es siempre `NULL` (una clave foránea con
  cualquier columna nula no se comprueba).
- La única viva es `scan_id references scans(id)`, una búsqueda por clave
  primaria en una tabla con 7 filas insertadas. Gratis.

---

## PARTE D — Por qué se degrada

### D.1 Qué cambia entre la primera y la cuarta vuelta

Dos cosas, y la primera es la grande.

**(a) El atasco del búfer.** En la vuelta 1 el búfer casi nunca llega a 50, así
que `flushBatches` devuelve `0 ms` — se ve en las siete veces que el fichero de
medición registra `vuelta=1 op=flushBatches ms=0`. Para la vuelta 3 o 4, los
cinco trabajadores llevan varios segundos acumulando y el `while` tiene que
vaciar todo lo pendiente de una sentada. **No es que una escritura se ponga
lenta: es que se hacen varias seguidas.**

Aritmética: `flushBatches ms=24829` con un máximo real de 6.599 ms por
sentencia SQL sólo cuadra con 4-6 tandas encadenadas. Y como cada tanda son
también ~4,5 MB de JSON que Node tiene que serializar y subir —trabajo que
**no** aparece en las estadísticas de Postgres— el tiempo del cliente es
siempre mayor que el del servidor.

**(b) La degradación real, que NO es por eslabón.** Aquí los datos contradicen
la premisa del encargo. Comparando las primeras 12 tandas con las de la 25 en
adelante, en las cuatro corridas de hoy:

```sql
with b as (
  select scan_id, created_at, row_number() over (partition by scan_id order by created_at) as n,
    extract(epoch from created_at - lag(created_at) over (partition by scan_id order by created_at)) as gap
  from (select distinct scan_id, created_at from public.scan_results where created_at >= '2026-08-10T17:00:00Z') d
)
select scan_id, count(*) as tandas,
  round(avg(gap) filter (where n <= 12)::numeric,2) as gap_medio_primeras12,
  round(avg(gap) filter (where n > 24)::numeric,2) as gap_medio_de_la_25_en_adelante,
  round(max(gap)::numeric,2) as gap_max
from b group by scan_id order by min(created_at);
```

| Corrida | Tandas | Primeras 12 | De la 25 en adelante | Peor |
|---|---|---|---|---|
| `a430e08a` | 42 | 3,81 s | **6,00 s** | 11,67 s |
| `a806f52f` | 50 | 2,66 s | **4,75 s** | 15,06 s |
| `de1acb31` | 48 | 2,48 s | **4,98 s** | 9,51 s |
| `37c7fb87` (la que falló a 1.786) | 36 | 2,37 s | **5,03 s** | 8,67 s |

**El ritmo se duplica en las cuatro corridas, sin excepción, y esas 36-50
tandas atraviesan siete eslabones distintos.** Si "cada eslabón empezara de
cero", el ritmo volvería a 2,4 s cada ~5 tandas. No lo hace.

Lo que sí se acumula durante la corrida es lo que se escribe: 1.786 filas × 28
KB = **~50 MB añadidos al TOAST en dos minutos**, sobre una memoria de caché de
Postgres de 256 MB (`shared_buffers = 32768` × 8 kB) que además comparte con
`daily_bars`. A medida que avanza, cada escritura encuentra menos cosas en
memoria.

### D.2 ¿Contención con otra cosa?

**Los cron no.** Los tres trabajos programados son semanales, domingos de
madrugada:

```sql
select jobid, schedule, command, active from cron.job order by jobid;
```

→ `0 3 * * 0` (borrado de `scans`), `0 3 * * 0` (`purge_daily_bars_backstop`),
`15 3 * * 0` (`vacuum daily_bars`). El 2026-08-10 fue lunes. **Ninguno se
solapó.**

**El sondeo del navegador tampoco**: son lecturas (`GET`), no escrituras.

**Pero sí hay contención, y viene del propio escaneo.** El mismo proceso está
escribiendo en `daily_bars` mientras escribe en `scan_results`:

```sql
select date_trunc('minute', updated_at) as minuto, count(*) as filas_daily_bars_escritas
from public.daily_bars
where updated_at >= '2026-08-10T21:14:00Z' and updated_at < '2026-08-10T21:19:00Z'
group by 1 order by 1;
```

| Minuto | Filas escritas en `daily_bars` |
|---|---|
| 21:15 | 438 |
| 21:16 | 37 |
| **21:17** | **2.019** |

21:17 es el minuto en el que murió el escaneo. Y `daily_bars` es la tabla con
peor comportamiento de caché de la base:

```sql
select relname, heap_blks_read, heap_blks_hit,
  round(100.0*heap_blks_hit/nullif(heap_blks_hit+heap_blks_read,0),1) as pct_cache
from pg_statio_all_tables
where schemaname in ('public','pg_toast') and relname in ('scan_results','pg_toast_33561','daily_bars');
```

| Tabla | Aciertos de caché |
|---|---|
| `pg_toast_33561` | 93,8% |
| `scan_results` | 90,9% |
| **`daily_bars`** | **84,9%** (588.831 bloques leídos de disco) |

Además, **el mantenimiento automático de Postgres corrió dentro de la ventana**:
autovacuum del TOAST a las **21:16:30**, autoanálisis de `scan_results` a las
**21:16:24** y de `scans` a las **21:17:24**. Los tres, dentro de los 2 min 22 s
que duró la corrida. Compiten por la misma memoria y el mismo disco.

### D.3 ¿Es simplemente falta de recursos?

**En parte sí, y hay que decirlo con claridad porque cambia qué hay que hacer.**

| Recurso | Valor | Comentario |
|---|---|---|
| `shared_buffers` | 32768 × 8 kB = **256 MB** | La memoria de trabajo de Postgres |
| `effective_cache_size` | 98304 × 8 kB = 768 MB | Lo que Postgres cree que hay disponible |
| `work_mem` | 3.500 kB | Muy justo |
| Tamaño de la base | **2.467 MB** | ~10× la memoria de caché |
| `max_connections` | 60 | |

La base es **casi diez veces mayor que la memoria que Postgres puede usar para
cachearla**. Eso es exactamente lo que describe la instancia Micro de 1 GB, y
es coherente con el 84,9% de `daily_bars` y con que el ritmo se degrade según
avanza la corrida.

**Pero no es *solo* eso, y por eso no lo doy como conclusión única.** Un
escaneo del universo completo escribiría ~890 MB de texto JSON y ~280 MB en
disco. Ninguna instancia razonable convierte eso en una operación que quepa
holgadamente por debajo de 8 segundos por tanda. Subir el cómputo sube el
techo; no cambia que se estén guardando 89 KB por acción, de los cuales 28 KB
están duplicados literalmente dentro de la misma fila.

---

## PARTE E — Conclusión

### E.1 La causa más probable

**El escaneo muere porque una tanda concreta de 50 filas supera el límite de 8
segundos por operación que Supabase aplica a todas las llamadas del producto, y
ese límite se alcanza porque cada fila pesa 89 KB de JSON.**

La cadena, con la evidencia de cada eslabón:

1. **Cada símbolo son ~89,2 KB de texto JSON** (`raw` 61.660 B + `metrics`
   27.577 B, medidos). De ellos, ~28 KB son `objectiveMetricAudit` +
   `decisionTrace`, **guardados dos veces en la misma fila**.
2. **Una tanda de 50 son ~4,46 MB de JSON** que Node serializa, sube, PostgREST
   parsea, Postgres comprime con `pglz` y escribe como ~1,4 MB repartidos en
   **~500 trozos TOAST** (142.382 trozos / 14.004 filas = ~10 por fila).
3. **Eso cuesta 1.340,7 ms de media dentro de Postgres, con máximo de 6.599 ms**
   (180 ejecuciones reales en `pg_stat_statements`), y el coste crece a lo largo
   de la corrida: el intervalo entre tandas se duplica de ~2,4 s a ~5,0 s en las
   cuatro corridas de hoy.
4. **El límite es 8 segundos**, no 120. `pg_settings` muestra 120000 ms para la
   sesión administrativa, pero las peticiones del producto entran por PostgREST
   con el rol `authenticator`, que tiene un ajuste propio a nivel de base de
   datos:

   ```sql
   select coalesce(r.rolname,'(todos)') as rol, s.setconfig
   from pg_db_role_setting s left join pg_roles r on r.oid = s.setrole;
   ```
   → `authenticator: ["session_preload_libraries=safeupdate", "statement_timeout=8s", "lock_timeout=8s"]`
   → `service_role: (sin override)` — es decir, **no lo levanta**.

   Que el máximo observado en TODA la base de datos sea de 6.950 ms, con varias
   sentencias distintas amontonadas en la franja 5,9-6,9 s, es exactamente lo
   que se espera de un techo en 8 s.
5. **El error guardado es literalmente ese**:
   ```sql
   select settings->'progress'->>'status', settings->'progress'->>'completed',
     left(settings->'progress'->>'error',400)
   from public.scans where id='37c7fb87-afd5-4143-829e-857876ca5e8d';
   ```
   → `error`, `1919` completados de `10000`,
   **`"canceling statement due to statement timeout"`**.
6. **Los 24,8 s y 20,3 s del informe de medición NO son la operación que muere.**
   Son `flushBatches` vaciando 5-6 tandas atascadas en su bucle `while`. La que
   mata es una tanda individual que cruza los 8 s. Coherente con la última fila
   guardada (21:17:25.898) y la marca de muerte del escaneo (21:17:39.490):
   13,6 s de hueco = subida del siguiente lote + 8 s de reloj agotado + registro
   del error.

**Y hay un agravante estructural de recursos** (D.3): la base ocupa 2.467 MB
contra 256 MB de caché, y el propio escaneo compite consigo mismo escribiendo
2.019 filas en `daily_bars` en el mismo minuto en que muere.

**Lo que queda descartado con evidencia:** no es un `upsert` (es `INSERT` sin
`ON CONFLICT`), no son los índices (5,4 MB en total, 90,9% en caché), no es un
índice sobre JSON (no existe), no es una comprobación de duplicados (solo hay
clave primaria sobre un UUID generado), no son disparadores (no hay ninguno en
`scan_results`), no es el `DELETE` de saneo del inicio del eslabón (0,2 ms de
media, 34 llamadas) y no son los cron (semanales, en domingo).

### E.2 Vías de arreglo (enumeradas, sin recomendar ninguna)

1. **Tandas más pequeñas.** Bajar `RESULT_BATCH_SIZE` de 50. Reduce el pico por
   operación, que es justo lo que roza el límite de 8 s. No reduce el trabajo
   total ni el tamaño en disco.
2. **Topar el bucle `while` de `flushBatches`.** Escribir como mucho N tandas
   por vuelta en vez de vaciar el atasco entero. No arregla el timeout, pero
   devuelve el control al bucle de progreso y a la detección de cancelación.
3. **Menos columnas / menos JSON por fila.** Tres sub-vías distintas:
   (a) eliminar la duplicación de `objectiveMetricAudit` y `decisionTrace`
   entre `raw` y `metrics` (~28 KB por fila, ~31% del peso, sin pérdida de
   información); (b) sacar `chartPreview` (21 kB) de la fila; (c) recortar
   `objectiveMetricAudit` y `decisionTrace` a lo que el producto lea de verdad.
4. **Retención.** Borrar resultados de escaneos antiguos. Hoy la fila más
   antigua es del 20 de junio y no hay nada que la borre. Reduce los 481 MB de
   TOAST y descongestiona la caché; no reduce el coste de una tanda concreta.
5. **Índices.** Se puede reducir de nueve a menos. Por los números medidos,
   comprarían muy poco.
6. **Compresión `lz4` en lugar de `pglz`** para las dos columnas JSONB. Menos
   CPU por escritura a cambio de algo más de disco.
7. **Subir el cómputo.** Salir de la instancia Micro de 1 GB. Sube el techo
   (más caché, más CPU, más disco), pero deja intacto el multiplicador de 89 KB
   por símbolo.
8. **Levantar el límite de 8 segundos** dando un `statement_timeout` propio al
   rol `service_role`. Es la vía que ataca directamente el mecanismo de muerte
   —y también la que deja al escaneo sin ningún freno si algo va mal de verdad.

---

## CONFIANZA

**Alta (medición directa, reproducible con las consultas citadas):**

- `flushBatches` escribe en una sola tabla, con un `INSERT` sin `ON CONFLICT`,
  dentro de un bucle `while` que vacía todo el búfer. Cita literal en A.1.
- Los tamaños: 61.660 B de `raw`, 27.577 B de `metrics`, 28 KB por fila
  almacenada, 481 MB de TOAST, 142.382 trozos, 14.004 filas, 76 escaneos.
- La duplicación de `objectiveMetricAudit` y `decisionTrace` entre `raw` y
  `metrics`.
- Los tiempos del `INSERT`: 180 llamadas, media 1.340,7 ms, máximo 6.599 ms.
- Los índices, su definición y su tamaño; que ninguno es sobre JSON; que la
  única restricción de unicidad es la clave primaria; que no hay disparadores.
- La degradación del ritmo dentro de cada corrida, en las cuatro corridas.
- Que ningún cron se solapó y que sí hubo autovacuum/autoanálisis dentro de la
  ventana.
- El mensaje de error guardado y los parámetros de la instancia.

**Media (inferencia sólida a partir de medidas, no observación directa):**

- **Que el límite efectivo son 8 s y no 120 s.** El ajuste
  `statement_timeout=8s` del rol `authenticator` está verificado, y que
  `service_role` no lo sobreescriba también. Lo que infiero es que ese valor
  sigue vigente tras el cambio de rol que hace PostgREST. Lo respalda que el
  máximo de toda la base sea 6.950 ms, pero **no lo he observado dispararse**.
- **Que los 24,8 s son 5-6 tandas encadenadas y no una sola escritura.** Se
  apoya en aritmética (24.829 ms frente a un máximo real de 6.599 ms por
  sentencia) y en el patrón del propio fichero de medición (`vuelta=1 ms=0`,
  `vuelta=2 ms=20320`). No hay instrumentación por tanda que lo demuestre.
- **El reparto entre trabajo del servidor y trabajo del cliente.**
  `pg_stat_statements` mide solo la ejecución SQL; serializar 4,46 MB en Node,
  subirlos y que PostgREST los parsee no aparece en ningún sitio. Sé que la
  diferencia existe; **no sé cuánto vale**.

**Baja:**

- El peso relativo exacto entre "falta de RAM" y "filas demasiado grandes".
  Ambos están medidos; su proporción, no.

---

## LO QUE NO HE VERIFICADO

1. **No he visto los registros de Postgres.** `get_logs` para el servicio
   `postgres` devolvió `FetchException: Failed to get project's logs`. Esos
   registros dirían **exactamente qué sentencia** fue cancelada y **a los
   cuántos milisegundos**. Es la única prueba que convertiría la inferencia del
   límite de 8 s en un hecho observado. Sin ella, sé que el error es un
   `statement timeout` (está guardado en la fila del escaneo) pero **deduzco**
   cuál es el umbral y cuál la sentencia.
2. **No he medido cuánto tarda Node en serializar y subir una tanda.** Es la
   pieza que falta para cuadrar del todo los 24,8 s. Requeriría instrumentar
   `supabaseRequest`, y este encargo es de diagnóstico.
3. **No he ejecutado ningún escaneo** ni he reproducido el fallo. Todo son
   datos de las corridas ya ocurridas.
4. **No he comprobado que bajar `RESULT_BATCH_SIZE` (u otra vía) arregle nada.**
   La sección E.2 enumera opciones; ninguna está probada.
5. **Las tandas de 49 y 46 filas** (A.2) no las he explicado. La hipótesis
   evidente es el `DELETE ... rank_index=gt.insertedCount` del inicio de cada
   eslabón (`lib/serverScanRunner.js:311-314`) borrando filas al retomar, pero
   **no lo he confirmado**, y si fuese otra cosa sería un problema de
   integridad de datos independiente de este.
6. **No he mirado la segunda consulta más cara sobre `scan_results`**
   (`SELECT rank_index, raw ...`, 259 llamadas, media 314,8 ms, **máximo
   6.720 ms** — también pegada al techo de 8 s). No forma parte de
   `flushBatches`, pero comparte el mismo riesgo y **queda sin analizar**.
7. **No he verificado el tamaño real de la instancia ni su CPU** por la API de
   gestión. Los 1 GB de RAM vienen del enunciado; lo que sí he medido son
   `shared_buffers` (256 MB), `effective_cache_size` (768 MB), `work_mem`
   (3.500 kB) y el tamaño de la base (2.467 MB), que son coherentes con esa
   descripción.
8. **No he comprobado si hay bloat (espacio muerto) significativo en el TOAST.**
   475 MB para 142.382 trozos da ~3,4 KB por trozo, cuando el máximo por trozo
   son ~2 KB: sugiere ~40% de espacio desaprovechado. **No lo he medido con una
   herramienta de bloat**, así que no lo cuento como hallazgo.
