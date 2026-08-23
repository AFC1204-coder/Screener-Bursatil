# El screener, usado de verdad: por qué enseña el 16 de agosto, por qué cada clic cuesta segundo y medio, y por qué el deterioro da cero — 2026-08-23

Base: `codex/statsedge-ui-polish` @ `980856b` (HEAD, árbol limpio). Solo análisis; ningún cambio de código.

## Método

- Instancia aislada: árbol de `980856b` exportado con `git archive` al scratchpad, `node_modules`
  enlazado, servidor propio en **:3500** con `.env.local` filtrado (sin `CRON_SECRET` /
  `STATSEDGE_ACCESS_TOKEN` / `STATSEDGE_SESSION_SECRET`). Cero scans ejecutados, cero fichas
  abiertas, cero escrituras mías en Supabase (solo la caché operativa que el propio servidor
  escribe al navegar, como en uso normal). El servidor (PID 55413) se cerró por PID exacto al
  terminar; puerto 3500 verificado libre.
- Supabase: consultas de **solo lectura** (PostgREST vía MCP y SQL directo). Cada cifra de base
  lleva su consulta exacta.
- Mediciones de navegador con la API de rendimiento (resource timing, `PerformanceObserver` de
  longtasks, `MutationObserver` sobre la tabla) y sondas DOM. El panel embebido estuvo **oculto a
  ratos** (`document.visibilityState === "hidden"`): las métricas usadas (red, longtasks,
  mutaciones DOM, contadores internos del pipeline) no dependen del repintado, pero los tiempos
  "hasta que se ve" son cotas superiores — está anotado caso por caso y en LO QUE NO HE VERIFICADO.
- Tiempos absolutos de `next dev` local con webpack: valen como cota de forma (dónde espera el
  usuario, qué proporción pesa cada fase), no como latencia de producción.

Etiquetas: **[MEDIDO]** cifra tomada en vivo · **[REPRODUCIDO]** visto en el navegador ·
**[CÓDIGO]** afirmación con cita · **[SUPABASE]** consulta de solo lectura · **[INFERIDO]**
mecanismo derivado sin traza completa.

---

## El resumen en cinco líneas

1. La pantalla del dueño no es un fallo raro: es el **comportamiento normal del arranque**. Con
   sesión guardada, la app **no hace ninguna petición de datos** — restaura la copia local y su
   fecha, para siempre. No existe caducidad. [REPRODUCIDO+CÓDIGO]
2. Su copia local es del **16 de agosto** (la última vez que su navegador bajó datos de la nube,
   con el código anterior al universo completo): 500 filas **top de ranking**. Sobre esas 500, el
   preset de deterioro da **0 por aritmética**: ninguna llega a deterioro ≥ 55 (máximo: 31).
   [SUPABASE]
3. El cambio al universo completo del 17-08 **no está revertido** (está en HEAD), pero hoy **solo
   vive una visita**: el primer arranque baja 3.309 filas; la siguiente recarga degrada la
   población a la muestra local de ~576 (el 17%) **sin avisar**. [MEDIDO+REPRODUCIDO]
4. La lentitud tiene dos números: arranque frío con **dos descargas de 27 MB en paralelo** (dev) y
   **1,3–1,5 s de hilo bloqueado por CADA gesto** (preset, orden, filtro de vista) porque el
   cliente recalcula las 68 reglas por fila en vez de leer lo que el nocturno ya dejó calculado.
   [MEDIDO]
5. "Reset sesión" **sí cura** la frescura (2,9–24 s), pero borra los criterios del usuario, y la
   cura dura hasta la siguiente recarga (punto 3). [MEDIDO]

---

# PARTE A — Por qué muestra datos viejos

## A1. De dónde sale lo que ve: sesión persistida, y nada más

Dos claves de `localStorage` [CÓDIGO: `lib/localState.js:1-13`]:

| Clave | Contenido | Tamaño observado |
|---|---|---|
| `statsedge.screenerSession.v1` (v4) | criterios + **referencia** al scan (`scanRef: {id, count}`) + `scanContext` con su fecha | 13,6 KB |
| `statsedge.scans.v1` | las filas: **una muestra repartida** del último scan bajado (el universo no cabe: ~25 M de caracteres frente a 4,5 M de presupuesto) | 4,50 MB |

El arranque (`app/page.jsx:547-664`): si `session.version === 4`, restaura TODO de localStorage —
incluida la fecha de la cabecera, que es `session.scanContext.scannedAt` persistido
(`app/page.jsx:596` → `ScreenerShell.jsx:235`). La sesión no trae filas: se rehidrata buscando
`scanRef.id` en la copia local (`app/page.jsx:571-584`) y recalcula las visibles con los criterios
de la sesión.

**Verificado en vivo** [MEDIDO]: arranque con sesión presente → las únicas peticiones son
`/api/auth/session`, `/api/weekly-changes`, `/api/coverage` y la cinta de índices.
**`/api/scans` no aparece**. La cabecera pintó "10 pasan · 576 analizadas · scan 23 ago, 06:02"
con la fecha y el contador salidos de localStorage, no de ninguna consulta.

La única vía que consulta la nube es `restoreLatestSnapshot()` (`app/page.jsx:470`), y solo se
llama si la restauración no recuperó **ninguna** fila (`app/page.jsx:641-643`):

```js
restoredRowsCount = restoredRows.length || restoredAnalyzedRows.length;   // :585
...
if (!restoredRowsCount) restoreLatestSnapshot(...);                        // :641
```

Con 500 analizadas y 0 visibles, `restoredRowsCount` = 500 → **no va a la nube**. Exactamente el
estado del dueño: "0 resultados · 0 pasan · 500 analizadas".

## A2. Por qué dice 500: el cambio no se revirtió; su navegador nunca lo estrenó

- El cambio del 17-08 **está en la rama**: `f8a7bb2` ("perf(arranque): el screener carga el
  universo completo", 2026-08-17 18:24) es ancestro de HEAD; `STARTUP_ROWS_LIMIT = 6000` vive en
  `lib/cloudSyncClient.js:284` y no queda ningún `rowsLimit=500` en el código. [CÓDIGO]
- Cronología que fabrica su pantalla [CÓDIGO git + SUPABASE]:
  - 15-08 21:32 (`c13b8d7`): entra la sesión v4 "por referencia" (`scanRef` + copia local).
  - 16-08 00:56 (`daa5999`): fuera el botón Ejecutar; el filtro se aplica solo.
  - 16-08 ≈05:58 (hora local): nocturno US del 16. Su navegador lo bajó **con el transporte
    antiguo** (`rowsLimit=500`, que cogía las 500 primeras por `rank_index`) y guardó esa copia.
  - 17-08 18:24: el transporte pasa al universo completo — pero su arranque, desde entonces,
    **nunca vuelve a pedir datos** (A1), así que la copia de 500 del 16 sigue siendo su mundo.
- La correspondencia de la hora está verificada con el caso de hoy: el nocturno del 23 corrió a las
  04:01:59 UTC y la pantalla dice "scan 23 ago, 06:02" (UTC+2). Un nocturno del 16 a las 03:58 UTC
  es "16 ago, 05:58". Los nocturnos corren cada noche entre 03:55 y 04:01 UTC [SUPABASE]:

```
tabla scans · filter local_id=like.materialized:US:* · order created_at.desc
2026-08-23 04:01:59  3309 filas     2026-08-19 03:57:59  3312 filas
2026-08-22 03:55:09  3309           2026-08-18 03:56:35  3315
2026-08-21 04:01:26  3307           2026-08-17 04:01:37  3312
2026-08-20 03:57:56  3310           (el del 16 YA NO EXISTE: retención de 7 noches)
```

- Detalle que remata el cuadro: el scan del 16 **ya ni está en la nube** (solo se conservan 7
  nocturnos). No importa para su pantalla — la restauración por `scanRef` busca en la copia local
  (`app/page.jsx:576`), jamás en la nube — pero significa que "lo que está viendo" no existe ya en
  ningún sitio más que en su navegador.

## A3. No hay caducidad de sesión — y esa es la causa

**No existe TTL.** `session.updatedAt` se escribe en cada guardado y **no se lee nunca** para
invalidar. Las únicas puertas de la restauración son `version === 4` (`app/page.jsx:554`) y el
contrato de capas v2 (`lib/screenerFilterLayers.js:35-41`). Ninguna compara fechas; ninguna
comprueba si hay un nocturno más nuevo. [CÓDIGO, rama completa `app/page.jsx:547-664` leída]

Consecuencia verificada en vivo con el mismo mecanismo [REPRODUCIDO]: una sesión que referencia el
scan X restaura el scan X con su fecha **indefinidamente**, sin red. En el navegador del dueño,
X = 16 de agosto; hoy es 23; sin intervención manual seguirá siendo 16 de agosto en septiembre.

**Y hay una segunda pata, peor que la sesión vieja** [MEDIDO, reproducido dos veces]: aunque el
arranque baje el universo completo, dura UNA visita.

```
arranque en frío (sin sesión)  → GET /api/scans (27 MB) → "56 pasan · 3309 analizadas"  ✓
   (la sesión se guarda con scanRef {id, count: 576}; la copia local es una muestra de 576)
recarga (con sesión)           → CERO peticiones      → "10 pasan · 576 analizadas"    ✗
```

La rehidratación por `scanRef` entrega **la muestra repartida de 576 filas** (17,4% del universo)
como población de filtrado, y así se queda: cada recarga posterior parte de ahí. El aviso de
"muestra repartida" que sí pinta la vía `restoreLocalSnapshot` (`app/page.jsx:486-500`) **no
existe en esta vía**: `snapshotNotice` se restaura tal cual de la sesión (null si se guardó desde
estado de nube). El usuario filtra sobre el 17% del universo sin ninguna señal de ello — la
cabecera dice "576 analizadas" junto a un KPI de sidebar que dice "3309 universo"
[REPRODUCIDO, ambos a la vez en pantalla].

Es decir: **la promesa del 17-08 ("filtrado sobre la población entera") hoy solo se cumple en el
primer arranque tras limpiar sesión o tras Reset.** El resto de la vida del producto se filtra
sobre la muestra — o, en el caso del dueño, sobre las 500 top del 16 de agosto.

## A4. "Reset sesión": resuelve, con dos peros

Medido con instrumentación de storage y red [MEDIDO]:

| t | Acción |
|---|---|
| +3 ms | `removeItem("statsedge.screenerSession.v1")` (única clave borrada) |
| +30 ms | `GET /api/scans?includeRows=1&limit=1&rowsLimit=6000&anchor=nightly-us` |
| +6,3 s | respuesta: 27 MB, 3.309 filas (server frío; 2,9 s con caché de 2 min caliente; hasta 21 s bajo contención) |
| +7,0 s | reescribe `statsedge.scans.v1` (4,50 MB, muestra de 576) |
| +8,7 s | reescribe la sesión nueva |
| — | cabecera: "56 pasan · 3309 analizadas" — coincide con `passedScreen: 56` del nocturno en la base ✓ |

Los dos peros:

1. **Cura la frescura al precio de la configuración**: resetea preset a `balanced`, mercados,
   orden, capas, filtros de vista y búsqueda (`app/page.jsx:923-972`). Para "ver datos de hoy" el
   usuario paga con su criterio.
2. **La cura dura una visita** (A3): la siguiente recarga vuelve a la muestra de 576. Y si la
   petición de nube falla (el timeout del proveedor sigue apareciendo: "[scans] error del
   proveedor: The operation was aborted due to timeout" en el log de hoy, con recuperación interna
   a 10,8 s), `restoreLocalSnapshot` repinta la copia local vieja — en el caso del dueño, los 500
   del 16, con un aviso "Copia local". [CÓDIGO `app/page.jsx:478-517` + log]

---

# PARTE B — Por qué es lento

Todos los tiempos son de `next dev` local (webpack); la **forma** es lo extrapolable. Máquina: el
Mac del proyecto. Con el panel oculto a ratos, los tiempos "hasta pintar" son cotas superiores;
los de red, longtask y cómputo interno del pipeline no dependen de la visibilidad.

## B5-B7. Las fases, separadas

**Arranque en frío** (localStorage limpio, caché de servidor expirada — el sábado por la mañana
del dueño) [MEDIDO]:

| Fase | Tiempo | Detalle |
|---|---|---|
| `/api/scans` en el servidor | 5,7–11,7 s | 4 páginas PostgREST + RS semanal + serialización; 189 ms cacheado (TTL 2 min) |
| `/api/scans` hasta el navegador | 13,9 s | 27 MB sin comprimir en dev (27.001 KB medidos) |
| …duplicada por StrictMode (solo dev) | 21,3 s | **dos** descargas de 27 MB en paralelo en cada arranque dev |
| `/api/weekly-changes` (51 KB) | 14,0 s ×2 | compite con los 27 MB en el mismo pipe |
| `/api/coverage` | 9–10 s ×2 | |
| Cinta de índices | ~24 × `/api/chart` | 90–250 ms cada una (caché) |
| **Total hasta tabla con datos** | **≤ 36 s** (cota medida; la primera respuesta de scans llegó a t=15,7 s) | |

- El desarrollo diario del dueño es `next dev` (:3000): esta ES su experiencia, con el doble
  StrictMode incluido. En producción no hay doble efecto y hay gzip (2,7 MB), pero la estructura
  (una petición grande + un servidor que tarda 5-12 s en frío) es la misma.
- **Escritura en almacenamiento**: tras la respuesta, ~0,6 s de proyección+muestreo+escritura de
  los 4,5 MB [MEDIDO: hueco entre fin de red (6,3 s) y `setItem` (7,0 s) en el Reset].

**Arranque templado** (sesión presente — el arranque diario real): sin red de datos; la tabla
sale de localStorage. Es rápido (≤14 s con compilación dev de por medio; la fase de datos son
~1-2 s) — pero es rápido **porque no carga los datos**: población 576 (A3). La app hoy elige
entre fresco-y-lento o rápido-y-congelado, sin decírselo a nadie.

## B8. Qué cuesta cada gesto — y por qué

El dato central [MEDIDO, tres gestos distintos]:

| Gesto | Hilo bloqueado (longtask) | Población | Red |
|---|---|---|---|
| Cambiar preset (Balanceado → Deterioro) | ~1,3 s (contador visible <300 ms; `lastFilterMs` interno **1.332 ms**; el propio producto imprime "filtro aplicado en 1.33s" / "1.46s") | 3.309 | 0 |
| Cambiar orden (select Ordenar) | **una longtask de 1.499 ms** que arranca en el mismo instante del change; no re-filtra (`lastFilterMs` intacto) | 3.309 | 0 |
| Filtro de vista (Fuerza grupo: Débiles) | 1.502 + 299 ms; h2 actualizado a los 2,3 s | 3.309 | 0 |
| Cambiar preset con la población degradada | `lastFilterMs` = **126 ms** | 576 | 0 |

De aquí salen las tres respuestas:

1. **"Va lento en general"**: cada gesto sobre el universo completo bloquea el hilo ~1,3–1,5 s.
   Durante ese tiempo no hay scroll, ni hover, ni feedback. No es red (0 peticiones): es cómputo
   síncrono en el hilo principal.
2. **"Varía mucho según el filtro"**: no varía por el filtro — varía por la **población** (3.309
   frente a 576/500 según de qué restauración vengas: ~0,4 ms/fila lineales) y por si el gesto
   re-filtra (preset: sí) o solo re-deriva la vista (orden: también acaba costando ~1,5 s, ver
   abajo). El mismo clic puede costar 0,15 s o 1,5 s según el día — eso se percibe como azar.
3. **¿Recalcula en vez de leer un campo guardado? Sí, todo.** `filterAnalyzedRows`
   (`lib/screenerPipeline.js:114-167`) ejecuta por fila y en cada gesto: quality gate + motor
   compartido de 68 reglas (`lib/screenerFilters.js:732-800`) + régimen + post-filtro. El nocturno
   **ya trae** `screenPassed`, `screenRejectField` y `screenRejectReason` calculados por fila con
   el mismo motor [SUPABASE: presentes en las 3.309 filas], y el cliente no los usa ni siquiera
   para el preset por defecto. También el **orden** paga cómputo de más: cambiarlo dispara una
   tarea de 1,5 s (re-derivación completa del modelo de vista + render), cuando ordenar 1.082
   filas ya anotadas debería costar decenas de ms.

Además [MEDIDO]: la sesión se **reescribe sin debounce** — 4 `setItem` de la sesión en los 9 s
posteriores a un clic de preset (efecto con ~40 dependencias, `app/page.jsx:795-803`). Son solo
~6-13 KB por escritura (barato), pero delata que el ciclo de render tras un gesto se ejecuta
varias veces.

---

# PARTE C — Por qué no da resultados

## C9. Lo que dice la base con el preset de deterioro técnico

El preset "Deterioro técnico" (`weakness`, `lib/screenerFilterCatalog.js:195`) neutraliza casi
todo y deja: `setupMode: "weakness"`, `minWeaknessScore: 55`, `minPrice: 2`,
`minMarketCap: 150M`, `minAvgVolume: 100k`, strictness `strict`.

Sobre el nocturno de HOY (scan `056ecf52-e8ae-46b8-9160-a06b0dcb6440`, 23-08) [SUPABASE]:

```sql
select count(*) as total,
       count(*) filter (where (metrics->>'weaknessScore')::numeric >= 55) as weakness_ge_55,
       count(*) filter (where (metrics->>'weaknessScore')::numeric >= 55
                          and (metrics->>'price')::numeric >= 2
                          and (metrics->>'marketCap')::numeric >= 150000000
                          and (metrics->>'avgVolume')::numeric >= 100000) as pasa_aprox_deterioro
from scan_results
where scan_id = '056ecf52-e8ae-46b8-9160-a06b0dcb6440' and owner_id = 'personal';
-- total: 3309 · weakness_ge_55: 1101 · pasa_aprox_deterioro: 1027
```

Y el motor completo del cliente, medido en runtime sobre esas mismas 3.309 filas: **1.082 pasan**
[MEDIDO]. Las tres cifras (1.027 aproximación SQL, 1.082 motor real, 1.101 cota superior) se
encajonan mutuamente: **la base dice que hay ~un millar de candidatos de deterioro, hoy.**

## C10. El fallo de filtrado, localizado: no es el motor, es la población

La misma consulta sobre **las 500 primeras por ranking** — lo que contiene la copia local del
dueño, porque el transporte pre-17-08 cogía las primeras por `rank_index` [SUPABASE]:

```sql
with top500 as (
  select metrics from scan_results
  where scan_id = '056ecf52-e8ae-46b8-9160-a06b0dcb6440' and owner_id='personal'
  order by rank_index asc limit 500
)
select count(*) filter (where (metrics->>'weaknessScore')::numeric >= 55) as weakness_ge_55,
       max((metrics->>'weaknessScore')::numeric) as max_weakness
from top500;
-- weakness_ge_55: 0 · max_weakness: 31
```

**Cero.** Ni una de las 500 mejores llega siquiera a deterioro 31→55. El ranking ordena por
puntuación compuesta: las top-500 son, por construcción, las que NO se deterioran. El "0
resultados · 0 pasan · 500 analizadas" del dueño es la combinación exacta de A (población = 500
top del 16, congelada) y esta aritmética. El motor de filtrado funciona: aplicado al universo
completo da 1.082 [MEDIDO]; aplicado a una copia sesgada da 0, y la pantalla no distingue ambos
casos.

(Es la reedición del hallazgo del 17-08 — "entre las 1.000 primeras por rank_index hay 0 en etapa
4 y 0 débiles" — que aquel cambio arregló para el transporte… pero no para la copia persistida ni
para los arranques con sesión, que son casi todos.)

## C11. Cómo se combinan las capas: nada se aplica apagado, pero apagar apaga de más

Revisado el mecanismo entero (`lib/screenerFilterLayers.js:73-176` + runtime):

- **No encontré ninguna capa que se aplique estando apagada.** Apagar una capa neutraliza sus
  umbrales (0 / 999 / -100) y el motor los salta. Esa parte es correcta.
- **El problema es el inverso — apagar una capa cambia más de lo que dice, en silencio:**
  1. Con el preset "Deterioro técnico" activo, apagar la capa **Scores** degrada
     `setupMode: "weakness"` → `"any"` (`lib/screenerFilterLayers.js:167`) y el criterio central
     del preset desaparece: **de 1.082 pasan a 1.886 pasan** [MEDIDO]. El usuario cree que quitó
     "6 reglas de scores" y en realidad su screener dejó de buscar deterioro por completo. Ningún
     texto lo anuncia. Lo mismo pasa con leader/early/pullback al apagar Tendencia, Cercanía o
     Momentum (`:169-171`).
  2. **Campos con doble llave**: `minRiskScore` se neutraliza si se apaga Cercanía **o** Scores
     (`:103` y `:126`); `minVolumeScore` con Scores **o** Liquidez; `minSectorScore` con RS **o**
     Scores. Es decir, esas reglas solo aplican con DOS capas encendidas a la vez, y la UI de la
     capa encendida las muestra como activas cuando la otra las ha anulado.
- La cifra "62 reglas en once capas" es del inventario del 13-08 y ya no es exacta: hoy son
  **14 capas (13 + régimen), 68 reglas declaradas** (`app/page.jsx:851-856`), 60 ajustes finos en
  14 grupos, 7 presets, 8 modos de setup y 3 niveles de exigencia.

---

# PARTE D — La experiencia real de uso (el sábado)

Recorrido: cargar → mirar qué cambió → filtrar por deterioro → ordenar → filtrar por grupo →
buscar un valor. La ficha no se abrió (restricción del encargo: dispara descargas del proveedor);
el ciclo por valor está documentado en `docs/analisis-friccion-2026-08-15.md` §A2 y sus arreglos
(F2/F4) siguen sin aplicar — lo comprobado hoy abajo lo confirma.

## D12-D13. El recorrido, con sus números

1. **Cargar.** Si es la primera vez (o tras Reset): ~15-36 s en dev con dos descargas de 27 MB
   (B7). Si hay sesión: unos segundos… con la población del 17% y la fecha del último día que la
   nube respondió, sin aviso (A3). El usuario no puede distinguir un arranque bueno de uno
   degradado salvo leyendo el contador "analizadas" y sabiendo qué significa.
2. **"¿Qué ha cambiado?"** — la franja nueva del commit `980856b` **funciona y responde la
   pregunta del sábado** [REPRODUCIDO, captura]: "Desde el lun 17 ago · Etapa 2: 47 entradas, 129
   salidas · Máximos de 52 semanas: 15 nuevos, 87 ya cerca", con panel de detalle (tickers, tema,
   etapa 3→2, RS, distancia al máximo), orden elegible y un aviso de ventana honesto ("los
   escaneos previos al 17 no son comparables"). Sin red extra al abrirlo. Es lo mejor del
   recorrido — y hace más visible el contraste con una tabla que puede estar enseñando el día 16.
3. **Filtrar por deterioro.** Clic al preset → 1,3-1,5 s de pantalla congelada (sin spinner: la
   única señal es que nada responde) → 1.082 resultados. Tres fricciones en el resultado:
   - El título de la pantalla sigue diciendo **"Global Leaders"** con el preset "Deterioro
     técnico" activo debajo — la superficie contradice el criterio.
   - La tabla del deterioro la **lidera KEEL con RS 91 y Etapa 3**: se ordena por `weaknessScore`
     ("Deterioro"), una columna que **la tabla no muestra**. Ordenas por un número invisible —
     la misma clase de problema que el filtro "Débiles" del análisis del 15-08 (§5.2-3).
   - "MUESTRA PARCIAL · PERCENTIL POR LOTE" sigue plegada encima, con su jerga, en todos los
     estados.
4. **Ordenar.** El select "Ordenar" y el selector de periodo (3M/6M/12M, ahora con leyenda
   "también ordena la tabla" ✓ — mejora desde el 15-08) funcionan; cada cambio = ~1,5 s de
   congelación [MEDIDO]. La cabecera de columna sigue sin ser clicable (afirmado el 15-08; hoy no
   re-verificado).
5. **"Más filtros".** El bug del cajón sigue **vivo** [REPRODUCIDO, captura]: al abrirlo, los seis
   selects se apilan en una columna estrecha a la derecha, media pantalla queda vacía y la tabla
   sale del viewport. El arreglo era una línea de CSS (análisis 15-08 §2, propuesta A2) y no se
   aplicó. Dentro: "País: Todos" con solo US, "IPO: Todos" con una única opción (controles que no
   pueden filtrar nada), "Subsector" con ~120 opciones en inglés en un select nativo.
6. **Filtrar por grupo** (Fuerza grupo: Débiles): 655 resultados en 2,3 s. El número cuadra con el
   conteo del propio selector ("Débiles (655)") ✓.
7. **Buscar un valor.** "NVDA" + Enter → **no va a la ficha**: dispara la búsqueda asistida
   (`/api/search`, 1,1 s) y la tarjeta intermedia con su propia tanda de red (`/api/chart` NVDA
   968 ms + `/api/profile` 709 ms + `/api/chart` SPY) [MEDIDO]. El camino a la ficha sigue siendo
   tarjeta → enlace "Ficha" → navegación completa (fricción A2 del 15-08, F2 sin aplicar).

## D14. ¿68 reglas en 14 capas es manejable?

Con lo observado, la respuesta es concreta:

- **Lo que se usa de verdad**: preset (1 clic) + orden + periodo + 1-2 filtros de vista + el
  buscador. El propio dueño vive en presets — su incidencia es "activé el preset de deterioro",
  no "configuré 68 reglas". La franja semanal nueva apunta igual: respuestas directas, no cirugía.
- **Lo que cuesta la superficie restante**: el sidebar expone 7 presets + 4 booleanos + 60
  ajustes finos con toggle individual (14 grupos) + 14 capas + 6 capas de vista + 3 niveles + 8
  modos + plantillas locales y de nube + un panel de auditoría del embudo ("3309 analizadas · 2%
  pasan · 3253 filtros duros…"). Y tocarla tiene trampas reales medidas: apagar UNA capa puede
  cambiar el preset de naturaleza sin aviso (C11: 1.082 → 1.886), y hay reglas que exigen dos
  capas a la vez para existir.
- El principio de producto ya escrito ("Filtros rápidos e intuitivos. Simples y efectivos, no
  exhaustivos" — `docs/principios-producto.md` §4.3) describe exactamente lo contrario de esta
  cabina. No hace falta decidir hoy el rediseño (la propuesta de tres niveles del análisis de
  filtros §5.4 sigue siendo la dirección); lo que este análisis añade es que la cabina no es solo
  ruido visual: **es donde el usuario se dispara en el pie sin enterarse**.

---

# Prioridad por impacto en el uso diario

| # | Qué | Por qué es lo primero |
|---|---|---|
| P1 | **Frescura: el arranque con sesión debe detectar que hay un nocturno más nuevo** (una petición barata de metadatos — `limit=1` sin filas — comparando id/fecha del `scanRef`; o un TTL de datos: sesión de criterios eterna, datos caducan al día). Hoy: 0 peticiones y fecha congelada para siempre (A1/A3). | Es la causa directa del cuadro del dueño ("scan 16 ago" el día 23) y de cualquier "no me fío de lo que veo". Un screener que enseña datos de hace una semana sin saberlo no es lento: es falso. |
| P2 | **Población: dejar de filtrar en silencio sobre la muestra local.** Si la copia es muestreada (`rowsSampled`), el arranque re-pide el universo (P1 lo habilita) o, como mínimo, pinta el aviso que la vía `scanRef` hoy no pinta (A3). | La promesa del universo completo (17-08) hoy dura una visita. Todos los "0 resultados" inexplicables y la varianza de tiempos (126 ms vs 1.332 ms) nacen aquí. |
| P3 | **Rendimiento del gesto: no recalcular las 68 reglas por fila en cada clic.** Vías concretas: usar `screenPassed`/`screenRejectReason` del nocturno como fast-path del preset del nocturno; memoizar por fila cuando solo cambia el orden (hoy: 1,5 s por reordenar); debounce del autoguardado. | 1,3–1,5 s de hilo congelado por CADA gesto es el "va lento en general". El presupuesto razonable es <200 ms; los datos precalculados ya existen en cada fila. |
| P4 | **Reset sesión deja de ser el único rescate y deja de costar la configuración** — separar "traer datos frescos" (conservando criterios) de "resetear criterios". | Hoy la única cura de P1 borra el criterio del usuario: la trampa de las plantillas del 15-08, en versión botón. |
| P5 | **Capas: anunciar la degradación.** Si apagar una capa cambia el `setupMode` o anula reglas de otra capa, decirlo en el momento (o retirar la degradación silenciosa). | C11 medido: un clic bienintencionado convierte "Deterioro técnico" en "cualquiera" sin aviso. |
| P6 | Los restos de UI ya diagnosticados y baratos: cajón "Más filtros" (una línea de CSS), Enter→ficha, título de pantalla fijo "Global Leaders", ordenar por columna invisible (añadir la columna Deterioro cuando el preset la usa, o no ordenar por ella). | Cada uno es pequeño; juntos son la sensación de "no funciona fiablemente". |

Lo que NO propone este análisis: tocar el motor de filtrado (da resultados correctos: 1.082
verificado contra base), ni el nocturno (corre cada noche, puntual, con `passedScreen` coherente),
ni la franja semanal nueva (funciona).

---

# CONFIANZA

| Afirmación | Confianza | Base |
|---|---|---|
| Con sesión válida, el arranque no hace ninguna petición de datos y la fecha "scan" sale de localStorage | Alta | [REPRODUCIDO] red vacía de `/api/scans` + [CÓDIGO] `app/page.jsx:547-664`, `:585`, `:596` |
| No existe TTL ni comparación de fechas en la restauración | Alta | [CÓDIGO] rama completa leída; `updatedAt` sin lectores |
| La recarga degrada la población de 3.309 a 576 sin aviso | Alta | [MEDIDO] dos veces (arranque templado tras frío, y tras Reset) |
| El cambio del universo completo está en HEAD y no revertido | Alta | `git merge-base --is-ancestor f8a7bb2 HEAD` + `lib/cloudSyncClient.js:284` |
| Los nocturnos existen cada noche y solo se conservan 7 (el del 16 ya no está) | Alta | [SUPABASE] tabla `scans`, consulta citada en A2 |
| El preset deterioro da ~1.030-1.100 según base y 1.082 según el motor real, hoy | Alta | [SUPABASE] consultas citadas + [MEDIDO] runtime |
| Las top-500 por ranking dan 0 con deterioro ≥55 (máx 31) | Alta | [SUPABASE] consulta citada en C10 |
| La pantalla exacta del dueño (0·0·500 · scan 16 ago, 05:58) = sesión v4 del 16 + copia top-500 + preset deterioro | Alta como composición de piezas verificadas; el estado literal de SU navegador no se inspeccionó | Cada eslabón por separado [REPRODUCIDO/CÓDIGO/SUPABASE]; composición [INFERIDO] |
| Reset sesión recarga de nube y cura la frescura; cuesta la configuración; la cura dura una visita | Alta | [MEDIDO] storage+red instrumentados + [CÓDIGO] `app/page.jsx:923-972` |
| 1,3–1,5 s de hilo bloqueado por gesto (preset/orden/vista) sobre 3.309 filas; 126 ms sobre 576 | Alta la magnitud | [MEDIDO] longtasks + `lastFilterMs` del propio pipeline + el rótulo del producto ("filtro aplicado en 1.33s"); pestaña oculta anotada |
| Apagar la capa Scores con preset deterioro pasa de 1.082 a 1.886 sin aviso (modo degradado) | Alta | [MEDIDO] + [CÓDIGO] `lib/screenerFilterLayers.js:167` |
| Ninguna capa se aplica estando apagada | Media-alta | [CÓDIGO] revisión de `effectiveSettingsFromLayers` y el motor; no probé las 14 una a una en runtime |
| Arranque frío dev: 2×27 MB (StrictMode), servidor 5,7-11,7 s frío / 189 ms caliente | Alta en dev; producción no medida | [MEDIDO] resource timing + logs del servidor |
| Anomalía observada una vez: tras un Reset, un clic de preset acabó en población 576 y orden "RS" | Baja en el mecanismo (no reproducida en 2 reintentos); alta en que ocurrió | Los números (192 = 33% de 576; sort ajeno al preset) apuntan a una restauración local tardía pisando el estado [INFERIDO] |

# LO QUE NO HE VERIFICADO

- **El navegador del dueño.** No inspeccioné su localStorage; su pantalla exacta está
  reconstruida por composición (ver CONFIANZA). Si al abrir su navegador la sesión no fuera v4 o
  la copia no fuera del 16, el diagnóstico de mecanismo (A1/A3) no cambia, pero la cronología sí.
- **Producción (Vercel).** Todos los tiempos son de `next dev` local con webpack; en producción no
  hay doble StrictMode y hay gzip. La estructura (petición grande + servidor 5-12 s en frío +
  recálculo cliente por gesto) es la misma; los segundos, no.
- **La pestaña estuvo oculta en tramos de la medición** (el panel deja de repintar; ya pasó en los
  análisis del 14/15-08). Red, longtasks, mutaciones DOM y `lastFilterMs` no dependen de la
  visibilidad; los tiempos "hasta verse en pantalla" son cotas superiores. Las capturas se tomaron
  con la pestaña al frente.
- **La ficha y el modal Revisar** (prohibidos: disparan descargas del proveedor): el ciclo por
  valor se cita del análisis del 15-08 sin re-medirlo hoy.
- **El fallo de red en el arranque** (rama `restoreLocalSnapshot` por error de nube): afirmado por
  código y por el timeout visto en logs; no simulé una caída completa de Supabase.
- **La cabecera de columna no ordena**: documentado el 15-08; hoy no re-comprobado.
- **La sesión fabricada del 16** (id inexistente + top-500 literal): la escritura del estado
  simulado en localStorage fue bloqueada por el clasificador de permisos de la herramienta; los
  cuatro eslabones se verificaron por separado (restauración sin red en runtime, sin-TTL por
  código, 0/top-500 por SQL, fecha persistida por código+runtime).
- **El peso de los 17 filtros de vista del sistema de decisión** que siguen calculándose sin UI
  (B6 del análisis de filtros): no re-medido.
- **La anomalía** (población 576 con orden ajeno tras un Reset): ocurrió una vez de tres; queda
  sin causa trazada. Si reaparece en uso real, el síntoma visible será una tabla que "vuelve sola"
  a 576 analizadas con el orden cambiado.
