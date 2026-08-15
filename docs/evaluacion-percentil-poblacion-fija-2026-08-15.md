# El percentil diario sobre una población fija — evaluación

Fecha: 2026-08-15. BASE_SHA: `f821962`. Rama: `codex/statsedge-ui-polish`.

**Evaluación, no implementación.** No se ha escrito una línea de código para
esto: el encargo pedía explícitamente evaluar y reportar. Los tres arreglos
que sí se implementaron en la misma sesión (persistir setup/demanda/growth,
retirar el término IPO, eliminar `legacyTotalScore`) son independientes de
esta decisión y no la condicionan.

Población de referencia de las mediciones: las **3.314 filas** del escaneo
nocturno `42545bfc-cb3f-4a46-ad74-5019fe2e65d7` (2026-08-15T03:50:28Z), censo
completo verificado contra `scans.row_count`.

---

## Resumen

1. **Es viable, y más barato de lo que parece**, porque el cálculo ya se hace:
   `sectorize()` llama a `enrichRelativePercentiles` sobre la población entera
   de la corrida. Lo que falta no es calcular: es **guardar el número y que los
   demás lo lean** en vez de recalcularlo con su propia muestra.
2. **Coste de proceso: prácticamente cero** en cálculo (ya se ejecuta) más una
   escritura de ~3.300-5.600 filas, del mismo orden que la que ya hace el RS
   semanal. **Coste de almacenamiento: 0,6-1,0 MB al día**, 155-262 MB al año
   con una fila mínima.
3. **Sí resuelve los escaneos manuales**, pero solo si además se les prohíbe
   recalcular. Si siguen llamando a `enrichRelativePercentiles` sobre su lote,
   el problema vuelve intacto: la tabla no impide nada por existir.
4. **Sí hay una razón por la que no se hizo así, y ya no aplica.** Hasta hace
   dos días ninguna corrida veía el universo entero: el cron de Vercel procesa
   12-24 símbolos por invocación con `maxDuration=60`. Una población fija era
   imposible de construir. El nocturno fuera de Vercel la hizo posible el 15 de
   agosto. Hay una segunda razón que **sí sigue viva** y es la que de verdad
   condiciona el diseño: la población del percentil de hoy **no es el mercado
   estadounidense**, son los 3.314 símbolos que sobreviven al filtro base de
   liquidez —el 59,1% de los 5.609 analizados—, y decidir la población obliga
   a decidir antes si ese filtro forma parte de ella.
5. **Los valores sin doce meses no quedan fuera hoy: entran con un cero
   fabricado.** Son 51 filas (1,54%), y ese cero les cuesta: mediana de
   percentil **37 frente a 50** del resto. Es el mismo defecto que el término
   IPO, en otro sitio.
6. **Recomendación: hacerlo, en dos pasos, y el primero es gratis.**

---

# PARTE A — ¿Es viable?

## A.1 El cálculo ya existe y ya corre sobre la población completa

Cita literal, `lib/materializedScanner.js:1711-1712`:

```js
  const passedBase = analyzed.filter((item) => item.ok).map((item) => item.row);
  const sectorized = sectorize(passedBase);
```

`sectorize` llama a `enrichRelativePercentiles(...)`
(`lib/relativeStrength.js:224-241`), que ordena el `rsCompositeRaw` de **todas**
las filas que recibe y asigna el percentil de cada una contra esa lista. No hay
troceado: el propio repo lo documenta en
`lib/scanPercentileFinalization.js:394-397` — *"el cálculo no se puede trocear:
un percentil necesita conocer el `rsRawComposite` de TODAS las filas del scan
antes de poder escribir la primera"*.

Verificado en datos: las 3.314 filas del nocturno traen `rsGlobalSample: 3314`,
sin una sola excepción. La muestra ES la corrida entera.

**Conclusión de A.1: el paso caro ya está hecho.** Lo que hoy no ocurre es que
ese número sobreviva a la corrida como algo consultable por otros procesos.

## A.2 Ya hay un precedente funcionando en producción

`rs_weekly_snapshots` + `rs_weekly_items` es exactamente este diseño, pero
semanal: `scripts/rs-universe.mjs` calcula el percentil sobre el universo
estadounidense desde `daily_bars`, lo escribe con `engine_version`,
`sample_size` y `snapshot_date`, y `lib/globalRs.js` lo lee. Fila real
verificada (AAPL, snapshot 2026-08-09): `rank_index: 1433`, `rs_rating: 70`,
`sample_size: 4868`.

Es la misma forma de tabla, el mismo patrón de escritura y el mismo lector.
La tercera vía no inventa una arquitectura: **hace diario lo que ya se hace
semanal**, y con la diferencia importante de que la fórmula sería la del
compuesto (`rsRawComposite`), no la del RS semanal (`RETURN_WINDOWS_WEEKS`
40/20/20/20) — son dos fórmulas distintas y hoy conviven.

## A.3 Lo que habría que cambiar, en orden de coste

| Paso | Qué | Coste |
|---|---|---|
| 1 | El nocturno escribe lo que ya calcula, en una tabla propia | Bajo — una escritura por tandas, el patrón de `writeMaterializedScan` ya existe |
| 2 | El compuesto lee ese número en vez del de su lote | Medio — hay que decidir qué hace una fila que no está en la tabla |
| 3 | Los escaneos manuales dejan de recalcular | Medio — es el paso que de verdad resuelve el problema |
| 4 | La población pasa a ser un parámetro | Bajo si se hace en el paso 1; caro si se hace después |

---

# PARTE B — Qué costaría

## B.1 Tiempo de proceso

**Cálculo: 0 segundos adicionales.** Ya se ejecuta (A.1).

**Escritura.** La referencia medida más cercana es la del propio repo: la
finalización de percentiles del escaneo interactivo estima ~112 llamadas de
lectura + ~56 de escritura para 5.600 filas, con **298 ms** por llamada
pequeña medidos (`lib/scanPercentileFinalization.js:125`, origen en
`docs/finalizacion-percentiles-2026-08-11.md` A.4) — del orden de **30-60
segundos** para el conjunto. Escribir una tabla de percentiles es más simple
que eso (no hay `UPDATE` sobre filas existentes, es un `INSERT` de tandas), así
que 30-60 s es una cota superior generosa.

Sobre un nocturno que hoy tarda **unos pocos minutos** para 5.609 símbolos
(`docs/adr-escaneo-nocturno.md` B.8: ≈255 s solo de análisis, estimación
aritmética declarada como tal), añadir un minuto es ruido.

**Advertencia sobre esa cifra:** ni los 255 s ni los 298 ms los he medido yo en
esta sesión. Son las mediciones que el repo ya tenía, citadas con su fuente.

## B.2 Almacenamiento

Fila mínima suficiente para que el compuesto la lea:

```json
{"symbol":"AAPL","trade_date":"2026-08-15","population_key":"us-equity",
 "rs_raw":20.536607827943044,"rs_pct":52,"rank_index":1433,
 "sample_size":3314,"engine_version":"statsedge-us-equity-rs-v1"}
```

**194 B en JSON.** Sobre esa base:

| Filas/día | Al día | Al año (252 sesiones) |
|---|---|---|
| 3.314 (la población de percentil de hoy) | 628 KB | **155 MB** |
| 5.609 (todos los analizados) | 1.063 KB | **262 MB** |

Referencia real de una tabla equivalente ya en producción: `rs_weekly_items`
ocupa ~750 B/fila porque arrastra `company_name`, `sector`, `theme`, `metrics`
y las cotizaciones — cuatro veces más de lo necesario aquí. Copiar su esquema
entero cuadruplicaría el coste sin comprar nada.

**Comparación que importa:** `scan_results` ya escribe **22,6 MB por noche**
(3.283 filas ligeras × 7,2 KB, medido en esta sesión). La tabla de percentiles
sería **el 2,8% de eso**. No es donde está el problema de volumen — y el
problema de volumen de `scan_results` está documentado y abierto en
`docs/adr-escaneo-nocturno.md` D.11.

---

# PARTE C — ¿Resolvería los escaneos manuales?

**Sí, pero no por existir la tabla: por prohibir el recálculo.**

Hoy hay dos productores de `rsGlobalPct` y ninguno consulta al otro:

- `lib/materializedScanner.js:316` (nocturno) → `enrichRelativePercentiles` sobre `passedBase`.
- `lib/screenerPipeline.js:345` (interactivo) → `enrichRelativePercentiles` sobre su lote.
- Y un tercero que corrige al segundo: `lib/scanPercentileFinalization.js:255`,
  que recalcula sobre el scan completo y marca `percentileScope: "final"`.

El efecto medido está en `docs/analisis-compuesto-2026-08-15.md` C.7: el mismo
día y el mismo cierre, AAPL vale **52** con n=3.314 y **65** con n=5.838. Siete
de siete símbolos comprobados se desplazan entre 8 y 14 puntos.

Con la tabla, esos tres caminos leerían el mismo número. **Pero solo si se les
quita la capacidad de calcularlo.** Si `enrichRelativePercentiles` sigue
disponible y sigue llamándose, la tabla es un cuarto valor más, no la fuente
única — y el repo ya tiene la cicatriz de ese error: `lib/rsCanonical.js`
existe porque el mismo símbolo mostraba **cuatro valores distintos de RS en
cinco pantallas de la misma sesión**.

**La lección aplicable, del propio archivo:** `rsCanonical` no arregló el
cálculo, impuso un LECTOR ÚNICO y prohibió los fallbacks. Aquí hace falta lo
mismo: un lector único del percentil diario, y que la ausencia se muestre como
ausencia (principio 3) en vez de caer al percentil del lote.

**Un caso que hay que decidir explícitamente:** el escaneo de servidor del 15
incluía mercados europeos (`settings.markets: ['FI','DK',…]`). Con la población
de referencia fijada en Estados Unidos, esos símbolos **no tendrían percentil**.
Eso no es un fallo: es la consecuencia correcta de que el número signifique
algo. Pero significa que la tabla, en la versión pública, deja sin `rsAnchor`
a todo lo que no sea estadounidense — y `rsAnchor` es el 16% del compuesto,
más el 6% de `rsQualityScore` y parte del 10% de `demandScore`, que se calculan
sobre él.

---

# PARTE D — ¿Por qué no se hizo así desde el principio?

He buscado la razón antes de dar por bueno el planteamiento. Hay tres, y solo
una sigue viva.

## D.1 Muerta: ninguna corrida veía el universo entero

El cron de Vercel procesa **12-24 símbolos por invocación**
(`lib/cronPlan.js`, `SCAN_CRON_GROUPS`: `limit: 12` para US/HK/AU) con
`maxDuration = 60` (`app/api/cron/scan-refresh/route.js:13`). Con ese diseño,
"el percentil sobre la población completa" no era una decisión de arquitectura:
era imposible. No existía ningún momento del día en que un proceso tuviera las
5.600 filas en memoria a la vez.

El propio ADR lo dice con todas las letras
(`docs/adr-escaneo-nocturno.md`, B.7 punto 2):

> «**La razón por la que el cron nunca ha necesitado esto**: su propia
> `sectorize()` también calcula percentiles en memoria de una sola vez […]
> pero sobre `passedBase`, que hoy son 2-24 símbolos por invocación.»

Y anticipa la consecuencia de moverlo fuera de Vercel: *"el «lote» y «la
población total de la noche» pasarían a ser la misma cosa"*.

**Eso ya ocurrió.** El nocturno del 15 de agosto corrió los 5.609 símbolos en
un solo proceso. La razón que impedía esto lleva dos días sin aplicar.

## D.2 Muerta a medias: la finalización quedó fuera de alcance

`lib/screenerComposite.js:55-58`, cita literal:

```
// CRON: este helper también lo consume lib/materializedScanner.js, pero la
// finalización no se ejecuta en el cron (ADR fase 3 lo deja fuera de scope).
```

La fase 3 del ADR de consolidación (`docs/adr-scoring-pipeline-canon.md:167`)
tenía previsto marcar `percentileScope: "final"` en las filas del cron
precisamente porque *"su población de percentil ya ES el scan completo"*. Está
planificado y sin hacer. Esta tercera vía es esa fase 3, más la persistencia.

## D.3 VIVA, y es la que condiciona el diseño: la población no es "el mercado"

Aquí está el matiz que el planteamiento del encargo da por resuelto y no lo
está. La decisión del dueño —*"la población es el mercado estadounidense
completo"*— choca con lo que el código hace hoy:

```
5.609 símbolos analizados
  −  39 errores de proveedor
  − ~2.256 descartados por baseRejectReason
= 3.314 símbolos en la población del percentil (59,1%)
```

`baseRejectReason` descarta por: sin precio, menos de 180 barras, precio viejo,
capitalización < 300 M$, turnover medio < 250 k$, cobertura de datos < 40.
Cita del propio código (`lib/materializedScanner.js:1733-1736`): *"el sistema
declara que sus señales no son fiables, y guardarlas contradiría el principio 3"*.

Así que hay **tres poblaciones candidatas**, y no son intercambiables:

| Candidata | Tamaño | Qué significa el percentil |
|---|---|---|
| Universo listado | ~5.605 | "posición entre todo lo cotizado en EE.UU." |
| Analizables (con precio y 12 meses) | ~4.868 (el que usa el RS semanal) | "posición entre lo que se puede medir" |
| Con datos fiables (hoy) | 3.314 | "posición entre lo invertible por liquidez" |

El RS semanal ya eligió la segunda: `sample_size: 4868`, con
`MIN_BARS_REQUIRED = 261` (52 semanas) y exclusión de series discontinuas.
El compuesto usa hoy la tercera sin haberlo decidido: es un residuo del filtro
de calidad, no una definición de mercado.

**Esto hay que decidirlo antes de escribir la tabla, no después.** Un percentil
sobre 3.314 y otro sobre 4.868 son números distintos para el mismo símbolo, y
si la tabla se puebla con uno y luego se cambia al otro, todo el histórico
guardado deja de ser comparable — que es exactamente el problema que esta
tercera vía viene a resolver.

**Mi recomendación sobre la población:** la segunda, *analizables*, la misma
que ya usa el RS semanal. Motivos: (a) es la que corresponde a "el mercado
estadounidense" tal como lo entiende el dueño, sin colar un criterio de
liquidez dentro de la definición; (b) ya está calculada y validada cada semana,
así que los dos números serían comparables entre sí; (c) el filtro de liquidez
sigue existiendo donde debe estar —en el filtro, no en la escala de medida.

---

# PARTE E — Los que no llegan a doce meses

## E.1 Hoy no quedan sin percentil: entran con un cero fabricado

Cita literal, `lib/relativeStrength.js:180-190`:

```js
export function rsRawComposite(row = {}) {
  const p3 = Number.isFinite(row.perf3m) ? row.perf3m : 0;
  const p6 = Number.isFinite(row.perf6m) ? row.perf6m : 0;
  const p12 = Number.isFinite(row.perf12m) ? row.perf12m : 0;
  const rs3 = Number.isFinite(row.rs3m) ? row.rs3m : 0;
  const rs6 = Number.isFinite(row.rs6m) ? row.rs6m : 0;
  const rs12 = Number.isFinite(row.rs12m) ? row.rs12m : 0;
  ...
  return p3 * .38 + p6 * .24 + p12 * .14 + rs3 * .34 + rs6 * .18 + rs12 * .08 + nearHigh * .16 - drawdown * .12;
}
```

Seis ternarios que convierten "no lo sé" en cero. Es el mismo patrón del
término IPO que este encargo manda retirar del compuesto, en otro archivo.

**Medido sobre las 3.314 filas del nocturno:**

```
filas sin perf12m: 51 de 3.314 (1,54%)

rsGlobalPct de las 51 SIN doce meses:   mín 1   mediana 37   media 38,5   máx 96
rsGlobalPct de las 3.263 CON doce meses: mín 1   mediana 50   media 49,7   máx 99
```

**Trece puntos de percentil de diferencia en la mediana.** No es que esos 51
valores sean peores: es que se les puntúa un tramo con un cero. perf12m mediana
de la población es +18,80%, y con peso 0,14 en el raw, sustituirla por cero
desplaza el compuesto crudo unos **2,63 puntos** hacia abajo.

Los 51 símbolos: AERO, AEXA, AGCC, ALH, ANGX, BCSS, BDCI, BETA, BGSI, BLLN,
BLZR, BTQ, BUUU, CBK, CEPF, CEPV, ELVR, EVAC, EVMN, FCRS, FIGR, FRMI, GEMI,
GFUZ, GIW, GLOO, HVMC, KDK, KLAR, KOYN, LBRX, LGN, MIAX, MKLY, MPLT, NAVN,
NKLR, NP, NTSK, OTGA, PACH, PTRN, PXED, Q, SOLS, STUB, VACI, VIA, WBI, WOLF,
XZO. Diez de ellos ya aparecían en el análisis del compuesto como símbolos sin
RS semanal — el ranking semanal, que exige 261 barras, ya los excluye.

## E.2 Qué debería pasar, y qué implica

El encargo lo fija: **sin percentil, no con uno aproximado.** Estoy de acuerdo,
y el filtro correcto ya existe en el repo: `MIN_BARS_REQUIRED = 261`
(`scripts/rs-universe.mjs`), 52 semanas más una barra.

Dos consecuencias que hay que aceptar con los ojos abiertos:

1. **Esas filas se quedan sin `rsAnchor`.** Hoy `rsAnchor` cae a `rsRating` y
   luego a `50` (`materializedScanner.js:331`). Si el percentil pasa a ser
   ausente, la cadena debe llevar a `null` y el compuesto renormalizar sobre
   los términos presentes — que es justo lo que hace desde este encargo, tras
   retirar el término IPO. El `50` final tiene que morir con esto; es el mismo
   defecto una tercera vez.
2. **`rsQualityScore` y `demandScore` heredan la ausencia**, porque se calculan
   sobre `rsPrimaryValue`. Sin percentil, `scoreRsQuality` ya devuelve `null`
   correctamente (`relativeStrength.js:244-245`: `if (!Number.isFinite(rs))
   return null`), pero `demandScore` hace `rsPrimaryValue(r) ?? 50`
   (`scoringEngine.js:464`) — otro cero-por-ausencia disfrazado de neutro. Hay
   que arreglarlo en el mismo movimiento o el percentil ausente se colará como
   un 50.

**Coste del criterio:** 51 filas de 3.314 (1,54%) pierden el 16% directo del
compuesto y ven renormalizado el resto. Es asumible y es lo correcto. Y el
retraso de las salidas a bolsa nuevas —doce meses hasta entrar— es exactamente
lo que el dueño ya declaró aceptable.

---

# PARTE F — La población como parámetro

## F.1 Por qué no puede quedar incrustada

Habrá dos versiones del producto: una internacional privada y una pública
limitada a Estados Unidos por licencias. Si "el mercado estadounidense" se
escribe dentro del cálculo, las dos versiones dejan de compartir motor, y
mantener dos motores de scoring es exactamente cómo se llega a que el mismo
símbolo tenga cuatro RS distintos.

## F.2 Forma concreta que propongo

**Un solo sitio**: un módulo `lib/rsPopulation.js` (o el nombre que sea) que
exporte el catálogo de poblaciones de referencia y nada más:

```js
// Ilustrativo — NO implementado en esta sesión.
export const RS_POPULATIONS = {
  "us-equity": {
    key: "us-equity",
    label: "Acciones de EE.UU.",
    markets: ["US"],
    instrumentTypes: ["equity"],
    minBars: 261,              // doce meses; el criterio de E.2
    minSample: 20,
    baseCurrency: "USD",
    engineVersion: "statsedge-us-equity-rs-v1",
  },
  // La versión internacional añade entradas aquí. No toca el motor.
};
export const DEFAULT_RS_POPULATION = "us-equity";
```

Y la tabla lleva `population_key` en la clave, junto a `symbol` y `trade_date`.
Con eso:

- El motor recibe `populationKey` y no sabe qué mercados hay dentro.
- Las dos versiones consumen datos distintos con el mismo código.
- Un símbolo puede tener percentil en dos poblaciones a la vez sin ambigüedad
  (útil de verdad: un valor alemán tiene un percentil en "Europa" y otro en
  "global", y son ambos legítimos).
- El precedente ya existe: `ENGINE_VERSION_BY_POPULATION` en
  `scripts/rs-universe.mjs` hace esto mismo para separar acciones de ETFs.

**Una advertencia que no está en el encargo y sí en los datos:** una población
internacional obliga a decidir la moneda. `rs_weekly_items` ya lleva
`base_currency`, `usd_close`, `local_close`, `fx_rate` y `fx_date` porque el
problema apareció con los datos europeos de mayo. Comparar el rendimiento a 12
meses de un valor japonés y uno estadounidense sin normalizar la divisa mide el
yen, no la empresa. `baseCurrency` tiene que estar en el parámetro de población
desde el primer día, aunque la versión pública solo use `USD`.

## F.3 Otras constantes del compuesto que deberían ser parámetro, por el mismo motivo

Buscadas con el mismo criterio: *una constante que la versión internacional
necesitaría distinta, o que hoy significa una decisión disfrazada de detalle.*

| Dónde | Constante | Por qué debería ser parámetro |
|---|---|---|
| `lib/relativeStrength.js:4-5` | `RS_GLOBAL_MIN_SAMPLE = 20`, `RS_SCOPED_MIN_SAMPLE = 5` | Un percentil de país sobre 5 símbolos no significa nada. Con más mercados, el umbral tiene que poder subir por población. |
| `lib/relativeStrength.js:180-190` | Los pesos de `rsRawComposite` (.38/.24/.14/.34/.18/.08/.16/−.12) | Conviven con OTRA fórmula de RS (40/20/20/20 sobre 13/26/39/52 semanas, `scripts/rs-universe.mjs`). Dos definiciones de "fuerza relativa" en el mismo producto. Deberían ser una, y declarada junto a la población. |
| `lib/materializedScanner.js:330-331` | `riskRewardScore → 45`, `rsAnchor → 50` | Fabrican un valor neutro donde no hay dato. Ya documentado en `docs/analisis-compuesto-2026-08-15.md` §12; el `50` bloquea además el criterio de E.2. |
| `lib/screenerComposite.js:148` | `sectorScore → 40` por defecto | Igual. Y el grupo temático de un valor japonés no es comparable con el de uno estadounidense: el `sectorScore` se calcula por grupo dentro de la población, así que hereda el parámetro. |
| `lib/scoringEngine.js:883-890` | `compositeLabel` 85/75/65/55 | Son cortes sobre una distribución. Si cambia la población, cambia la distribución y las etiquetas dejan de significar lo mismo. |
| `lib/leaderboards.js:410-434` | Umbrales de pertenencia 45/50/55 | Idem: un `>= 45` sobre 3.314 símbolos estadounidenses no selecciona la misma fracción que sobre 15.000 internacionales. |
| `lib/scoring.js:153-157` | Régimen de mercado 60/72/82 | Idem, y además el "régimen" es el del mercado estadounidense: aplicarlo a valores japoneses es una decisión, no un detalle. |
| `lib/materializedScanner.js` (`baseRejectReason`) | 180 barras, 300 M$, 250 k$, cobertura 40 | Son criterios de invertibilidad en dólares. Un mercado con capitalizaciones menores necesita otros, y hoy además contaminan la definición de población (D.3). |
| `scripts/rs-universe.mjs` | `MIN_BARS_REQUIRED = 261`, `DISCONTINUITY_FACTOR_THRESHOLD = 3` | Ya son constantes de población en la práctica; solo les falta vivir en el catálogo en vez de en un script. |

De todas, las dos primeras y `minBars` son las que **hay que resolver en el
mismo movimiento** que la tabla, porque definen qué entra en ella. El resto
puede esperar, pero conviene que esperen en una lista, no en el olvido.

---

# PARTE G — Recomendación

**Hacerlo. En dos pasos, y el primero cuesta casi nada.**

### Paso 1 — El nocturno escribe lo que ya calcula (independiente, sin riesgo)

Una tabla `rs_daily_items` (o el nombre que sea) con
`(population_key, trade_date, symbol)` como clave, más `rs_raw`, `rs_pct`,
`rank_index`, `sample_size`, `engine_version`. La escribe el nocturno con los
percentiles que **ya tiene en memoria**. Nadie la lee todavía.

Con eso, y sin cambiar una sola decisión del producto, se gana lo que hoy no
existe: **poder comparar el percentil de un símbolo consigo mismo de un día
para otro.** Hoy eso es imposible, porque el número de ayer se calculó con otra
muestra.

Antes del paso 1 hay que cerrar **una** decisión: la población (D.3). Es la
única que no admite marcha atrás barata.

### Paso 2 — El compuesto lee, y nadie más calcula

`rsAnchor` pasa a leer la tabla. `enrichRelativePercentiles` deja de ser
llamable desde los caminos de scoring (queda para el cálculo nocturno). Los
símbolos que no están en la tabla se quedan **sin `rsAnchor`**, con el compuesto
renormalizado — que es lo que el motor ya hace bien desde el arreglo del
término IPO. Y con ello mueren los tres fallbacks de E.2 (`50`, `?? 50`, `45`).

### Por qué esto y no las otras dos vías

- **Frente al percentil de lote (statu quo):** resuelve la incomparabilidad de
  raíz, que es el problema real y está medido (8-14 puntos de desplazamiento en
  siete de siete símbolos comprobados).
- **Frente a `rsRating` semanal:** el semanal llega con 6-8 días de retraso y
  tiene un 7% de huecos. Un percentil diario propio no tiene ninguno de los dos
  problemas y además usa la fórmula del compuesto, no otra distinta.
- **Frente a mi propia recomendación anterior** (`docs/analisis-compuesto-2026-08-15.md`
  §11.3, donde propuse cambiar `rsGlobalPct` por `rsRating`): la retiro. Era la
  opción barata cuando no había forma de fijar la población; la hay desde el 15
  de agosto. `rsRating` sigue siendo mejor que el percentil de lote, pero es un
  parche frente a arreglar la escala de medida.

### Lo que NO recomiendo

- **No copiar el esquema de `rs_weekly_items`.** Cuadruplica el tamaño con
  campos que ya viajan en `scan_results`.
- **No poblar la tabla con retroactividad** antes de decidir la población. Si
  se cambia después, el histórico deja de ser comparable y se habrá reproducido
  el problema en una tabla nueva.
- **No dejar `enrichRelativePercentiles` accesible desde el scoring** después
  del paso 2. La lección de `lib/rsCanonical.js` es que la fuente única se
  impone quitando las alternativas, no documentándolas.

---

# LO QUE NO HE VERIFICADO

1. **No he medido el tiempo real de escritura de la tabla.** Los 30-60 s son
   una cota superior derivada de los 298 ms/llamada que el repo ya tenía
   medidos para otra operación (`lib/scanPercentileFinalization.js:125`), no
   una medición nueva.
2. **No he medido el tiempo real del nocturno.** Los ≈255 s de análisis salen
   de `docs/adr-escaneo-nocturno.md` B.8, que los declara explícitamente como
   estimación aritmética sobre cifras de otro paso y otra escala.
3. **No he comprobado cuántos símbolos del universo tienen menos de 261
   barras.** La cifra de 4.868 es el `sample_size` del snapshot semanal del
   2026-08-09; la diferencia con los ~5.605 del universo (~737 símbolos, 13%)
   mezcla histórico insuficiente con series discontinuas, y no he separado las
   dos causas.
4. **No he verificado el camino del escaneo interactivo end-to-end** con la
   tabla propuesta. Que `percentileScope: "final"` exista no garantiza que
   todas sus superficies lean de ahí.
5. **No he evaluado el coste de índices** de la tabla nueva. Los 155-262 MB/año
   son solo los datos; un índice sobre `(population_key, trade_date, symbol)`
   añade lo suyo y no lo he calculado.
6. **No he mirado qué pasa con `scan_symbol_history`** si el percentil cambia
   de fuente. Ese histórico guarda observaciones con `scoring_engine_version`,
   y un cambio de escala del RS debería bumpearla igual que lo ha hecho la
   retirada del término IPO en esta misma sesión.
7. **La recomendación sobre la población (los "analizables", ~4.868)
   contradice en parte la decisión del dueño** tal como la formuló ("el mercado
   estadounidense completo"). La diferencia práctica son ~737 símbolos sin
   histórico suficiente o con series rotas, que no se pueden medir de todos
   modos. Si el dueño prefiere la definición literal, el número cambia pero el
   diseño no.
