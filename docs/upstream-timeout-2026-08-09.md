# "upstream request timeout": el escaneo muere ANTES de empezar — diagnóstico

<!-- fecha interna: 2026-08-09 · BASE_SHA: 659db14 · rama: codex/statsedge-ui-polish -->

Documento de **solo diagnóstico**. No se modificó ningún archivo de código, no
se escribió en Supabase y no se ejecutó ningún escaneo.

---

## Resumen para el dueño (sin jerga)

**El escaneo ya no muere analizando: muere antes de analizar nada.**

La secuencia real, reconstruida desde el código:

1. El navegador prepara el escaneo (universo, salud de mercado, vista previa) —
   todo eso funcionó.
2. Llama al servidor para **crear la ficha del escaneo** en la base de datos.
   Esa ficha lleva dentro la lista de los 10.234 símbolos (~91 KB).
3. **Esa escritura se quedó colgada.** El código no le pone ningún límite de
   tiempo, así que esperó hasta que la propia base de datos cortó por su lado
   y devolvió el texto `upstream request timeout`.
4. Ese texto viajó tal cual hasta el navegador, donde el traductor de mensajes
   lo convirtió en "El servidor tardó demasiado en responder".

Las tres diferencias que observaste se explican con esa misma secuencia:
- **No hay progreso**: "Escaneando todo el universo: 10234/10234" **no es un
  contador** — es un cartel fijo que se pone justo antes de llamar al servidor.
  El contador de verdad ("Analizando 305/10234") solo aparece cuando el
  navegador consigue preguntar por el progreso, y esta vez nunca llegó a
  hacerlo.
- **No quedó nada guardado**: si la ficha del escaneo nunca se creó, no hay
  dónde guardar filas. El intento anterior sí conservó 299 filas porque
  entonces la ficha **sí** se creó.
- **Tarda 3 minutos**: nadie corta antes. Ni el navegador ni el servidor ponen
  un tope a esa escritura.

**Dato importante y muy probablemente relacionado: mientras escribo esto,
Supabase está caído.** Siete consultas de solo lectura seguidas, sobre dos
tablas distintas y durante ~6 minutos, devolvieron todas el mismo error de
red (`522`, "el origen no responde"). El commit 659db14 es de las 18:30 UTC y
ahora son las 19:05 UTC, así que la caída que estoy midiendo cae dentro de la
misma franja horaria que tu escaneo fallido.

**Conclusión honesta**: el fallo está localizado con certeza (la creación de la
ficha del escaneo), pero **no puedo demostrar** si se colgó porque Supabase
estaba caído del todo o porque los ~91 KB de esa escritura concreta fueron
demasiado para una base ya degradada. Las dos lecturas están desarrolladas en
la Parte E, y no puedo desempatarlas sin poder consultar la base.

---

## PARTE A — Dónde muere ahora

### 1. De dónde sale exactamente "upstream request timeout"

**Primer hecho, medido: ese texto no existe en el repositorio.** Búsqueda
exhaustiva:
```
grep -rn "upstream" --include="*.js" --include="*.jsx" --include="*.json" --include="*.ts" .
  (excluyendo node_modules y .next)
→ tests/scanErrors.test.js:36:  expect(classifyProviderError(e("ETIMEDOUT upstream")).kind).toBe("retryable");
```
Un único resultado, en un test, sin relación. **Ninguna línea de código de la
aplicación genera ese mensaje** — por tanto lo produce una máquina externa
(una pasarela de red), no StatsEdge.

**No es un timeout del cliente.** `lib/clientApi.js:31-40` — `postJson`, la
función que usa el escaneo para llamar al servidor, **no acepta ni aplica
ningún tiempo máximo**:
```js
export async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: requestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
```
Compárese con `getJson` (`lib/clientApi.js:11-29`), que **sí** admite
`timeoutMs` y monta un `AbortController`. `postJson` no tiene ese mecanismo.

**Dónde nace el texto: es el timeout entre el SERVIDOR y SUPABASE.** La cadena
completa, citada línea a línea:

**Paso 1** — Supabase (tras su pasarela Cloudflare) responde con un código de
error y un cuerpo en texto plano. `lib/supabaseServer.js:66-78` lo convierte en
una excepción cuyo mensaje es *literalmente ese texto*:
```js
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text ? { message: text } : null;
  }
  if (!res.ok) {
    const error = new Error(data?.message || data?.hint || `Supabase HTTP ${res.status}`);
```
La línea clave es `data = text ? { message: text } : null;`: cuando la
respuesta **no es JSON** (un cuerpo de texto plano como `upstream request
timeout`), se empaqueta como `message`, y la línea siguiente lo usa como
mensaje de la excepción. Nótese que el respaldo `Supabase HTTP ${res.status}`
**no llega a usarse** en ese caso, porque `data.message` ya tiene valor.

**Paso 2** — `POST /api/scan` atrapa esa excepción y la reenvía al navegador
dentro de un JSON. `app/api/scan/route.js:73-75`:
```js
  } catch (error) {
    return Response.json({ ok: false, configured: true, error: error.message }, { status: 500 });
  }
```

**Paso 3** — `postJson` ve `data.error` y lanza con ese mismo texto
(`lib/clientApi.js:38`):
```js
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
```

**Paso 4** — el traductor de mensajes lo convierte en la frase que viste.
`lib/screenerFormat.js:87-90`:
```js
  {
    test: /\bETIMEDOUT\b|\btimed out\b|\btime-?out\b/i,
    message: "El servidor tardó demasiado en responder. Inténtalo de nuevo en unos minutos.",
  },
```
**Verificado ejecutando la expresión regular real** contra el texto real:
```
node -e 'console.log(/\bETIMEDOUT\b|\btimed out\b|\btime-?out\b/i.test("upstream request timeout"))'
→ true
```
Y el patrón anterior de la lista (el de PostgreSQL) **no** captura:
```
node -e 'console.log(/canceling statement due to statement timeout/i.test("upstream request timeout"))'
→ false
```
Es decir: la frase que viste en pantalla ("El servidor tardó demasiado en
responder") corresponde **exactamente** a este mensaje y no a otro. La cadena
queda cerrada de punta a punta.

**Respuesta directa a la pregunta**: no es un timeout del cliente (no existe),
ni de Next.js. Es el corte que hace **la pasarela de Supabase** sobre una
petición del servidor que tardó demasiado — y la aplicación lo repite tal cual
en vez de traducirlo en el servidor.

### 2. Qué petición se agota

`postJson("/api/scan", ...)`, en `app/page.jsx:1337-1342`:
```js
      const symbolList = symbols.map((item) => item?.symbol || item).filter(Boolean);
      const launched = await postJson("/api/scan", {
        symbols: symbolList,
        name: `Scan servidor ${new Date().toISOString()}`,
        preset: presetKey,
        settings: activeSettings,
      });
```
Y dentro de esa ruta, la operación concreta que se cuelga es la **creación de
la fila del escaneo** — `app/api/scan/route.js:34-62` (recorte):
```js
    const [saved] = await supabaseRequest("scans", {
      method: "POST",
      prefer: "return=representation",
      body: [{
        owner_id: config.ownerId,
        local_id: `server-scan-${crypto.randomUUID()}`,
        ...
        settings: {
          ...settings,
          rowsAreFilteredSnapshot: false,
          scanSymbols: symbols,
          ...
```
Es la única llamada a Supabase que hace `POST /api/scan` antes de responder, y
`scanSymbols: symbols` mete ahí dentro los 10.234 símbolos.

### 3. Límites de tiempo configurados en esa llamada

**Ninguno, en ninguna de las dos capas.**

- **Cliente**: `postJson` no admite tiempo máximo (citado en A.1).
- **Servidor**: la llamada de `app/api/scan/route.js:34` **no pasa
  `timeoutMs`**, y `supabaseRequest` solo monta un `AbortSignal` si se lo
  pasan. `lib/supabaseServer.js:51-52`:
```js
  const timeoutMs = Number(options.timeoutMs || 0);
  const signal = options.signal || (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined);
```
  Con `timeoutMs` ausente → `0` → `signal` queda `undefined` → **el `fetch` no
  tiene corte por tiempo propio**. Espera a que el otro lado responda o cierre.

Para contraste, otras partes del código **sí** ponen tope: `readDailyBarsCache`
usa `timeoutMs: Number(options.timeoutMs || DEFAULT_CACHE_READ_TIMEOUT_MS)`
(1500 ms, `lib/dailyBarsCache.js:7,278`) y `GET /api/scans` usa
`SCANS_SUPABASE_TIMEOUT_MS = 8000` (`app/api/scans/route.js:9`). La escritura
que nos ocupa es de las que **no** lo llevan.

Lo único declarado es `export const maxDuration = 300;`
(`app/api/scan/route.js:15`), que es un tope de la función serverless, no de
esta petición concreta — y en cualquier caso 300 s no coincide con los ~3
minutos observados (ver "LO QUE NO HE VERIFICADO").

### 4. ¿Es el lanzamiento del primer tramo o el sondeo del progreso?

**Es el lanzamiento (el POST), no el sondeo.** Dos pruebas independientes:

**Prueba 1 — el sondeo no puede lanzar ese error.** `app/page.jsx:1354-1376`:
```js
      while (!scanAbortRef.current) {
        let state = null;
        try {
          state = await getJson(`/api/scan?id=${encodeURIComponent(launched.scanId)}&offset=${resultOffset}`);
        } catch {
          await sleep(SERVER_SCAN_POLL_MS);
          continue;
        }
```
Si el sondeo falla, el `catch` **se traga el error y reintenta para siempre**
(`continue`). Nunca propaga nada, así que nunca podría haber producido el
mensaje que viste. Un fallo persistente de sondeo dejaría el escaneo colgado
indefinidamente, no fallando a los 3 minutos.

**Prueba 2 — el sondeo nunca llegó a ejecutarse con éxito.** El bucle está
*después* del `await postJson(...)`. Si el POST lanza, el flujo salta al
`catch` general de `run()` sin entrar nunca en el bucle. Y sabemos que ningún
sondeo tuvo éxito porque el cartel de estado no cambió (ver Parte B).

---

## PARTE B — Por qué ya no hay progreso visible

### 5. Qué cambió respecto al intento anterior

**No cambió el mecanismo de progreso: cambió hasta dónde llegó el escaneo.**

El texto que se quedó congelado, "Escaneando todo el universo: 10234/10234", es
un **cartel estático** que se escribe *antes* de llamar al servidor.
`app/page.jsx:1296-1301`:
```js
      } else if (fullUniverseScan) {
        setStatus(hadVisibleRows
          ? `Escaneando todo el universo: ${symbols.length}/${base.length} acciones. Tabla visible congelada.`
          : `Escaneando todo el universo: ${symbols.length}/${base.length} acciones. Puedes detenerlo si tarda demasiado.`);
      }
```
Los dos números **no son "hechos / totales"**: son `symbols.length` (lo que se
va a analizar: 10.234) y `base.length` (el universo cargado: 10.234). Salen
iguales porque en modo "Todo el universo" se analiza todo lo cargado. Por eso
se lee "10234/10234" y por eso **nunca avanza**: no está contando nada.

El contador de verdad, "Analizando 305/10234", vive en otra función,
`publishPartial` (`app/page.jsx:1331`):
```js
        setStatus(`${verb} ${completed}/${symbols.length}${currentSymbol ? `: ${currentSymbol}` : ""} · pasan ${partialView.rows.length} · errores ${bad.length}${frozenNote}`);
```
y **solo se invoca desde dentro del bucle de sondeo, después de una respuesta
correcta** (`app/page.jsx:1371`: `publishPartial(true, state.progress?.currentSymbol || "")`).

Conclusión: en el intento anterior el POST funcionó, el sondeo respondió y por
eso apareció "Analizando 305/10234". Esta vez el POST falló, el bucle nunca se
ejecutó, y el cartel estático se quedó a la vista. **No es una regresión del
indicador de progreso; es el síntoma de morir antes.**

### 6. ¿Tiene que ver con el cambio de fuente de datos (659db14)?

**No, en lo que respecta a la petición que falla.** Razones:

- 659db14 **no tocó `app/api/scan/route.js`**. Verificado:
  `git show --stat 659db14` lista solo `lib/serverScanRunner.js` y sus tests.
  La ruta que crea la ficha del escaneo es byte por byte la misma que en el
  intento anterior.
- El cambio actúa dentro de `runScanChunk`, y esa función se ejecuta en
  `after(...)` — es decir, **después** de que el POST haya respondido
  (`app/api/scan/route.js:67-72`):
```js
    if (symbols.length <= INLINE_SCAN_SYMBOL_LIMIT) {
      await runFirstChunk();
    } else {
      after(runFirstChunk);
    }
    return Response.json({ ok: true, configured: true, scanId: saved.id, ... }, { status: 202 });
```
  Con 10.234 símbolos (> `INLINE_SCAN_SYMBOL_LIMIT`, que vale 20 en la línea
  16) se usa la rama `after`, así que el trabajo del escaneo ni siquiera había
  arrancado cuando se produjo el fallo.
- Tampoco altera el ritmo de escritura del progreso: eso lo gobiernan
  `FLUSH_INTERVAL_MS` y el bucle de persistencia de `lib/serverScanRunner.js`,
  que 659db14 no modificó.

**Matiz honesto que sí conviene registrar**: 659db14 cambia *quién recibe la
carga*. Antes, analizar un símbolo eran ~5 llamadas a Yahoo y ~0 lecturas a
Supabase; ahora son ~2 lecturas a Supabase por símbolo. Eso **multiplica la
presión sobre Supabase** durante el escaneo. No explica este fallo (que ocurre
antes, y en una escritura, no en las lecturas), pero es contexto relevante si
resulta que Supabase estaba degradado — ver Parte E.

### 7. Código que produce el mensaje y de dónde saca los números

Ya citado en B.5: `app/page.jsx:1296-1301` para el cartel congelado
("10234/10234"), y `app/page.jsx:1331` para el contador real
("Analizando N/10234"). El origen de los números:
- `symbols` viene de `const symbols = selected(base);` (`app/page.jsx:1277`),
  que en modo `"all"` devuelve el universo entero.
- `base` viene de `universe` (estado del navegador) o de `loadUniverse(...)`
  (`app/page.jsx:1273`).
- `completed` (el que sí avanza) se actualiza **solo** desde la respuesta del
  servidor: `if (Number.isFinite(state.progress?.completed)) completed = state.progress.completed;`
  (`app/page.jsx:1367`).

---

## PARTE C — Por qué no queda nada guardado

### 8. Por qué el intento anterior conservó 299 filas y este ninguna

Porque **las filas de resultados cuelgan de la ficha del escaneo**, y esta vez
la ficha no llegó a existir.

El orden en `app/api/scan/route.js` es estricto: primero se crea la fila en
`scans` (línea 34-62), y solo si eso funciona (`if (!saved?.id) throw new
Error("No se pudo crear la fila del scan");`, línea 63) se lanza el trabajo que
escribe en `scan_results`. Y cada fila de resultado exige el identificador de
esa ficha — `resultPayload` la incluye como `scan_id`
(`lib/serverScanRunner.js:66`), y el esquema la declara obligatoria con clave
foránea (`supabase/schema.sql:27`):
```sql
  scan_id uuid not null references scans(id) on delete cascade,
```
Sin ficha no hay `scan_id`, y sin `scan_id` no puede guardarse ni una fila. Por
eso "Auditoría de filtros" dice "sin scan".

En el intento anterior (documentado en
[`docs/limite-600-scan-2026-08-09.md`](limite-600-scan-2026-08-09.md)) la ficha
**sí** se creó — quedó registrada como `scans.id =
6fb4e02f-9aca-4825-b1c4-bac22b93d0ee` con `row_count: 299` — porque entonces el
POST completó su escritura y el escaneo llegó a procesar dos tramos.

### 9. DATOS REALES: ¿existe la fila de este intento?

**No he podido comprobarlo: Supabase está caído.** Esto no es una limitación de
alcance sino un hecho medido, y es en sí mismo el hallazgo más relevante de
esta parte.

Consultas ejecutadas (todas de solo lectura), en orden:
```
supabase_query(table="scans", select="id,local_id,name,row_count,market_regime,created_at,updated_at",
               filter="created_at=gte.2026-08-09T00:00:00Z", order="created_at.desc", limit=40)
→ ERROR PostgREST 522 · "Error 522: Connection timed out" ·
  "Cloudflare could not establish a TCP connection to the origin server."

(misma consulta, reintento)                        → ERROR 522
supabase_query(table="scans", select="id", limit=1) → ERROR 522
(misma consulta de scans, tercer reintento)        → ERROR 522
supabase_query(table="app_settings", select="setting_key", limit=1) → ERROR 522
supabase_query(table="scans", select="id,local_id,row_count,created_at",
               filter="created_at=gte.2026-08-09T18:00:00Z", ...) → ERROR 522
```
**Siete intentos consecutivos, repartidos a lo largo de ~6 minutos, sobre dos
tablas distintas (`scans` y `app_settings`), incluyendo la consulta más pequeña
posible (`select=id&limit=1`) — todos con el mismo error 522.** Que falle
incluso la consulta mínima descarta que sea un problema de tamaño o de la
tabla: **el proyecto entero no responde a nivel de red.**

**Correlación temporal, con las horas exactas**: el commit 659db14 está fechado
el `Sun Aug 9 20:30:40 2026 +0200` (= 18:30 UTC, de `git show`), y estas
consultas se ejecutaron alrededor de las **19:05 UTC** (`date -u`). Tu escaneo
ocurrió entre ambos momentos. Es decir, **la caída que estoy midiendo cae dentro
de la misma franja horaria que el escaneo que falló** — no puedo probar que
fuera continua durante todo el intervalo, pero la coincidencia es directa y no
es una suposición sobre el pasado: es una medición del presente.

### 10. Si la fila no existe, el fallo es previo al trabajo — ¿se confirma?

**Se confirma que el fallo es previo a cualquier análisis, sí — pero conviene
precisar dónde, porque la conclusión natural del enunciado no es del todo
exacta.**

El enunciado sugería que, si no hay ficha, habría que mirar la *preparación*
(cargar el universo, por ejemplo). **La preparación del navegador queda
descartada por el propio cartel de estado**: para que se muestre "Escaneando
todo el universo: 10234/10234", el código ya tuvo que pasar por la salud de
mercado, la carga del universo y la vista previa (`app/page.jsx:1270-1301`) —
ese cartel es la última instrucción antes del POST. Además, ninguna de esas
tres puede provocar este error (Parte D.11: dos tienen tope de tiempo y las
tres capturan sus fallos sin propagarlos).

Así que la respuesta precisa es: **el fallo ocurre después de la preparación y
antes del análisis — exactamente en la primera escritura a la base de datos, la
que crea la ficha del escaneo.** Es el punto más temprano posible del lado del
servidor. Sí cambia dónde hay que buscar, pero no hacia la carga del universo:
hacia esa escritura.

---

## PARTE D — Qué tarda tres minutos

### 11. Operaciones de preparación, con su coste y su tope

En orden de ejecución dentro de `run()` (`app/page.jsx:1270-1342`):

| # | Operación | Código | ¿Tope de tiempo? | ¿Puede provocar este fallo? |
|---|---|---|---|---|
| 1 | Salud de mercado | `loadMarketHealth()` → `getJson("/api/market-health", { timeoutMs: MARKET_HEALTH_TIMEOUT_MS })` (`app/page.jsx:1031`) | **Sí, 5 s** (`app/page.jsx:72`) | **No.** Captura su propio error y devuelve `null` (`app/page.jsx:1035-1038`). |
| 2 | Cargar universo | `loadUniverse()` → `getJson("/api/universe?markets=...")` (`app/page.jsx:1223`) | **No** | **No.** Captura y devuelve `[]` (`app/page.jsx:1234-1237`). Además **suele saltarse**: solo corre si `universe` no está ya en memoria (`app/page.jsx:1273`). |
| 3 | "Preparando cache..." | `loadCachedScreenerPreview()` → `getJson("/api/leaderboards?...", { timeoutMs: CACHE_PREVIEW_TIMEOUT_MS })` (`app/page.jsx:1183`) | **Sí, 3,5 s** (`app/page.jsx:71`) | **No.** `catch { return { rows: [], ... } }` (`app/page.jsx:1194-1196`). |
| 4 | Elegir símbolos | `selected(base)` (`app/page.jsx:1277`) | N/A | **No.** Cálculo en memoria, sin red. |
| 5 | **Crear la ficha del escaneo** | `postJson("/api/scan", ...)` (`app/page.jsx:1337`) → INSERT en `scans` (`app/api/scan/route.js:34`) | **NO, en ninguna capa** (Parte A.3) | **Sí. Es la única candidata.** |

**El patrón salta a la vista**: las tres operaciones de preparación tienen tope
de tiempo y/o capturan sus errores, así que ninguna puede colgar el escaneo ni
propagar un mensaje. La única llamada del camino que **ni tiene tope ni captura
el error** es precisamente la que crea la ficha.

### 12. Qué hace "Preparando cache..." y por qué no es la culpable

Es el paso 3 de la tabla: `setStatus("Preparando cache...")` en
`app/page.jsx:1274`, seguido de `loadCachedScreenerPreview(activeSettings)`
(línea 1276), que pide al servidor una vista previa ya calculada
(`GET /api/leaderboards`) para enseñar algo mientras el escaneo real avanza.

**No puede ser lo que tarda 3 minutos**, por dos razones citadas:
`{ timeoutMs: CACHE_PREVIEW_TIMEOUT_MS }` con `CACHE_PREVIEW_TIMEOUT_MS = 3500`
(3,5 s) la corta, y su `catch` devuelve una lista vacía sin propagar nada.
De hecho, **sabemos que devolvió vacío**: si hubiera traído filas, el estado
mostrado sería "Cache precalculada lista (N)..." (`app/page.jsx:1288-1293`) en
vez del cartel de "Escaneando todo el universo" que efectivamente se vio.

### 13. ¿Añadió 659db14 alguna operación previa que antes no existiera?

**En el camino que falla (el POST y su escritura), no.** Ya razonado en B.6:
`git show --stat 659db14` confirma que solo tocó `lib/serverScanRunner.js` y
sus tests; `app/api/scan/route.js` no cambió, y el trabajo del runner corre en
`after(...)`, después de responder.

**En el escaneo en su conjunto, sí cambió el reparto de carga**, y merece
quedar anotado aunque no explique este fallo: cada símbolo pasó de ~5 llamadas
externas a Yahoo a ~2 lecturas contra Supabase
(`withDailyBarsCache`/`withProfileCache`, `lib/serverScanRunner.js:293-294`).
Para un tramo de 300 símbolos eso son ~600 lecturas a Supabase donde antes
había ~0. Insisto: eso ocurre *después* del punto de fallo, así que no lo
causa; pero si la base está degradada, es carga adicional sobre el mismo
componente que ya no responde.

---

## PARTE E — Alcance

### 14. ¿A partir de qué tamaño empieza a fallar?

**No puedo dar un umbral fiable, y prefiero decirlo antes que inventarlo.** Lo
que sí puedo aportar es la magnitud que escala, calculada con bytes ya medidos
en producción (`docs/timeout-scan-universo-2026-08-09.md`: 44.575 bytes para
5.864 símbolos ≈ 7,6 bytes/símbolo, más ~15.096 bytes del resto de `settings`):

| Símbolos | `scanSymbols` | `settings` completo | Ida + vuelta del INSERT (`return=representation`) |
|---|---|---|---|
| 100 | ~1 KiB | ~15 KiB | ~31 KiB |
| 300 | ~2 KiB | ~17 KiB | ~34 KiB |
| 1.000 | ~7 KiB | ~22 KiB | ~44 KiB |
| 5.000 | ~37 KiB | ~52 KiB | ~104 KiB |
| **10.234** | **~76 KiB** | **~91 KiB** | **~181 KiB** |

(Cálculo aritmético sobre bytes medidos, no una medición nueva.)

El lote de 100 que sí funciona mueve ~31 KiB; el universo completo, ~181 KiB
— unas **6 veces más**. Es un salto real, pero **6× no es el tipo de salto que
normalmente convierte una escritura de milisegundos en un cuelgue de 3
minutos** contra una base sana. Por eso no me atrevo a fijar un umbral: si la
causa fuera puramente el tamaño, esperaría ver degradación progresiva
(1.000 y 5.000 símbolos tardando cada vez más), y no tengo esa medición.

**Las dos lecturas posibles, sin desempatar:**

- **(a) Supabase estaba caído o muy degradado.** Entonces el tamaño es
  irrelevante: la escritura se habría colgado con 100 o con 10.234, y el lote
  de 100 funcionó simplemente porque se probó en otro momento. A favor: la
  caída total que estoy midiendo ahora (Parte C.9), en la misma franja horaria.
- **(b) La base estaba degradada y los ~181 KiB fueron la gota.** Una escritura
  6× mayor tiene 6× más probabilidad de superar el límite de una pasarela que
  ya va justa. A favor: encaja con que 100 símbolos sí funcione de forma
  reproducible.

En ambos casos el arreglo apunta al mismo sitio (esa escritura sin tope de
tiempo), pero **el diagnóstico no está cerrado**, y decirlo importa: si es (a),
no hay nada que arreglar en el escaneo y volverá a funcionar solo.

### 15. ¿Es el tamaño del universo o el número de símbolos a analizar?

**Es el número de símbolos a ANALIZAR**, no el universo cargado. La distinción
es real y el código la hace explícita.

Lo que viaja en la petición y acaba dentro de la ficha es `symbols`, no `base`:
- `app/page.jsx:1336-1338`: `const symbolList = symbols.map(...)` → `postJson("/api/scan", { symbols: symbolList, ... })`
- `app/api/scan/route.js:45`: `scanSymbols: symbols,`

Y `symbols` sale de `selected(base)` (`app/page.jsx:1277`), que **recorta**
según el modo elegido (`app/page.jsx:1240-1246`):
```js
  function selected(u) {
    const list = [...u];
    if (scanMode === "random") return shuffle(list).slice(0, scanBatchSize);
    const spread = spreadByInitial(list);
    const start = Math.max(0, Math.min(batchStart, Math.max(0, spread.length - 1)));
    if (scanMode === "all") return spread;
    return spread.slice(start, start + scanBatchSize);
  }
```

En consecuencia: **cargar 10.234 símbolos en el navegador para analizar solo
100 no debería disparar este fallo** — el universo grande se queda en memoria
del navegador y la petición solo lleva los 100 (~31 KiB, la fila de la tabla de
E.14). Es exactamente el caso que, según reportas, funciona en 15-20 s.

Lo que dispara el fallo es elegir "Todo el universo", porque solo entonces
`symbols.length === base.length === 10.234` y la escritura sube a ~181 KiB.
Esto también explica por qué el cartel congelado muestra dos números iguales
(Parte B.5): son precisamente esas dos magnitudes, que solo coinciden en ese
modo.

---

## CONFIANZA

- **Alta** — que "upstream request timeout" no lo genera el código de la
  aplicación (A.1): búsqueda exhaustiva con un único resultado irrelevante en
  un test.
- **Alta** — la cadena completa por la que ese texto acaba en pantalla como "El
  servidor tardó demasiado en responder" (A.1, pasos 1-4): cada eslabón citado
  literalmente, y la coincidencia del patrón verificada **ejecutando** la
  expresión regular real contra el texto real (`true`), además de comprobar que
  el patrón de PostgreSQL **no** captura (`false`).
- **Alta** — que ni el cliente ni el servidor ponen tope de tiempo a esa
  escritura (A.3): citadas las dos funciones y la línea exacta donde el
  `AbortSignal` queda `undefined`.
- **Alta** — que el fallo es el POST y no el sondeo (A.4): el `catch` del
  sondeo hace `continue` sin propagar, así que es estructuralmente incapaz de
  producir este error.
- **Alta** — que "10234/10234" es un cartel estático y no un contador (B.5,
  B.7): citadas las dos funciones distintas que escriben cada mensaje.
- **Alta** — que sin ficha en `scans` no puede guardarse ninguna fila (C.8):
  clave foránea obligatoria citada del esquema.
- **Alta** — que Supabase está inalcanzable **ahora mismo** (C.9): siete
  consultas, dos tablas, ~6 minutos, incluida la mínima posible; todas 522.
- **Alta** — que 659db14 no tocó la ruta que falla (B.6, D.13): `git show
  --stat` lo confirma.
- **Media** — que la caída de Supabase sea **la** causa del incidente (E.14,
  opción (a)): la correlación horaria es directa y medida, pero no puedo
  demostrar que la caída fuera continua desde tu escaneo hasta ahora, ni
  descartar la opción (b).
- **Media** — la reconstrucción de que Supabase devolvió el texto en un cuerpo
  no-JSON (A.1, paso 1): es la única ruta del código que produce ese mensaje
  exacto, pero no vi la respuesta HTTP real; el error 522 que sí observé viene
  acompañado de un cuerpo JSON, no de texto plano, así que el cuerpo concreto
  que recibió tu escaneo pudo ser otro distinto del que yo veo hoy.
- **Baja** — el umbral de símbolos a partir del cual falla (E.14): no medido, y
  explícitamente no estimado.

## LO QUE NO HE VERIFICADO

- **Si existe la fila de este intento en `scans`** — la pregunta central de la
  Parte C.9. No pude consultarla: Supabase devolvió 522 en los siete intentos.
  Es la comprobación que cerraría el diagnóstico, y debería repetirse en cuanto
  la base vuelva: si la fila **no** existe, confirma todo lo anterior; si
  existe con `row_count: 0`, significaría que la escritura sí completó y habría
  que buscar el cuelgue en otro punto del POST.
- **El cuerpo HTTP exacto que Supabase devolvió durante tu escaneo** — la
  reconstrucción de A.1 es la única compatible con el mensaje observado, pero
  no tengo la traza de red de aquel momento. Los logs de la función en Vercel
  lo confirmarían de inmediato.
- **Por qué exactamente ~3 minutos** — no coincide ni con `maxDuration = 300`
  (5 min) ni con el tope de 60 s que otros documentos del repo atribuyen al
  plan Hobby (`docs/overhead-scan-2026-08-05.md`). Sospecho que es el tiempo de
  espera de la pasarela de Supabase/Cloudflare, pero no lo he verificado, y el
  "~3 minutos" es además una apreciación tuya, no un cronómetro.
- **Si la caída de Supabase fue continua** entre tu escaneo (posterior a las
  18:30 UTC) y mis consultas (~19:05 UTC) — solo he medido el presente.
- **Si el lote de 100 símbolos seguiría funcionando ahora mismo** — con la base
  caída, presumiblemente no; pero no lo he probado (la tarea prohíbe ejecutar
  escaneos), así que no puedo usar eso para desempatar entre (a) y (b) de E.14.
- **El comportamiento con tamaños intermedios** (1.000, 5.000 símbolos) — sería
  lo que permitiría fijar un umbral real y distinguir "problema de tamaño" de
  "base caída"; no medido.
- **Si `after(...)` puede retrasar el envío de la respuesta en Vercel** — asumo
  la garantía documentada de Next.js (la respuesta se envía primero y el
  trabajo diferido corre después). No lo he comprobado contra el
  comportamiento real de la plataforma.
