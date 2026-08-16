# Auditoría de los criterios de etapa

Fecha: 2026-08-16
Rama: `codex/statsedge-ui-polish` · BASE_SHA: `87ec3f2`
Alcance: los criterios que deciden en qué etapa está un valor.
Naturaleza: **auditoría**. No se ha modificado código ni se ha escrito en
Supabase.

Escaneo auditado: `materialized:US:2026-08-16:o0:l5609`,
`scan_id = b9ac783f-52f0-4dd9-a65e-f45e2c38f886`, creado
2026-08-16T03:57:58Z, 3.313 filas guardadas de 5.609 símbolos analizados.

Convención de este documento: **[MEDIDO]** = contado o recalculado sobre
datos reales, con la consulta al lado. **[ESTIMADO]** = extrapolación
desde una muestra, con intervalo. **[LECTURA]** = afirmación derivada de
leer el código, sin datos que la confirmen.

---

## Resumen

1. Hay **siete** trozos de código que deciden una etapa, con **cinco
   criterios distintos**. El canónico es `lib/weeklyStage.js`.
2. El clasificador canónico **no tiene etapa 1 ni etapa 3**. Emite cuatro
   estados: `stage2`, `stage4`, `base`, `mixed`. Las dos etapas que la
   metodología define por una media plana no existen como categoría.
3. La etiqueta **«Base» agrupa dos situaciones opuestas**: precio sobre
   una media de 30 semanas que sube, y precio sobre una media de 30
   semanas que cae. La única condición para entrar en «Base» es
   `price > slowMa`; la pendiente no se mira.
4. La columna «Etapa» y el filtro «Etapa 2» **no usan el mismo
   criterio**. 192 filas dicen «Etapa 2» en la tabla y el filtro las
   rechaza; 53 no dicen «Etapa 2» y el filtro las acepta. [MEDIDO]
5. Los cinco ETF de referencia **están bien clasificados** como etapa 2.
   Lo que falla es la constelación: la zona se deduce buscando el
   carácter `"2"`, `"3"` o `"4"` dentro de un texto, y el literal
   `"Bajo MM30s"` contiene un `3`, así que un valor **por debajo** de su
   media de 30 semanas se dibuja en la zona de **techo**. [MEDIDO]
6. La distribución es plausible (nada por encima del 38% en una sola
   categoría), así que el problema **no se ve** mirando el reparto: hay
   que mirar el criterio.
7. Confirmadas las dos señales de partida: `baseWeeks` vale exactamente
   `13` en las 3.313 filas [MEDIDO], y `weekInStage` colapsa a una
   constante del histórico cuando la racha real lo supera [MEDIDO].

---

# PARTE A — Qué se calcula hoy

## A.1 — Cuántas implementaciones hay

Siete lugares deciden una etapa. No son siete copias de lo mismo: son
cinco criterios distintos.

| # | Fichero | Marco | Criterio | Quién lo consume |
|---|---|---|---|---|
| 1 | `lib/weeklyStage.js` | Semanal 10W/30W | **canónico** | La columna «Etapa», la ficha, la amplitud |
| 2 | `lib/methodologyEngine.js` `stageStateForRow` | Diario 50/150/200 | fallback si no hay estado semanal | Ficha, `stockRows` |
| 3 | `lib/screenerPipeline.js` `stageLabel` | Diario 50/150/200 | fallback textual | `screenerMarket.jsx` |
| 4 | `lib/trendStructure.js` `stage2RejectDetail` | Semanal **y** diario | doble puerta | Filtro `requireStage2` |
| 5 | `app/api/market-health/route.js` `stage30wLabel` | Semanal 30W | propio, sin media rápida | Salud de mercado, constelación |
| 6 | `app/api/market-health/route.js` `stageLabel` | Diario 50/200 | propio | Salud de mercado (campo `stage`) |
| 7 | `lib/leaderboards.js` `isStage2` | Diario + puntuaciones | propio | Lista «Top Etapa 2 Global» |

Sí hay una diaria y una semanal, como sospechabas. Pero hay más de dos.

`lib/stageDisplay.js` no clasifica: sólo traduce el `state` a una palabra.
Su cabecera lo dice y es cierto — la unificación de la **escritura** está
bien hecha y no es la fuente del problema.

## A.2 — El criterio canónico, citado completo

`lib/weeklyStage.js`, líneas 1-5 — los umbrales por defecto:

```js
export const DEFAULT_WEEKLY_STAGE_SETTINGS = {
  fastWeeks: 10,
  slowWeeks: 30,
  slopeWeeks: 10,
};
```

Líneas 67-108 — **la clasificación entera**:

```js
function stageLabel({ price, fastMa, slowMa, slowMaSlopePct, fastWeeks, slowWeeks }) {
  if (![price, fastMa, slowMa, slowMaSlopePct].every(Number.isFinite)) {
    return {
      state: "insufficient_history",
      label: "Historico semanal insuficiente",
      detail: `Requiere al menos ${slowWeeks} semanas para clasificar con medias ${fastWeeks}W/${slowWeeks}W.`,
    };
  }
  if (price > fastMa && fastMa > slowMa && slowMaSlopePct > 0) {
    return {
      state: "stage2",
      label: "Stage 2 probable",
      detail: `Precio sobre media ${fastWeeks}W, ${fastWeeks}W sobre ${slowWeeks}W y media ${slowWeeks}W ascendente.`,
    };
  }
  if (price < slowMa && slowMaSlopePct < 0) {
    return {
      state: "stage4",
      label: "Stage 4 probable",
      detail: `Precio bajo media ${slowWeeks}W y media ${slowWeeks}W descendente.`,
    };
  }
  if (price > slowMa) {
    return {
      state: "base",
      label: "Base / transicion",
      detail: `Precio sobre media ${slowWeeks}W, pero la alineacion ${fastWeeks}W/${slowWeeks}W aun no confirma Stage 2.`,
    };
  }
  if (price < fastMa && price >= slowMa) {
    return {
      state: "mixed",
      label: "Bajo media rapida",
      detail: `Precio bajo media ${fastWeeks}W, pero aun cerca o sobre media ${slowWeeks}W.`,
    };
  }
  return {
    state: "mixed",
    label: "Debil / mixta",
    detail: `La estructura semanal ${fastWeeks}W/${slowWeeks}W no confirma una etapa clara.`,
  };
}
```

Y cómo se calculan las tres entradas (líneas 110-126):

```js
function stageAtOffset(weeks = [], offset = 0, config = DEFAULT_WEEKLY_STAGE_SETTINGS) {
  const price = finite(weeks[offset]?.close);
  const fastMa = sma(weeks, config.fastWeeks, offset);
  const slowMa = sma(weeks, config.slowWeeks, offset);
  const slowMaPrevious = sma(weeks, config.slowWeeks, offset + config.slopeWeeks);
  const slowMaSlopePct = Number.isFinite(slowMa) && Number.isFinite(slowMaPrevious) && slowMaPrevious > 0
    ? ((slowMa / slowMaPrevious) - 1) * 100
    : null;
```

**Los valores exactos**

| Parámetro | Valor | Rango admitido | Dónde |
|---|---|---|---|
| Media rápida | **10 semanas** | 2–80 | `clampInt(..., 2, 80)` |
| Media lenta | **30 semanas** | 3–120, forzado a `> fastWeeks` | `Math.max(rawSlow, fastWeeks + 1)` |
| Ventana de pendiente | **10 semanas** | 2–40 | `clampInt(..., 2, 40)` |
| Umbral de pendiente alcista | **`> 0`** estricto | — | `slowMaSlopePct > 0` |
| Umbral de pendiente bajista | **`< 0`** estricto | — | `slowMaSlopePct < 0` |
| Histórico mínimo | **40 semanas** (30 + 10) | — | implícito en `sma(weeks, 30, 10)` |

Los tres primeros son configurables desde la interfaz
(`ScreenerShell.jsx:384-386`) y el nocturno los recibe vía
`lib/serverScanRunner.js:329-331`. **Los umbrales de pendiente no son
configurables y no tienen banda muerta: `0.001%` cuenta como
«ascendente».**

La media es **simple sobre cierres semanales**, y la semana se define
como semana ISO empezando en lunes:

```js
function weekKey(date = "") {
  const d = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return date;
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
```

La pendiente **no es una regresión ni una derivada**: es la variación
porcentual entre el valor de la media hoy y el valor de la media hace 10
semanas. Es una medida legítima, pero conviene saberlo: mide el
desplazamiento de la media, no su inclinación instantánea.

### Una rama es código muerto

La cuarta rama (`price < fastMa && price >= slowMa`, etiqueta
`"Bajo media rapida"`) es **inalcanzable**. La rama anterior ya capturó
todo `price > slowMa`, así que llegar aquí exige `price === slowMa`
exactamente. [LECTURA]

Confirmado [MEDIDO]: cero filas de las 3.313 llevan esa etiqueta.

```
GET /rest/v1/scan_results
  ?scan_id=eq.b9ac783f-52f0-4dd9-a65e-f45e2c38f886
  &metrics->>weeklyStageLabel=eq.Bajo%20media%20rapida
  &select=symbol
  Prefer: count=exact
→ 0
```

## A.3 — ¿Coinciden los caminos entre sí?

### A.3.1 El camino diario y el semanal discrepan en el 40% de las filas

La rama diaria de `lib/methodologyEngine.js:199-221` sólo actúa si la
fila no trae estado semanal, pero define su propia taxonomía con los
mismos nombres:

```js
  if (gt(price, sma50) && gt(price, sma150) && gt(price, sma200) && gt(sma50, sma150) && gt(sma150, sma200) && gt(sma200Slope, 0)) {
    return { key: "stage2", label: "Etapa 2 probable", detail: "Precio y medias 50/150/200 alineadas con SMA200 ascendente." };
  }
  if (gt(price, sma200) && !gt(sma200Slope, 0)) {
    return { key: "base", label: "Base / transición", detail: "Precio sobre SMA200, pero tendencia larga aún no confirma." };
  }
  if (gt(price, sma200) || gt(price, sma50)) {
    return { key: "mixed", label: "Mixta / vigilancia", detail: "Estructura parcial sin confirmación completa." };
  }
  if (!gt(price, sma200) && !gt(sma200Slope, 0)) {
    return { key: "stage4", label: "Etapa 4 probable", detail: "Precio bajo SMA200 con tendencia larga deteriorada." };
  }
```

Apliqué esa rama a las 3.313 filas del nocturno usando sus propios
`price`, `sma50`, `sma150`, `sma200`, `sma200Slope` guardados, y la
comparé con el estado semanal que llevan. [MEDIDO]

| | filas |
|---|---|
| Coinciden | **2.001 / 3.313 = 60,4%** |
| Discrepan | **1.312 / 3.313 = 39,6%** |

Matriz semanal → diaria (las nueve celdas mayores):

| semanal → diaria | filas |
|---|---|
| stage2 → stage2 | 1.054 |
| base → mixed | 642 |
| stage4 → mixed | 330 |
| base → base | 315 |
| stage4 → stage4 | 314 |
| mixed → mixed | 313 |
| stage2 → mixed | 101 |
| stage2 → base | 87 |
| base → stage2 | 52 |
| mixed → stage4 | 49 |
| base → stage4 | 22 |

Hay **22 filas** que el criterio semanal llama «Base» y el diario llama
«Etapa 4», y **52** al revés. No es ruido de borde: son marcos que
discrepan.

Consulta (los campos salen de `metrics` en las filas ligeras y de `raw`
en las completas; hay que mirar los dos):

```
GET /rest/v1/scan_results
  ?scan_id=eq.b9ac783f-52f0-4dd9-a65e-f45e2c38f886
  &select=symbol,rank_index,
    sM:metrics->>weeklyStageState,sR:raw->>weeklyStageState,
    pM:metrics->price,pR:raw->price,
    a50:metrics->sma50,b50:raw->sma50,
    a150:metrics->sma150,b150:raw->sma150,
    a200:metrics->sma200,b200:raw->sma200,
    aSl:metrics->sma200Slope,bSl:raw->sma200Slope
  &order=rank_index.asc
  (paginado en bloques de 400 por rank_index)
```

**Esto hoy no rompe la columna**, porque `stageStateForRow` prefiere el
semanal cuando existe y el nocturno siempre lo escribe. Rompería en
cuanto se lea una fila sin estado semanal (escaneos antiguos), y ahí el
cambio de etiqueta sería silencioso.

### A.3.2 La columna «Etapa 2» y el filtro «Etapa 2» son criterios distintos

`lib/trendStructure.js:55-76` — la puerta del filtro `requireStage2`:

```js
export function stage2RejectDetail(row = {}, settings = {}) {
  const weeklyState = rowText(row, "weeklyStageState");
  const weeklyLabel = rowText(row, "weeklyStageLabel") || "sin dato";
  const fastWeeks = rowNumber(row, "weeklyFastWeeks") ?? Number(settings.stageFastWeeks || 10);
  const slowWeeks = rowNumber(row, "weeklySlowWeeks") ?? Number(settings.stageSlowWeeks || 30);
  const dailyIssue = dailyLeaderTrendIssue(row);

  if (weeklyState) {
    if (weeklyState !== "stage2") {
      if (isDailyStage2(row)) return "";
      return `No cumple etapa 2 semanal ${fastWeeks || 10}W/${slowWeeks || 30}W: ${weeklyLabel}`;
    }
    return dailyIssue ? `Etapa 2 semanal sin confirmación diaria: ${dailyIssue}` : "";
  }

  if (isDailyStage2(row)) return "";
  return dailyIssue || "No cumple etapa 2 diaria con precio, medias 50/150/200 y SMA200 ascendente";
}
```

Es una puerta **OR de dos criterios**: pasa quien sea etapa 2 semanal
*y además* no tenga tacha diaria, o quien sea etapa 2 diaria estricta
aunque el semanal diga otra cosa.

Medido sobre las 3.313 filas: [MEDIDO]

| | filas |
|---|---|
| Columna «Etapa» dice Etapa 2 | **1.246** |
| Pasan el filtro `requireStage2` | **1.117** |
| En ambas | 1.054 |
| **Dicen «Etapa 2» y el filtro las rechaza** | **192** |
| **No dicen «Etapa 2» y el filtro las acepta** | **53** (52 «Base», 1 «Mixta») |
| Solapamiento (Jaccard) | 81,1% |

Un usuario que marque el filtro «Etapa 2» no obtiene las filas cuya
columna dice «Etapa 2». Es la misma palabra en dos sitios con dos
significados.

### A.3.3 El pipeline sí es reproducible

Verifiqué el cálculo bajando las barras diarias de `daily_bars` y
reaplicando `lib/weeklyStage.js` sin tocarlo:

- 52 símbolos elegidos a mano de las cinco etiquetas: **52/52 idénticos**.
- Muestra sistemática de 200 (1 de cada 16 en orden alfabético):
  **199/199 idénticos** (1 descartado por tener menos de 210 barras en
  `daily_bars`).

[MEDIDO] El clasificador es determinista y lo que hay en la base es lo
que el código produce. **El problema no es de ejecución: es de criterio.**

Consulta de barras:

```
GET /rest/v1/daily_bars
  ?symbol=eq.<SYM>&owner_id=eq.personal
  &select=trade_date,high,low,close,volume
  &order=trade_date.desc&limit=1000
```

---

# PARTE B — Contraste con la metodología

## B.4 y B.5 — Divergencias, una a una

La definición de referencia del enunciado:

- Etapa 1: base, precio lateral, media plana **tras una caída**.
- Etapa 2: avance, precio sobre la media, media ascendente.
- Etapa 3: techo, precio lateral, media aplanándose **tras subida**.
- Etapa 4: declive, precio bajo la media, media descendente.

### D-1 · No existen ni la etapa 1 ni la etapa 3 — **error**

El clasificador emite `stage2`, `stage4`, `base`, `mixed`. Ninguna
corresponde a etapa 1 ni a etapa 3. `lib/stageDisplay.js:14-19` lo
confirma en el diccionario de escritura:

```js
const STAGE_WORDS = {
  stage2: { word: "Etapa 2", tone: "stage2" },
  stage4: { word: "Etapa 4", tone: "stage4" },
  base:   { word: "Base",   tone: "base" },
  mixed:  { word: "Mixta",  tone: "mixed" },
};
```

Se podría argumentar que «Base» *es* la etapa 1 con otro nombre. No lo
es, y se demuestra abajo (D-2): «Base» no exige media plana ni caída
previa. Tampoco hay nada que corresponda a etapa 3.

Consecuencia directa: el producto **no puede avisar de un techo**. Un
valor que llevaba meses en etapa 2 y empieza a aplanarse sigue diciendo
«Etapa 2» hasta que el precio pierde la media rápida, momento en el que
salta a «Base» — la misma palabra que usa para un valor que está
construyendo un suelo. Etapa 3 y etapa 1 comparten etiqueta.

### D-2 · «Base» ignora la pendiente — **error**

La única condición para entrar en `base` es `price > slowMa`. La
pendiente de la media de 30 semanas **no se consulta**.

Medido sobre la muestra sistemática de 199 filas: de las **72**
etiquetadas «Base», **32 tienen la media de 30 semanas subiendo** y
**40 la tienen plana o bajando**. [MEDIDO]

Dos ejemplos reales de la misma etiqueta:

| Símbolo | Precio sem. | MM30s | Distancia | Pendiente 10 sem | Etiqueta |
|---|---|---|---|---|---|
| AAPL | 305,93 | 285,41 | **+7,19%** | **+4,70%** | Base |
| ABT | 111,25 | 99,08 | **+12,29%** | **−7,83%** | Base |

AAPL es un valor sobre una media ascendente — etapa 2 por la definición
de referencia, y sólo se queda fuera porque su precio (305,93) está por
debajo de su media de 10 semanas (308,94). ABT es un rebote dentro de
una media que cae a −7,8% en diez semanas: etapa 4 con precio
temporalmente por encima. Reciben la misma palabra.

### D-3 · «Mixta» es una etapa 2 en retroceso, no una ambigüedad — **error de nombre**

Por el orden de las ramas, `mixed` sólo se alcanza cuando
`price <= slowMa` y `slowMaSlopePct >= 0`: precio bajo la media de 30
semanas **con la media no descendente**.

Medido: de las 13 filas «Mixta» de la muestra, **13 de 13** tienen
precio bajo la media y pendiente positiva. [MEDIDO] Ninguna es un caso
ambiguo. El detalle que muestra la ficha —«La estructura semanal 10W/30W
no confirma una etapa clara»— describe mal lo que la regla capturó.

Ejemplo: AAON, precio **−16,66%** bajo su MM30s, con la MM30s subiendo
**+8,51%**. Es un retroceso profundo dentro de una tendencia alcista, o
el principio de una etapa 4. «Mixta» no dice ninguna de las dos.

### D-4 · La exigencia de la media de 10 semanas es un añadido — **divergente, probablemente deliberado**

`stage2` exige tres cosas: `price > fastMa`, `fastMa > slowMa` y
`slowMaSlopePct > 0`. La definición de referencia sólo pide precio sobre
la media de 30 semanas y esa media ascendente.

Es un endurecimiento razonable (evita llamar etapa 2 a un valor que
acaba de perder impulso) y consistente con el resto del producto, que es
Weinstein tamizado por Minervini. **Lo trato como decisión deliberada, no
como error.** Pero tiene un coste medible: [MEDIDO] **32 de las 72**
filas «Base» de la muestra (44,4%) cumplen la definición Weinstein pura
de etapa 2. Extrapolado a las 1.033 «Base» del nocturno: **~459 filas**
que un weinsteiniano llamaría etapa 2 y la tabla llama «Base».

Lo que sí es un problema es que **el producto no documenta el añadido**
en ningún sitio visible ni lo distingue en la etiqueta. Contra el
principio 5 de `docs/principios-producto.md`, no hay página de
metodología que explique que «Base» incluye «etapa 2 que ha perdido su
media de 10 semanas».

### D-5 · Umbral de pendiente sin banda muerta — **error de robustez**

`slowMaSlopePct > 0` y `slowMaSlopePct < 0` no dejan hueco. Una media
que se mueve un 0,05% en diez semanas —plana a cualquier efecto
práctico— cae en «ascendente» o «descendente» según el signo del ruido.

Ejemplos reales del nocturno: [MEDIDO]

| Símbolo | Pendiente 10 sem | Distancia a MM30s | Etiqueta |
|---|---|---|---|
| ABVX | **−0,056%** | −0,32% | **Etapa 4** |
| ABUS | **+0,466%** | +6,53% | **Etapa 2** |
| AFYA | **+0,283%** | −2,32% | Mixta |

ABVX es el caso de libro: media plana, precio pegado a la media. Es
etapa 1 o etapa 3 según de dónde venga. El producto dice «Etapa 4».

Medido sobre la muestra: con un umbral de planitud del ±2% en diez
semanas, **27 de 199 filas (13,6%)** tienen la media plana, y hoy están
repartidas entre «Base» (10), «Etapa 2» (6), «Etapa 4» (8) y «Mixta»
(3). Ninguna se identifica como tal.

### D-6 · No se mira el contexto previo — **error, y es el que impide las etapas 1 y 3**

Distinguir etapa 1 de etapa 3 requiere saber si la media venía cayendo o
subiendo antes de aplanarse. `stageAtOffset` sólo lee dos puntos de la
media: hoy y hace 10 semanas. No hay nada en el módulo que mire más
atrás con ese propósito.

`consecutiveWeeksInStage` sí recorre el histórico, pero para contar
semanas en la etapa actual, no para caracterizar la anterior.

### D-7 · La escala del régimen se aplica a un solo valor — **coherente, sin objeción**

Weinstein aplica etapas tanto a índices como a valores individuales. Que
el producto clasifique acciones sueltas con el mismo marco es correcto y
no lo señalo como divergencia.

## B.6 — ¿Distingue confirmada de tentativa?

**No.** Y el vocabulario se contradice a sí mismo.

El clasificador es explícitamente probabilístico. Los tres literales:

```js
label: "Stage 2 probable"
label: "Stage 4 probable"
label: "Base / transicion"
```

`lib/stageDisplay.js` traduce `stage2` a **«Etapa 2»**, sin el
«probable». `lib/screenerPipeline.js:320` hace lo mismo por otra vía:

```js
  if (r?.weeklyStageLabel) return r.weeklyStageLabel.replace(/\s+probable$/i, "");
```

Es decir: **el único calificativo de incertidumbre que el clasificador
emite se elimina de forma explícita antes de mostrarlo.**

Y en `lib/methodologyEngine.js:250` la etiqueta se vuelve una afirmación:

```js
  if (stage === "stage2") tags.push({ key: "stage2_confirmed", label: "Etapa 2" });
```

`stage2_confirmed` — «confirmada» — sobre un estado que el clasificador
llama «probable». Igual en `lib/scoring.js:92`:

```js
  if (isStage2(r)) reasons.push("Etapa 2 confirmada");
```

y ahí `isStage2` es `isConfirmedStage2`, o sea el criterio **del filtro**,
no el de la columna. La narrativa del compuesto dice «Etapa 2
confirmada» aplicando un tercer criterio distinto del que muestra la
celda de al lado.

Esto choca de frente con el principio 1 de
`docs/principios-producto.md`: *«Una herramienta que dijera "compra"
fingiría una certeza que la metodología no tiene»*. El mismo argumento
vale para «confirmada».

Sobre las etapas 1 y 3 en concreto: **no puede distinguir confirmada de
tentativa porque no las tiene**. Una etapa 1 confirmada (media plana tras
caída, precio construyendo suelo) y un valor que rebota dentro de una
etapa 4 reciben ambos la palabra «Base».

---

# PARTE C — Verificar con datos

## C.7 — Distribución de las 3.313 filas

[MEDIDO]

| Estado | Filas | % |
|---|---|---|
| `stage2` — Etapa 2 | **1.246** | 37,6% |
| `base` — Base | **1.033** | 31,2% |
| `stage4` — Etapa 4 | **655** | 19,8% |
| `mixed` — Mixta | **374** | 11,3% |
| `insufficient_history` | **5** | 0,15% |
| **Total** | **3.313** | 100% |

Consulta (una por estado; hay que sumar `metrics` y `raw` porque las
filas completas escriben en `raw` y las ligeras en `metrics`):

```
GET /rest/v1/scan_results
  ?scan_id=eq.b9ac783f-52f0-4dd9-a65e-f45e2c38f886
  &metrics->>weeklyStageState=eq.<estado>&select=symbol
  Prefer: count=exact
→ stage2 1207 · base 1031 · stage4 655 · mixed 374 · insufficient_history 5

GET ...&raw->>weeklyStageState=eq.<estado>&select=symbol
  Prefer: count=exact
→ stage2 39 · base 2   (las 41 filas completas)
```

**¿Es plausible?** Sí, y ese es justo el problema. En un mercado alcista
(los cinco ETF de referencia están en etapa 2 con la MM30s subiendo entre
+3,6% y +6,1% en diez semanas) un 37,6% en etapa 2 y un 19,8% en etapa 4
es razonable. Nada roza el 90%. **El reparto no delata nada.** Los
defectos de la Parte B son invisibles desde aquí porque están dentro de
las categorías, no en su tamaño.

Lo que sí es anómalo, mirando el reparto con la metodología en la mano:
**el 31,2% de las filas cae en una categoría que no es una etapa** —
«Base» — y otro 11,3% en otra que tampoco lo es. **El 42,5% del universo
no tiene una etapa asignada en el sentido de la metodología**, aunque la
tabla muestre una palabra en todas ellas.

### Nota lateral: la fila completa y la fila ligera no guardan lo mismo

[MEDIDO] Las 41 filas completas escriben `weeklyStageState` en `raw`; las
3.272 ligeras en `metrics`. `lib/marketBreadth.js:263` lee sólo una de
las dos:

```js
    "stage:metrics->>weeklyStageState",
```

Con lo cual la amplitud pierde 41 de 3.313 filas (1,2%). Cobertura
98,8%, por encima del `BREADTH_MIN_COVERAGE_PCT = 60`, así que el
indicador se publica igualmente y el sesgo es despreciable **hoy**. Si
la proporción de filas completas creciera, crecería el agujero en
silencio.

Además, la fila ligera **no guarda la evidencia**: [MEDIDO]

```
metrics->weeklyStageWeek     → 0 de 3.313
metrics->weeklySlowMa        → 0 de 3.313
metrics->weeklySlowMaSlope   → 0 de 3.313
metrics->weeklyDistanceSlowMa→ 0 de 3.313
metrics->sma30w              → 0 de 3.313
raw->weeklySlowMa            → 41 de 3.313
```

`lib/scanLightProjection.js:82-90` sólo declara `weeklyStageState`,
`weeklyStageLabel`, `weeklyFastWeeks` y `weeklySlowWeeks`. Para el 98,8%
del universo, **el producto guarda el veredicto y tira la prueba**: no
puede decir a qué distancia está el precio de su media de 30 semanas ni
cuál es la pendiente que decidió la etiqueta.

## C.8 — Once valores comprobados a mano

Recalculado desde `daily_bars` con `lib/weeklyStage.js`. Los once
coinciden con lo guardado. La columna «juicio» es mi lectura de las
barras contra la definición de referencia.

| # | Símbolo | Precio sem. | MM10s | MM30s | Dist. MM30s | Pend. 10 sem | Etiqueta | Juicio |
|---|---|---|---|---|---|---|---|---|
| 1 | AAMI | 92,51 | 81,32 | 66,95 | +38,17% | +20,32% | Etapa 2 | **Correcta** |
| 2 | ACM | 63,11 | 69,52 | 80,19 | −21,30% | −11,86% | Etapa 4 | **Correcta** |
| 3 | ACGL | 98,71 | 98,61 | 96,48 | +2,31% | +1,75% | Etapa 2 | Correcta pero al borde: la media sube 1,75% en 10 semanas y el precio está a 2,3%. Etapa 2 muy temprana o etapa 1 tardía |
| 4 | **ABUS** | 4,67 | 4,56 | 4,38 | +6,53% | **+0,47%** | Etapa 2 | **Discutible.** Media prácticamente plana (0,47% en diez semanas). Etapa 1 avanzada, no etapa 2 |
| 5 | **AAPL** | 305,93 | **308,94** | 285,41 | +7,19% | +4,70% | Base | **Divergente por diseño (D-4).** Precio sobre media ascendente = etapa 2 Weinstein. Se queda fuera sólo por la MM10s |
| 6 | **ABT** | 111,25 | 98,53 | 99,08 | +12,29% | **−7,83%** | Base | **Errónea.** Rebote sobre una media que cae con fuerza. Etapa 4 con precio por encima |
| 7 | **ABX** | 9,27 | 10,16 | 9,23 | **+0,42%** | +10,29% | Base | *Acaba de cruzar.* Cruce al alza sobre media que sube al 10,3%. Etapa 1→2 en curso; «Base» no lo dice |
| 8 | **ABVX** | 118,96 | 121,49 | 119,35 | **−0,32%** | **−0,06%** | Etapa 4 | **Errónea.** Media plana y precio en la media: etapa 1 o 3. «Etapa 4» es un juicio que los datos no sostienen |
| 9 | **AEM** | 186,46 | 157,99 | 186,49 | **−0,02%** | −2,91% | Etapa 4 | *Acaba de cruzar.* Precio exactamente en la media. La MM10s está un 15% por debajo de la MM30s: viene de caída, aplanándose. Etapa 1 temprana |
| 10 | **AAON** | 87,80 | 109,83 | 105,35 | −16,66% | **+8,51%** | Mixta | Cabecera de D-3. Retroceso profundo con media aún subiendo. Ni la etiqueta ni el detalle lo describen |
| 11 | **ABG** | 210,66 | 212,14 | 207,76 | +1,40% | −3,94% | Base | El criterio **diario** de este mismo repo lo llama **Etapa 4**. Semanal y diario dan veredictos opuestos sobre la misma fila |

De los once: 2 inequívocamente correctas, 2 correctas pero al borde, 2
erróneas (ABT, ABVX), 3 casos límite mal descritos (ABX, AEM, AAON), 1
divergente por diseño (AAPL) y 1 con los dos motores en contradicción
(ABG).

Los casos que pediste explícitamente:
- **Uno que acaba de cruzar la media**: AEM (−0,02%) y ABX (+0,42%).
  Ninguno de los dos recibe una etiqueta que refleje el cruce.
- **Uno con la media plana**: ABVX (−0,06%) y ABUS (+0,47%). Uno acaba
  en «Etapa 4» y el otro en «Etapa 2». La misma situación estructural,
  las dos etiquetas más opuestas del sistema.

Reproducible con:

```
GET /rest/v1/daily_bars?symbol=eq.ABVX&owner_id=eq.personal
  &select=trade_date,high,low,close,volume&order=trade_date.desc&limit=1000
```
y aplicando `weeklyStageForBars(bars)` de `lib/weeklyStage.js` sin
modificar.

### El contador de semanas también es una constante disfrazada

Confirmación de la segunda señal del enunciado, ahora en `weekInStage`.
`consecutiveWeeksInStage` (líneas 128-137) recorre hacia atrás hasta que
el estado cambia — pero `stageAtOffset` devuelve `insufficient_history`
en cuanto se agota el histórico, y eso también rompe el bucle. Resultado:
cuando la racha real supera el histórico disponible, **el número que se
muestra es `semanas_disponibles − 39`**, una propiedad del histórico, no
del valor. [MEDIDO]

| Símbolo | 210 barras | 250 barras | 300 barras | 400 barras |
|---|---|---|---|---|
| AAMI | 5 sem | 13 sem | 20 sem | 20 sem |
| ACA | 5 sem | 13 sem | 18 sem | 18 sem |
| ABR | 5 sem | 13 sem | 24 sem | 40 sem |
| ABTC | 5 sem | 13 sem | 24 sem | 32 sem |
| ACM | 5 sem | 13 sem | 24 sem | 31 sem |

Con 210 barras **todos** dicen 5 semanas. Con 250, **todos** dicen 13.
Es exactamente el modo de fallo de «BASE 13.0 sem»: un número con
aspecto de medida que es una constante de la ventana.

Y la ficha empeora el desacuerdo: el nocturno calcula sobre el chart del
escaneo, mientras `app/api/company-brief/route.js:1496-1497` pide
`range: "MAX"` y `"5A"`. Más histórico, techo distinto, **número
distinto para el mismo valor en la tabla y en la ficha**. [LECTURA — no
he ejecutado la ruta del brief; el efecto está demostrado por la tabla
de arriba, no medido contra el brief en vivo.]

### Confirmación de «BASE 13.0 sem»

`lib/setupPatterns.js:425` fija la ventana:

```js
  const baseRows = rows.slice(0, Math.min(65, rows.length));
```

y la línea 544 la convierte en semanas:

```js
    baseWeeks: baseRows.length ? baseRows.length / 5 : null,
```

65 / 5 = 13,0. [MEDIDO] **Las 3.313 filas del nocturno tienen
`baseWeeks = 13`. Sin una sola excepción.**

```
GET /rest/v1/scan_results?scan_id=eq.b9ac783f-...&metrics->baseWeeks=eq.13&select=symbol
  Prefer: count=exact  → 3313
GET ...&metrics->baseWeeks=not.is.null&select=symbol
  Prefer: count=exact  → 3313
```

No es parte del criterio de etapa —vive en el detector de patrones— pero
confirma la señal del enunciado y comparte el patrón con `weekInStage`.

## C.9 — ¿Hay valores sin etapa?

**Dentro de las 3.313 filas guardadas: 5.** [MEDIDO] Todas con
`insufficient_history`, y en las cinco la causa es real y correcta:

| Símbolo | Barras | Semanas | ¿Suficiente? |
|---|---|---|---|
| BCSS | 183 | 39 | No (faltan 40) |
| CBC | 182 | 39 | No |
| FCRS | 186 | 39 | No |
| GLOO | 185 | 39 | No |
| VACI | 183 | 39 | No |

El clasificador necesita 40 semanas (`sma(weeks, 30, 10)`) y estas cinco
tienen 39. El motivo se propaga correctamente a la superficie:
`lib/screenerColumns.jsx:187` pinta ausencia con
`STAGE_MISSING_REASON`, y `stageWordForState` devuelve `null` para ese
estado en lugar de inventar una palabra. **Ese trozo está bien hecho** y
cumple el principio 3.

**Fuera de las 3.313 hay 2.296 símbolos que no tienen etapa porque no
llegaron a guardarse.** Del `settings.population` del propio escaneo:

```json
"population": {"stored": 3313, "analyzed": 5609, "passedBase": 3313,
               "storedFull": 41, "storedLight": 3272,
               "passedScreen": 41}
"progress": {"saved": 3313, "total": 5609, "errors": 39, "status": "partial"}
```

De 5.609 analizados, 3.313 pasaron el filtro base (`minBars: 180`,
`minPrice: 1`, `minMarketCap: 300000000`, `minAvgTurnover: 250000`) y 39
fallaron por error de proveedor. Los 2.296 restantes no aparecen en
ninguna superficie: no es que salgan sin etapa, es que no salen.

`scan_symbol_history` —la tabla que debería registrar las ausencias— no
tiene filas de esta noche: [MEDIDO]

```
GET /rest/v1/scan_symbol_history?owner_id=eq.personal
  &observed_at=gte.2026-08-16T00:00:00Z&observed_at=lt.2026-08-16T23:59:59Z
  Prefer: count=exact  → 0
(2026-08-15 → 0 · 2026-08-14 → 18)
```

Coherente con lo que ya se sabía: el nocturno que escribe historia está
en rama y sin comitear. Se señala como contexto, no como hallazgo de
esta auditoría.

---

# PARTE D — Los índices

## D.10 — Los cinco ETF: la etapa es correcta, el dibujo no

Los cinco de `app/api/market-health/route.js:11-17`:

```js
const INDEXES = [
  { symbol: "SPY", name: "S&P 500", weight: 30 },
  { symbol: "QQQ", name: "Nasdaq 100", weight: 30 },
  { symbol: "IWM", name: "Russell 2000", weight: 20 },
  { symbol: "DIA", name: "Dow Jones", weight: 10 },
  { symbol: "ACWI", name: "MSCI ACWI", weight: 10 },
];
```

**Primero, un dato que descarta la hipótesis del enunciado:** el
clasificador **no los trata distinto por ser índices**. No hay ninguna
rama por tipo de instrumento en `weeklyStage.js` ni en `market-health`.
Y de hecho **los cinco no están en el nocturno**: [MEDIDO]

```
GET /rest/v1/scan_results?scan_id=eq.b9ac783f-...
  &symbol=in.(SPY,QQQ,IWM,DIA,ACWI)&select=symbol
→ []
```

Su etapa se calcula sólo en la ruta de Salud de mercado, con la quinta
implementación (`stage30wLabel`), que es **más laxa** que la canónica:
sólo pide precio sobre la MM30s y pendiente positiva, sin la media de 10
semanas.

**Segundo, la clasificación es correcta.** Recalculado desde
`daily_bars` con el módulo canónico: [MEDIDO]

| ETF | Precio sem. | MM10s | MM30s | Dist. MM30s | Pend. 10 sem | Estado semanal canónico | `stage30w` |
|---|---|---|---|---|---|---|---|
| SPY | 776,34 | 752,50 | 713,77 | +8,77% | +3,63% | `stage2` | Etapa 2 probable |
| QQQ | 732,95 | 717,26 | 664,88 | +10,24% | +5,46% | `stage2` | Etapa 2 probable |
| IWM | 305,09 | 296,43 | 275,75 | +10,64% | +6,10% | `stage2` | Etapa 2 probable |
| ACWI | 162,29 | 157,66 | 150,12 | +8,11% | +4,01% | `stage2` | Etapa 2 probable |
| DIA | — | — | — | — | — | — | **sin barras en `daily_bars`** |

Los cuatro medibles cumplen las tres condiciones del criterio estricto
con holgura: precio sobre la MM10s, MM10s sobre la MM30s, MM30s
ascendente entre +3,6% y +6,1% en diez semanas. **Que salgan todos en
etapa 2 no es un fallo del clasificador: es que en agosto de 2026 los
cuatro están en etapa 2.** No es sorprendente — son cuatro cortes del
mismo mercado.

DIA no está en `daily_bars`. La ruta de Salud de mercado lo pide en
directo a Yahoo, así que probablemente sí se muestre; no he podido
verificarlo (ver «Lo que no he verificado»).

**Tercero, el apilamiento tiene dos causas y una de ellas es un bug.**

*Causa 1 — la escala se satura.* `RegimeConstellation.jsx:27-31`:

```js
  const [from, to] = STAGE_X[zone];
  const dist = Number.isFinite(distanceSma30w) ? Math.max(-15, Math.min(15, distanceSma30w)) : 0;
  const norm = Math.max(-1, Math.min(1, dist / 10));
  const x = from + ((to - from) / 2) + norm * ((to - from) / 2);
```

La zona 2 va de x=30 a x=54, y `norm` satura a 1 en cuanto la distancia
llega al 10%. Con las distancias medidas: [MEDIDO]

| ETF | Dist. MM30s | `norm` | x | jitter | y |
|---|---|---|---|---|---|
| ACWI | +8,11% | 0,811 | 51,73 | +1,41 | 29,41 |
| SPY | +8,77% | 0,877 | 52,52 | +0,84 | 28,84 |
| QQQ | +10,24% | **1,000** (saturado) | **54,00** | −2,00 | **26,00** |
| IWM | +10,64% | **1,000** (saturado) | **54,00** | −2,00 | **26,00** |

**QQQ e IWM caen en el píxel exacto**: mismo x, y por tanto mismo jitter
(que es determinista sobre x), y por tanto mismo y. No están cerca:
están superpuestos. Los otros dos quedan a 0,8 y 2,3 unidades sobre un
eje de 112. Los cuatro ocupan el 2% del ancho del gráfico.

*Causa 2 — la zona se deduce leyendo dígitos sueltos de un texto.*
`RegimeConstellation.jsx:22-26`:

```js
  const stage = String(stage30w || "");
  let zone = 1;
  if (/2/i.test(stage)) zone = 2;
  else if (/3/i.test(stage)) zone = 3;
  else if (/4/i.test(stage)) zone = 4;
```

y los textos que puede recibir, de `market-health/route.js:211-218`:

```js
function stage30wLabel(x = {}) {
  if (!Number.isFinite(x.price) || !Number.isFinite(x.sma30w) || !Number.isFinite(x.sma30wSlope)) return "Histórico insuficiente";
  if (x.price > x.sma30w && x.sma30wSlope > 0) return "Etapa 2 probable";
  if (x.price > x.sma30w && x.sma30wSlope <= 0) return "Base / transición";
  if (x.price < x.sma30w && x.sma30wSlope >= 0) return "Bajo MM30s";
  if (x.price < x.sma30w && x.sma30wSlope < 0) return "Etapa 4 probable";
  return "Neutral";
}
```

Cruzando las dos:

| Texto | Contiene | Zona | Debería |
|---|---|---|---|
| «Etapa 2 probable» | `2` | 2 | 2 ✓ |
| «Etapa 4 probable» | `4` | 4 | 4 ✓ |
| «Base / transición» | ninguno | 1 (por defecto) | 1, aceptable por accidente |
| **«Bajo MM3<u>0</u>s»** | **`3`** (de «MM**3**0s») | **3 · techo** | 1 o 4 — nunca techo |
| «Histórico insuficiente» | ninguno | 1 | ausencia, no etapa 1 |

**Un valor por debajo de su media de 30 semanas se dibuja en la zona de
techo porque el nombre de la media contiene un tres.** Verificado
ejecutando la función sobre datos reales: los 12 símbolos etiquetados
«Mixta» de mi muestra de 52 producen el texto «Bajo MM30s» y **los 12
caen en la zona 3**. [MEDIDO]

Hoy los cinco ETF están en etapa 2 y el bug no se ve. Se verá el día que
un índice pierda su media de 30 semanas con la media aún plana o
subiendo: aparecerá en el techo de la curva.

Como la constelación sólo se alimenta de los cinco índices, el impacto
actual está acotado a esa pantalla. No afecta a la tabla ni a la ficha.

---

# PARTE E — El veredicto

## E.11 — Criterio a criterio

| # | Criterio | Veredicto | Fundamento |
|---|---|---|---|
| C-1 | Media lenta = 30 semanas | **Correcto** | Coincide con la metodología |
| C-2 | Media simple sobre cierres semanales, semana ISO desde lunes | **Correcto** | Convención estándar y explícita |
| C-3 | Pendiente = variación de la media a 10 semanas | **Correcto** | Medida legítima y estable; no es la única posible |
| C-4 | Etapa 2 exige además `price > MM10s` y `MM10s > MM30s` | **Divergente, deliberado** | Endurecimiento coherente con Minervini. Coste medido: ~459 filas que Weinstein llamaría etapa 2 salen como «Base». **Sin documentar** — incumple el principio 5 |
| C-5 | Etapa 4 = precio bajo MM30s y MM30s descendente | **Correcto** | Coincide con la metodología |
| C-6 | Umbral de pendiente `>0` / `<0` sin banda muerta | **Erróneo** | Una media plana se clasifica por el signo del ruido. 13,6% de las filas con \|pendiente\| ≤ 2% |
| C-7 | «Base» = `price > slowMa`, sin mirar pendiente | **Erróneo** | Agrupa etapa 2 pura y rebote en etapa 4. 44,4% de las «Base» tienen la media subiendo, el resto plana o cayendo |
| C-8 | «Mixta» = resto (precio bajo MM30s, pendiente ≥ 0) | **Erróneo de nombre** | La categoría está bien definida; la palabra y el detalle describen mal lo que captura |
| C-9 | No existe etapa 1 | **Erróneo** | Es una de las cuatro etapas de la metodología. Sin ella no se puede señalar una base en formación |
| C-10 | No existe etapa 3 | **Erróneo** | El producto no puede avisar de un techo. Es la ausencia más costosa para un operador de tendencia |
| C-11 | Sin contexto previo (la media antes de aplanarse) | **Erróneo** | Es la causa técnica de C-9 y C-10 |
| C-12 | Rama `"Bajo media rapida"` inalcanzable | **Erróneo (inocuo)** | Código muerto. 0 filas |
| C-13 | Histórico mínimo 40 semanas, ausencia explícita | **Correcto** | Bien propagado a la superficie. Cumple el principio 3 |
| C-14 | `weekInStage` topado por el histórico | **Erróneo** | Constante disfrazada de medida. 210 barras → «5 semanas» para todos |
| C-15 | La columna y el filtro «Etapa 2» usan criterios distintos | **Erróneo** | 192 + 53 filas en desacuerdo |
| C-16 | Siete implementaciones, cinco criterios | **Erróneo** | El canónico gana hoy por precedencia, no por diseño |
| C-17 | «probable» se elimina al mostrar; `stage2_confirmed` | **Erróneo** | Convierte una clasificación tentativa en afirmación. Choca con el principio 1 |
| C-18 | La fila ligera no guarda la evidencia (MM30s, pendiente, distancia) | **Erróneo** | El 98,8% de las filas tienen veredicto sin prueba |
| C-19 | La constelación deduce la zona buscando dígitos en un texto | **Erróneo** | «Bajo MM30s» → zona de techo |
| C-20 | La constelación satura la escala al ±10% | **Erróneo (cosmético)** | QQQ e IWM en el píxel exacto |
| C-21 | `marketBreadth` lee sólo `metrics->>weeklyStageState` | **Erróneo (menor)** | Pierde 41 de 3.313. Cobertura 98,8%, sobre el mínimo del 60% |
| C-22 | El clasificador no distingue índice de acción | **Correcto** | Y es lo apropiado |

## E.12 — Cuántas filas cambiarían

Aviso importante: cualquier cifra de esta sección depende de **elegir un
umbral de planitud**, que hoy el producto no tiene. Doy la sensibilidad
en vez de un número único. Base: muestra sistemática de 199 filas (1 de
cada 16, orden alfabético), intervalos binomiales al 95%, extrapolados a
3.313. **[ESTIMADO]**

Definición de «media plana»: `|pendiente 10 semanas| ≤ P`. Etapa 1 si la
media venía cayendo en las 20 semanas anteriores; etapa 3 si venía
subiendo.

| Efecto | P = 1% | **P = 2%** | P = 3% | P = 5% |
|---|---|---|---|---|
| Filas que serían **etapa 1 o 3** (hoy inexistentes) | 200 (90–309) | **416 (264–569)** | 633 (452–814) | 1.282 (1.058–1.506) |
| · de ellas, hoy etiquetadas «Etapa 2» | 50 (0–106) | **100 (21–179)** | 233 (115–351) | 433 (278–588) |
| · de ellas, hoy etiquetadas «Etapa 4» | 83 (11–155) | **117 (32–201)** | 133 (43–224) | 316 (181–452) |
| «Base» que es rebote con la MM30s cayendo → **etapa 4** | 616 (437–795) | **533 (364–702)** | 483 (320–645) | 383 (236–530) |
| «Base» que cumple Weinstein puro → **etapa 2** | 533 (364–702) | **499 (335–664)** | 483 (320–645) | 383 (236–530) |
| «Mixta» con la MM30s subiendo → **etapa 2 en retroceso** | 183 (78–288) | **166 (66–267)** | 166 (66–267) | 100 (21–179) |
| **Total con etiqueta distinta de su etapa 1-4** | 1.565 (1.335–1.795) | **1.648 (1.418–1.878)** | 1.798 (1.569–2.027) | 2.181 (1.963–2.399) |

Leído con P = 2%, que es el que me parece defendible:

- **~1.648 de 3.313 filas (49,7%)** llevan hoy una palabra distinta de la
  etapa que les correspondería con una taxonomía Weinstein de cuatro
  etapas. La mitad de ese número (los ~499 «Base» que son etapa 2 pura)
  es **divergencia deliberada** (C-4), no error: el producto decidió
  exigir la media de 10 semanas.
- Descontando esa parte deliberada: **~1.149 filas (34,7%)** cambiarían
  por defectos, no por decisión.
- **~416 filas** recibirían una etapa que hoy el sistema no puede emitir.
  De ellas, ~117 llevan hoy la etiqueta más contraria posible («Etapa 4»
  sobre una media plana).
- **~533 filas** dicen «Base» y son rebotes dentro de una tendencia
  bajista.

Efectos **medidos**, no estimados, que no dependen de ningún umbral:

| Efecto | Filas | Base |
|---|---|---|
| Dicen «Etapa 2» y el filtro «Etapa 2» las rechaza | **192 / 3.313** | [MEDIDO] |
| No dicen «Etapa 2» y el filtro las acepta | **53 / 3.313** | [MEDIDO] |
| Discrepancia entre el criterio semanal y el diario | **1.312 / 3.313 (39,6%)** | [MEDIDO] |
| Filas con `baseWeeks` constante = 13 | **3.313 / 3.313** | [MEDIDO] |
| Filas sin la evidencia de su etapa guardada | **3.272 / 3.313 (98,8%)** | [MEDIDO] |
| Filas invisibles para `marketBreadth` | **41 / 3.313** | [MEDIDO] |
| Símbolos «Mixta» que la constelación pondría en techo | **12 / 12** de la muestra | [MEDIDO] |

### Orden que propondría, si sirve de algo

No es parte del encargo, pero la auditoría deja un orden natural:

1. **C-15** (columna ≠ filtro) — es el único defecto que el usuario ya
   puede tropezar hoy sin saberlo, y no requiere decidir nada nuevo.
2. **C-17** (el «probable» borrado, `stage2_confirmed`) — es de texto y
   toca el principio 1.
3. **C-19** (`/3/` sobre «Bajo MM30s») — una línea, efecto visible.
4. **C-6 + C-7 + C-9 + C-10** — el bloque del criterio. Es una decisión
   de producto (¿qué es una media plana?), no una corrección mecánica.
5. **C-14, C-18** — la evidencia y el contador.

---

# CONFIANZA

**Alta (medición directa, reproducida):**
- El inventario de las siete implementaciones y sus criterios. Leídos
  íntegros y citados literalmente.
- La distribución de las 3.313 filas. Contada con `Prefer: count=exact`
  sobre `metrics` y `raw` por separado, suma exacta a 3.313.
- La reproducibilidad del clasificador: 52/52 y 199/199 recálculos
  idénticos a lo guardado, usando `lib/weeklyStage.js` sin modificar
  sobre barras de `daily_bars`.
- Las cifras 192 / 53 / 1.312 / 3.313 / 41 / 11: todas contadas sobre
  las filas reales del escaneo, con réplicas literales del código de
  producción (`stage2RejectDetail`, `isDailyStage2`,
  `dailyLeaderTrendIssue`, `stageStateForRow`, `stage30wLabel`,
  `indexPosition`).
- `baseWeeks = 13` en 3.313/3.313 y `weekInStage` topado: verificados
  con consulta y con experimento de truncado de barras.
- Los cuatro ETF con datos: precio, medias y pendiente calculados desde
  `daily_bars`, con cierre del 2026-08-14.

**Media (lectura de código sólida, sin ejecución de la superficie):**
- Que la rama `"Bajo media rapida"` es inalcanzable. El razonamiento es
  cerrado y las 0 filas lo respaldan, pero no he construido un caso que
  lo pruebe formalmente.
- Que la ficha y la tabla dan `weekInStage` distinto por pedir rangos
  distintos. La dependencia del histórico está medida; el desacuerdo
  concreto entre las dos superficies está deducido de que el brief pide
  `MAX`/`5A` y el nocturno no.
- Que `marketBreadth` pierde las 41 filas completas. La consulta del
  código y el reparto `metrics`/`raw` lo sostienen, pero no he ejecutado
  la ruta de amplitud.

**Baja (estimación declarada):**
- Todos los números de E.12 marcados [ESTIMADO]. Dependen de (a) una
  muestra de 199, (b) mi definición operativa de «media plana» y (c) mi
  regla para separar etapa 1 de etapa 3 (signo de la pendiente en las 20
  semanas anteriores). Ninguna de las tres está en el producto. Doy la
  sensibilidad de P = 1% a 5% precisamente porque la elección domina el
  resultado.
- La calificación «errónea» de ABT y ABVX en C.8 es mi juicio sobre sus
  barras contra la definición del enunciado, no una medición.

---

# LO QUE NO HE VERIFICADO

1. **La ruta de Salud de mercado en ejecución.** No he llamado a
   `/api/market-health`. Todo lo de la Parte D sobre `stage30wLabel` y
   la constelación viene de leer el código y de reaplicar sus funciones
   sobre barras de `daily_bars`. En particular **no he verificado que
   DIA aparezca**: no está en `daily_bars`, la ruta lo pide en directo a
   Yahoo, y el commit `107da9c` afirma que se verificó a 536,80 el 14 de
   agosto. Lo doy por bueno sin comprobarlo.
2. **La constelación renderizada.** No he abierto la pantalla. El
   apilamiento de QQQ e IWM está calculado con la fórmula exacta de
   `indexPosition`, no observado en pantalla.
3. **La ficha del valor en ejecución.** No he llamado a
   `/api/company-brief`. La afirmación de que la ficha y la tabla pueden
   dar `weekInStage` distinto es deducción, no medición.
4. **El histórico completo.** `daily_bars` tiene ~400 barras por símbolo
   (≈82 semanas). El nocturno usa el chart del proveedor, que puede
   traer más. Como los 251 recálculos coincidieron al 100%, el **estado**
   no depende de eso; el `weekInStage` sí, y ahí mis cifras son un suelo,
   no el valor de producción.
5. **Otros escaneos.** Todo se mide sobre un único escaneo (US,
   2026-08-16). No he comprobado si el reparto o las discrepancias se
   sostienen en otros mercados o en otras noches.
6. **Los símbolos no guardados.** No he investigado los 2.296 que no
   llegaron a `scan_results` más allá de leer `settings.population`. No
   sé cuántos de ellos habrían tenido histórico suficiente para
   clasificarse.
7. **Los tests existentes.** No he ejecutado la suite. `tests/scanHistory.test.js:373`
   cubre `weeklyStageForBars` y la racha semanal, pero no he mirado qué
   cubre exactamente ni si algún test fija el comportamiento que aquí
   señalo como erróneo — dato relevante antes de cambiar nada.
8. **El impacto en RS, compuesto y Listas.** La etapa alimenta
   `weinsteinScore`, `compositeScore` y varias listas. No he medido
   cuánto se movería nada de eso si el criterio cambiara.
9. **La rama `refactor/chart-controller-extraction`.** `AGENTS.md`
   advierte de que diverge sin fusionar. No he comprobado si tiene otra
   versión de este clasificador.

---

## Apéndice — cómo reproducir las mediciones

Todas las consultas son GET de solo lectura contra PostgREST. Ninguna
escribe.

```bash
# distribución por etapa (una por estado, y repetir con raw->>)
curl -s -o /dev/null -D - -G "$SUPABASE_URL/rest/v1/scan_results" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Prefer: count=exact" -H "Range: 0-0" \
  --data-urlencode "scan_id=eq.b9ac783f-52f0-4dd9-a65e-f45e2c38f886" \
  --data-urlencode "metrics->>weeklyStageState=eq.stage2" \
  --data-urlencode "select=symbol" | grep -i content-range
```

Para el recálculo se importa `lib/weeklyStage.js` tal cual y se le pasan
las barras de `daily_bars` en orden descendente por `trade_date`, con las
claves `{date, high, low, close, volume}` — el mismo contrato que usan
`researchRow.js:107` y `materializedScanner.js:411`.
