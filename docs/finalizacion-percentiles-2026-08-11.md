# Por qué muere la finalización de percentiles al 98%

Fecha: 2026-08-11. BASE_SHA: `b930f23` (rama `codex/statsedge-ui-polish`).

**Documento de diagnóstico. No se ha modificado ningún archivo de código, no se
ha escrito nada en Supabase, no se ha ejecutado ningún escaneo y no se ha hecho
commit ni push.** Todas las consultas son de solo lectura.

Escaneo analizado: `758dcea8-5e5b-4d52-ba17-e9210e806ac7`, "Scan servidor
2026-08-10T23:17:26.333Z". 10.000/10.000 símbolos completados, 9.920 filas
guardadas, `finalizationStatus: "failed"`,
`finalizationError: "canceling statement due to statement timeout"`.

---

## Resumen para el dueño (sin jerga)

Los dos arreglos de ayer funcionaron: el escaneo ya no muere guardando
resultados. Llegó al 100% de los símbolos y guardó las 9.920 filas. **Pero
justo al final hay un paso más — poner los resultados en su ranking definitivo
(los "percentiles")** — y ese paso murió con el mismo error de siempre:
Postgres le cortó la operación a los 8 segundos.

Ese paso final son en realidad **dos operaciones separadas**, una detrás de
otra:

1. **Leer** las 9.920 filas para traerse los datos que hacen falta para
   calcular el ranking.
2. **Escribir** el resultado del ranking en esas mismas 9.920 filas, de una
   sola vez.

No tengo forma de ver, con las herramientas que tengo, cuál de las dos fue
exactamente la que Postgres canceló — los registros internos de la base de
datos no están accesibles con estas credenciales, ya me pasó lo mismo ayer.
Pero por cómo está hecho el código, **la escritura es la sospechosa principal**:
para escribir tiene que releer el contenido viejo de cada fila (27,5 KB de
media), fusionarlo con el resultado nuevo, comprimirlo y volver a guardarlo —
y eso son **unos 272 MB de texto movidos en una sola instrucción, sin
posibilidad de pararla a mitad**. La lectura del primer paso también mueve
mucho (unos 470 MB, porque lee dos columnas por fila en vez de una), pero es
solo lectura: no tiene que comprimir ni escribir nada, que es la parte más
lenta en cualquier base de datos.

**La buena noticia, y es la que cambia el enfoque:** esta operación **no es
indivisible por su naturaleza**. El cálculo del ranking sí necesita ver las
9.920 filas a la vez (no puedes saber tu percentil sin conocer a los demás),
pero eso es un cálculo rápido en memoria, no lo que tarda. Lo que sí se puede
trocear — escribir el resultado en la base de datos fila por fila o en
tandas — es justo la parte que hoy se hace toda de golpe. **Trocear la
escritura no exige rehacer el cálculo del ranking.**

---

## PARTE A — Qué hace la finalización

### A.1 Cita completa de `finalizeScanResultsInDb`

`lib/scanPercentileFinalization.js`, la función orquestadora (la que hace las
llamadas a Supabase; hay otra función pura, `finalizeScanPercentiles`, que solo
calcula en memoria y se cita en la Parte B):

```js
export async function finalizeScanResultsInDb(scanId, ownerId, options = {}) {
  if (!scanId || !ownerId) {
    throw new Error("finalizeScanResultsInDb: scanId y ownerId son requeridos");
  }
  const maxRows = Number.isFinite(options.maxRows) ? options.maxRows : FINALIZE_MAX_ROWS;

  // 1. Carga las filas del scan vía la RPC scan_finalize_inputs (thin-raw
  //    projection) en vez de transferir metrics/raw completos. ...
  const rpcPayload = await supabaseRpc("scan_finalize_inputs", {
    p_owner_id: ownerId,
    p_scan_id: scanId,
    p_max_rows: maxRows,
  });
  const rows = Array.isArray(rpcPayload)
    ? (rpcPayload[0]?.inputs || [])
    : (rpcPayload?.inputs || []);
  if (!Array.isArray(rows) || !rows.length) {
    const rowsRead = Array.isArray(rpcPayload) ? (rpcPayload[0]?.rowsRead || 0) : (rpcPayload?.rowsRead || 0);
    return { rowsProcessed: rowsRead, rowsPatched: 0 };
  }

  // 2. Recomputa percentiles en memoria (pure).
  const patches = finalizeScanPercentiles(rows, {
    minGlobalSample: options.minGlobalSample,
    minScopedSample: options.minScopedSample,
  });
  if (!patches.length) {
    return { rowsProcessed: rows.length, rowsPatched: 0 };
  }

  // 3. Aplicación ATÓMICA: una sola RPC a finalize_scan_results (PL/pgSQL).
  //    La función Postgres envuelve el UPDATE masivo en una transacción; si
  //    revierte, ninguna fila queda tocada. ...
  const rpcResult = await supabaseRpc(
    "finalize_scan_results",
    {
      p_owner_id: ownerId,
      p_scan_id: scanId,
      p_patches: patches.map(({ id, metrics_patch }) => ({ id, metrics_patch })),
    },
    { prefer: "return=representation" },
  );

  const updatedCount = Array.isArray(rpcResult) && rpcResult.length
    ? Number(rpcResult[0].updated_count || 0)
    : Number((rpcResult && rpcResult.updated_count) || 0);

  return { rowsProcessed: rows.length, rowsPatched: Number.isFinite(updatedCount) ? updatedCount : patches.length };
}
```

**Dos RPC a Supabase, en serie, con el cálculo en memoria en medio:**

1. `scan_finalize_inputs` — LEE.
2. (en memoria, sin red) `finalizeScanPercentiles` — calcula.
3. `finalize_scan_results` — ESCRIBE.

### A.2 El DDL de las dos RPC

**`scan_finalize_inputs`** — la versión vigente en producción es la de
`supabase/migrations/20260807140000_scan_finalize_inputs_objective_setup_score.sql`
(confirmado contra la base real con `pg_get_functiondef`, coincide). Es
`language sql`, `stable` — **una consulta de solo lectura**:

```sql
create or replace function public.scan_finalize_inputs(
  p_owner_id text,
  p_scan_id uuid,
  p_max_rows integer default 50000
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with limited as materialized (
  select
    sr.id, sr.symbol, sr.country, sr.sector, sr.theme,
    sr.metrics, sr.raw, sr.rank_index
  from public.scan_results as sr
  where sr.owner_id = p_owner_id
    and sr.scan_id = p_scan_id
  order by sr.rank_index asc
  limit greatest(1, least(coalesce(p_max_rows, 50000), 50000))
), projected as (
  select
    l.id, l.rank_index,
    jsonb_build_object(
      'symbol', l.symbol,
      'country', coalesce(nullif(l.raw ->> 'country', ''), nullif(l.country, '')),
      -- ... 24 claves en total: grouping keys, inputs de rsRawComposite,
      -- scores planos para contradicciones/composite, signalCoverage entero.
      -- Cada una: coalesce(finite_number(raw->'campo'), finite_number(metrics->'campo'))
    ) as raw_thin
  from limited as l
)
select jsonb_build_object(
  'inputs',
  coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'raw', p.raw_thin) order by p.rank_index, p.id)
    from projected as p
  ), '[]'::jsonb),
  'rowsRead',
  (select count(*)::integer from limited)
);
$$;
```

**Qué hace:** un `SELECT` sobre `scan_results` filtrado por `owner_id` +
`scan_id`, que **lee `sr.raw` y `sr.metrics` completas de cada fila** (son la
entrada del `coalesce(...)` de cada campo — Postgres tiene que descomprimir
ambas columnas TOAST enteras para poder extraer 24 valores sueltos de ellas) y
devuelve un JSON compacto con solo esos 24 campos por fila. Sin `LIMIT` real
(el límite es 50.000, muy por encima de las 9.920 filas del scan). **No
escribe nada.**

**`finalize_scan_results`** — `supabase/schema.sql:302-350`. Confirmado
idéntico contra producción con `pg_get_functiondef`. Es `language plpgsql` —
**una escritura**:

```sql
create or replace function public.finalize_scan_results(
  p_owner_id text,
  p_scan_id uuid,
  p_patches jsonb
)
returns table(updated_count integer)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.scans
    where id = p_scan_id and owner_id = p_owner_id
  ) then
    raise exception 'scan % no pertenece al owner %', p_scan_id, p_owner_id
      using errcode = '21000';
  end if;

  return query
  with source as (
    select *
    from jsonb_to_recordset(coalesce(p_patches, '[]'::jsonb)) as item(
      id uuid,
      metrics_patch jsonb
    )
  ),
  touched as (
    update public.scan_results as sr
    set metrics = sr.metrics || src.metrics_patch
    from source as src
    where sr.id = src.id
      and sr.scan_id = p_scan_id
      and sr.owner_id = p_owner_id
    returning 1
  )
  select count(*)::integer from touched;
end;
$$;
```

**Qué hace:** recibe un array JSON con `{id, metrics_patch}` por fila (9.920
elementos), lo convierte en filas con `jsonb_to_recordset`, y hace **UN SOLO
`UPDATE`** que, para cada una de las 9.920 filas, **lee el `metrics` que ya
tenía esa fila, lo fusiona (`||`) con el patch nuevo, y escribe el resultado**.
Todo dentro de una única sentencia SQL, dentro de una única transacción
implícita de PL/pgSQL.

### A.3 ¿Cuántas operaciones son?

**Tres pasos, dos de ellos contra la base de datos**, en serie:

1. Un `SELECT` (lectura de las 9.920 filas, `scan_finalize_inputs`).
2. Un cálculo en memoria, en Node, sin tocar la red (`finalizeScanPercentiles`).
3. Un `UPDATE` (escritura de las 9.920 filas, `finalize_scan_results`).

No hay una tercera llamada a Supabase. No es "una que lee todo y otra que
escribe todo" en el sentido de dos operaciones simétricas — son de naturaleza
distinta, como se ve en la Parte C: la de leer trae más *columnas* por fila,
la de escribir hace más *trabajo* por fila.

### A.4 ¿Cuál se agota?

**No lo puedo determinar de forma directa.** Lo intenté por dos vías:

- **`pg_stat_statements`**: solo hay una llamada registrada de cada RPC en
  toda la base, y ambas son rápidas (298 ms la de `scan_finalize_inputs`, 104
  ms la de `finalize_scan_results`) — pero corresponden a **escaneos pequeños
  anteriores que sí completaron** (el de 99 filas, el de 50), no al de 9.920
  que falló. Una sentencia cancelada por `statement_timeout` no queda
  registrada con su tiempo real en `pg_stat_statements` — se puede ver en que
  la cuenta de actualizaciones de la tabla (ver más abajo) confirma que el
  `UPDATE` de esta corrida **nunca llegó a comprometer ni una fila**, y sin
  embargo no aparece ninguna entrada nueva ni en la del `SELECT` ni en la del
  `UPDATE` para este scan.
- **Registros de Postgres**: `get_logs` para el servicio `postgres` sigue sin
  funcionar (`FetchException: Failed to get project's logs`), igual que ayer.
  Esos registros dirían exactamente qué sentencia fue cancelada.

Lo que sí pude confirmar por estadísticas de la tabla:

```sql
select relname, n_live_tup, n_dead_tup, n_tup_upd, n_tup_hot_upd, last_autovacuum
from pg_stat_all_tables where relname = 'scan_results';
```
→ `n_tup_upd: 99, n_tup_hot_upd: 25` — **solo 99 actualizaciones en toda la
tabla desde el 2026-08-09** (cuando se resetearon las estadísticas). Eso
confirma que **el `UPDATE` masivo de 9.920 filas, si llegó a ejecutarse, se
revirtió entero** — ni una fila de esta corrida quedó comprometida (coherente
con `percentilesFinalized: false` en la fila del scan). Pero esto no distingue
si el `UPDATE` empezó y se canceló a mitad, o si nunca llegó a lanzarse porque
el `SELECT` anterior ya había muerto.

**Determinación por el código, tal como pide el punto 4 (ver Parte C para las
cifras exactas):** el `UPDATE` es la sospechosa más probable, porque **hace
más trabajo por fila que el `SELECT`**, no porque toque más filas — ambas
tocan las mismas 9.920. La diferencia es de naturaleza: escribir obliga a
Postgres a descomprimir el valor viejo, fusionarlo, comprimirlo de nuevo y
escribirlo con registro de transacciones (WAL) — trabajo que un `SELECT` de
solo lectura no hace nunca. Ver Parte C.9 para la cifra.

---

## PARTE B — Por qué es indivisible, o no

### B.1 Lo que sí es indivisible: el cálculo

**Correcto: un percentil no se puede calcular fila por fila.** Necesita
conocer el valor de las 9.920 filas para poder decir "esta fila está por
encima del 73% de las demás". Eso es un hecho matemático, no una limitación
del código.

### B.2 Las dos fases están YA separadas — y una de ellas es barata

Aquí es donde el código ya hace lo que la Parte B del encargo pregunta si se
podría hacer. **Ya están separadas, y de hecho han estado separadas desde que
existe este módulo** (ver la cabecera de `lib/scanPercentileFinalization.js`,
"PURE: sin Supabase, sin IO"):

- **CALCULAR** es `finalizeScanPercentiles` (línea 63 del archivo) — una
  función marcada explícitamente como *pure*: recibe las 9.920 filas ya en
  memoria (las que trajo el `SELECT`), calcula sectorScore, los 3 percentiles
  RS, el composite y las contradicciones de señales, y devuelve un array de
  `{id, metrics_patch}`. **No toca la red ni la base de datos.** Es rápido:
  operaciones aritméticas y de ordenación sobre 9.920 objetos en memoria de
  Node, del orden de decenas a un par de cientos de milisegundos, no
  segundos — no lo he medido con el dato real de 9.920 filas, pero no hay
  ninguna llamada de red ni operación bloqueante dentro de esta función.
- **APLICAR** es el `UPDATE` de `finalize_scan_results` — la única parte que
  escribe.

**La fase cara de calcular ya solo necesita ejecutarse UNA vez** (necesita ver
las 9.920 filas juntas), y ya lo hace. **La fase de aplicar, que es la que
escribe, no tiene ninguna razón matemática para ser una sola sentencia**: cada
fila se actualiza de forma independiente de las demás — el patch de la fila
`AAPL` no depende de haberse escrito ya el patch de `TSLA`.

### B.3 Cita de que ya hace ambas cosas por separado

Ya citado en A.1 y B.2: son las líneas 2 y 3 de `finalizeScanResultsInDb`
(`finalizeScanPercentiles(rows, ...)` seguido, en otra llamada distinta, de
`supabaseRpc("finalize_scan_results", ...)`). Lo que **no** está separado es
la ESCRITURA en sí: `finalize_scan_results` recibe el array completo de 9.920
patches y los aplica **todos en una única sentencia SQL**, dentro de una única
llamada RPC. Ahí es donde el troceo actual se detiene.

---

## PARTE C — Cuánto trabajo es

### C.1 Filas y columnas (medido sobre el escaneo real que falló)

```sql
select count(*) as filas,
  round(avg(pg_column_size(metrics))) as metrics_medio_bytes,
  round(avg(octet_length(metrics::text))) as metrics_texto_bytes,
  round(avg(pg_column_size(raw))) as raw_medio_bytes,
  round(avg(octet_length(raw::text))) as raw_texto_bytes
from public.scan_results where scan_id = '758dcea8-5e5b-4d52-ba17-e9210e806ac7';
```

| | Valor |
|---|---|
| Filas | **9.920** |
| `metrics`, texto JSON | 27.473 bytes |
| `metrics`, comprimido en disco | 7.609 bytes |
| `raw`, texto JSON | 19.928 bytes |
| `raw`, comprimido en disco | 9.251 bytes |

(El `raw` ya viene reducido por el cambio de ayer — es coherente con la
medición previa de ~20,8 KB comprimidos antes de esa poda.)

**`scan_finalize_inputs` lee ambas columnas de cada fila** (`sr.metrics, sr.raw`
en el `SELECT`, y el `coalesce()` de cada campo extrae de las dos):
19.928 + 27.473 = **47.401 bytes de texto por fila**, ×9.920 filas ≈
**470 MB** de JSON que Postgres tiene que descomprimir y parsear para sacar 24
valores sueltos de cada fila.

**`finalize_scan_results` solo toca `metrics`** en el `UPDATE` (`set metrics =
sr.metrics || src.metrics_patch`) — no lee ni escribe `raw`. Pero para
fusionar tiene que descomprimir el `metrics` VIEJO completo de cada fila:
27.473 bytes de texto × 9.920 ≈ **272,5 MB**, y después volver a comprimir y
escribir el resultado.

### C.2 Confirmación del punto 9 del encargo

**Confirmado, con la cifra exacta**: 27.473 bytes/fila × 9.920 filas =
**272.531.360 bytes ≈ 272,5 MB** de JSON de `metrics` que el `UPDATE` tiene que
leer (descomprimir), fusionar y volver a escribir (comprimir). Es la magnitud
correcta que planteaba el encargo. En disco, comprimido, son ~7.609 × 9.920 ≈
**75,5 MB** — pero el trabajo de CPU (descomprimir + parsear JSON + fusionar +
volver a comprimir) escala con el tamaño de texto sin comprimir, no con el
tamaño en disco.

### C.3 ¿Puede escribir menos?

**Sí, de varias formas, sin cambiar qué se calcula:**

- **Columnas propias en vez de JSON.** Los tres percentiles (`rsGlobalPct`,
  `rsCountryPct`, `rsSectorPct`) y `sectorScore` ya tienen equivalente directo
  en columnas de tipo `numeric` en el propio `scan_results`
  (`supabase/schema.sql:24-43`: `rs_rating numeric` existe; `sector_score`,
  `objective_score`, `composite_score` NO existen como columnas hoy, viven
  solo dentro de `metrics`). Un `UPDATE ... SET rs_rating = ...` sobre una
  columna `numeric` no tiene que descomprimir ni recomprimir 27 KB de JSON:
  toca unos pocos bytes fijos. El patch actual, en cambio, hace
  `sr.metrics || src.metrics_patch`, que obliga a mover el `metrics` COMPLETO
  aunque el patch en sí sea pequeño — es la operación `||` de jsonb la que es
  cara, no el tamaño del patch.
- **El patch en sí ya es pequeño.** El `metrics_patch` que construye
  `finalizeScanPercentiles` (líneas 156-176 del archivo) son ~15 claves
  (`rsGlobalPct`, `rsGlobalSample`, `rsCountryPct`, `rsCountrySample`,
  `rsSectorPct`, `rsSectorSample`, `sectorScore`, `groupStrengthScore`,
  `objectiveScore`, `compositeScore`, `totalScore`, `percentileScope`,
  `signalContradictions`, `contradictionsSkipped`) — del orden de unos
  cientos de bytes a un par de KB por fila, muy por debajo de los 27,5 KB de
  `metrics` entero. El problema no es el tamaño del dato NUEVO: es que la
  operación `||` de Postgres tiene que traer el jsonb VIEJO completo a memoria
  para fusionarlo.

---

## PARTE D — Las opciones (sin recomendar ninguna)

**1. Trocear la fase de escritura en tandas.**
Qué se toca: solo `finalize_scan_results` — llamarla varias veces con
sub-arrays de `patches` (p.ej. de 500 en 500) en vez de una vez con las 9.920.
Qué cuesta: cada llamada sigue haciendo el mismo `||` caro por fila, pero
repartido en múltiples sentencias de 8 s cada una en vez de una sola. Riesgo:
se pierde la atomicidad actual ("o las 9.920 se actualizan o ninguna") — el
propio comentario del código la señala como ventaja deliberada frente al
patrón anterior de PATCH por fila (`docs`/cabecera de
`lib/scanPercentileFinalization.js`: *"el patrón anterior... dejaba filas en
estado mixto"*). Volver a trocear reintroduce ese riesgo salvo que se añada
lógica de reintento/reanudación.

**2. Separar el cálculo de los cortes de su aplicación.**
Qué se toca: nada — **ya está separado** (Parte B.2/B.3). Lo único que no está
separado es la escritura EN SÍ, que es la opción 1.

**3. Mover los percentiles a columnas propias.**
Qué se toca: el DDL de `scan_results` (añadir columnas `numeric`), la RPC
`finalize_scan_results` (UPDATE sobre columnas en vez de jsonb merge) y los
lectores que hoy leen `metrics.rsGlobalPct` etc. (`scanDecisionRowFromDb` y
otros, fuera del alcance de este documento). Qué cuesta: es el cambio más
profundo — toca escritura Y lectura, y un esquema de columnas nuevo. Riesgo:
mayor superficie de cambio, pero es la única opción que reduce el trabajo por
fila en vez de solo repartirlo en el tiempo.

**4. Calcularlos al vuelo al leer, sin persistirlos.**
Qué se toca: eliminar el paso de finalización entero; calcular percentiles en
el momento de servir `/api/scans` (o donde se lean). Qué cuesta: recalcular
sobre el universo completo en cada lectura, potencialmente más caro
acumulado si se lee más veces de las que se escribe. Riesgo: cambia el
contrato de "percentileScope: final" (hoy es un estado persistido y
verificable; con cálculo al vuelo deja de ser un hecho guardado) y las
contradicciones de señales (C1-C6) también dependen de `rsGlobalPct` final —
habría que recalcularlas también al vuelo o aceptar que queden basadas en el
percentil de lote.

**5. Otra: reemplazar el `||` completo por `jsonb_set` de las claves
concretas.**
En vez de `sr.metrics || src.metrics_patch` (que trae TODO `metrics` a memoria
para fusionarlo), usar `jsonb_set` encadenado sobre las ~15 claves concretas
del patch. Qué se toca: solo la sentencia SQL dentro de `finalize_scan_results`.
Qué cuesta: menos que la opción 3 (no cambia el esquema), pero **no está claro
que ahorre nada real** — `jsonb_set` sobre una sola clave de un documento
grande sigue exigiendo a Postgres reconstruir el documento entero en memoria
porque jsonb no admite edición parcial en disco (el mismo límite que ya
documentó `docs/timeout-tres-minutos-2026-08-10.md` para `jsonb_set` sobre
`settings`). Riesgo: cambio de bajo esfuerzo pero de beneficio incierto sin
medirlo.

**6. Subir el `statement_timeout` para `service_role` en esta operación
concreta.**
Qué se toca: un ajuste de rol o un `SET LOCAL statement_timeout` dentro de la
función. Qué cuesta: nada de reescritura. Riesgo: es la vía que ataca el
síntoma, no la causa — y con un universo de 10.234 símbolos creciendo, el
próximo tope (sea 8 s, 20 s o 60 s) se volvería a alcanzar más adelante si el
tamaño de `metrics` por fila también crece.

### D.12 — ¿Alguna opción ya está medio hecha?

**Sí — la Parte A ya lo mostró: el troceo de LECTURA (opción "separar
cálculo de aplicación") ya existe**, y de hecho la RPC `scan_finalize_inputs`
se ha extendido dos veces sin tocar el código JS
(`20260710184308_scan_finalize_sector_composite_inputs.sql` añadió 5 campos
para el composite; `20260807140000_scan_finalize_inputs_objective_setup_score.sql`
añadió `objectiveSetupScore`). Es la prueba de que **extender la proyección
de lectura es un patrón ya practicado y de bajo riesgo** en este código: no
requiere tocar `lib/scanPercentileFinalization.js`, solo el `SELECT`. Eso no
es lo mismo que decir que el troceo de ESCRITURA (que es la opción 1 y la
sospechosa principal del fallo) esté empezado — no lo está: `finalize_scan_results`
sigue siendo una única sentencia desde que existe.

---

## PARTE E — Conclusión

### E.1 Causa exacta y evidencia

**La finalización de percentiles es una operación de dos pasos —lectura y
escritura, contra 9.920 filas cada uno— y AL MENOS uno de los dos, casi con
toda certeza el de escritura, cruza el límite de 8 segundos que aplica a toda
llamada del producto contra Supabase.**

Evidencia que sostiene esto:

1. **El error guardado es literal**: `finalizationError: "canceling statement
   due to statement timeout"`, el mismo patrón que ya se diagnosticó ayer para
   la escritura de resultados — mismo mecanismo, sitio distinto.
2. **El volumen de trabajo es real y medido, no estimado**: 9.920 filas ×
   27.473 bytes de `metrics` en texto = 272,5 MB que el `UPDATE` tiene que
   descomprimir, fusionar y volver a comprimir en una sola sentencia, sin
   posibilidad de parar a mitad. El `SELECT` mueve aún más bytes brutos
   (~470 MB, porque lee `raw` + `metrics`), pero es trabajo de solo lectura,
   estructuralmente más barato por byte que una escritura con generación de
   WAL y recompresión TOAST.
3. **La tabla confirma que el `UPDATE`, si llegó a correr, no comprometió
   nada**: `n_tup_upd: 99` acumulado en toda la tabla desde el 2026-08-09,
   nada atribuible a esta corrida de 9.920 filas. Coherente con
   `percentilesFinalized: false`.
4. **No puedo señalar con certeza CUÁL de los dos pasos fue el que Postgres
   canceló.** `pg_stat_statements` no tiene ninguna entrada de tamaño
   compatible con esta corrida para ninguna de las dos RPC (solo hay
   ejecuciones antiguas, rápidas, de escaneos pequeños que sí completaron), y
   `get_logs` para el servicio `postgres` sigue sin responder. Por eso la
   determinación del punto 4 del encargo es por código y por volumen de
   trabajo (el `UPDATE` hace más trabajo por byte que el `SELECT`), no por
   observación directa del fallo.

**Sobre si es indivisible: NO lo es, y esto cambia el enfoque tal como pedía
el encargo.** El cálculo de los percentiles (que sí necesita ver las 9.920
filas juntas) ya está separado de su aplicación, desde siempre, en el código
actual — es la función pura `finalizeScanPercentiles`. Lo que no está
troceado es la escritura del resultado: hoy es una única sentencia SQL para
9.920 filas. Trocear esa escritura no exige rehacer el cálculo del ranking:
el ranking ya está calculado en memoria antes de que empiece a escribirse
nada.

---

## CONFIANZA

**Alta:**
- El contenido literal de `finalizeScanResultsInDb`, `finalizeScanPercentiles`
  y las dos RPC citadas — confirmado contra el código del repo y, para las
  RPC, contra la definición real desplegada en producción
  (`pg_get_functiondef`).
- Que las fases de CALCULAR y de APLICAR ya están separadas en el código.
- El tamaño real de `raw` y `metrics` de las 9.920 filas del escaneo que
  falló, y el cálculo de 272,5 MB / 470 MB derivado de esas medidas.
- Que el `UPDATE` de esta corrida no comprometió ninguna fila
  (`n_tup_upd: 99` acumulado, nada de esta corrida).
- Que ninguna migración redefine `finalize_scan_results` después de
  `schema.sql`, y que `scan_finalize_inputs` en producción coincide con la
  versión de `20260807140000` (la más reciente).

**Media:**
- **Que el `UPDATE` es el que se agota, y no el `SELECT`.** Es una inferencia
  razonada por volumen de trabajo (escribir es estructuralmente más caro que
  leer para un volumen de bytes comparable) y por el hecho de que ninguna de
  las dos operaciones dejó rastro directo, pero **no es una observación**.
  Podría ser el `SELECT`.

**Baja:**
- Cuánto tarda realmente `finalizeScanPercentiles` (el cálculo puro en
  memoria) con 9.920 filas reales. No lo he medido; solo argumento que no
  implica red ni I/O bloqueante, así que no debería ser el cuello de botella,
  pero es una suposición sobre rendimiento de Node, no una medición.

---

## LO QUE NO HE VERIFICADO

1. **No he visto los registros de Postgres.** `get_logs` para `postgres`
   volvió a fallar (`FetchException: Failed to get project's logs`), igual
   que en el diagnóstico de ayer. Es, otra vez, la única prueba que
   convertiría "casi con toda certeza es el `UPDATE`" en un hecho observado
   en vez de una inferencia por volumen de trabajo.
2. **No he medido el tiempo real de `scan_finalize_inputs` ni de
   `finalize_scan_results`** sobre un conjunto de 9.920 filas — no puedo
   ejecutar SQL de prueba que dure varios segundos contra producción sin
   arriesgarme a repetir el propio timeout que se está diagnosticando, y la
   tarea pide no escribir en Supabase. Los 272,5 MB / 470 MB son cálculos de
   volumen de datos, no mediciones de tiempo de ejecución.
3. **No he medido cuánto tarda `finalizeScanPercentiles` (el paso puro, en
   Node) con 9.920 filas reales.** Es una suposición razonada, no una
   medición, que decir que no es el cuello de botella.
4. **No he comprobado si `jsonb_set` encadenado (opción 5 de la Parte D) es
   realmente más barato que `||`** en la versión de Postgres 17.6 que corre
   esta base. Lo señalo como incierto en la propia opción.
5. **No sé si otro proceso escribía en `scan_results` en la misma ventana**
   (23:33:44-23:33:54). No repetí aquí la comprobación de contención con
   `daily_bars`/autovacuum que hice ayer para el otro incidente; sería el
   siguiente paso natural si hiciera falta profundizar.
6. **No he verificado el coste real de `n_tup_hot_upd` vs `n_tup_upd`** para
   entender si las 25 actualizaciones "HOT" que sí hay en la tabla vienen de
   esta corrida o de otra — son demasiado pocas (25 de 9.920) para ser
   relevantes de cualquier forma, pero no lo he rastreado símbolo a símbolo.
7. **No he estimado el coste de mover los percentiles a columnas propias**
   (opción 3) más allá de describir qué se tocaría. No hay una medición de
   cuánto bajaría el tiempo del `UPDATE` con ese cambio.
