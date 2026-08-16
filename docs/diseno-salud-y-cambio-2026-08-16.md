# Diseño: la Etapa, el Pulso y los Cambios de estructura

Fecha: 2026-08-16
Rama: `codex/statsedge-ui-polish` · BASE_SHA: `bfbcd96`
Naturaleza: **diseño**. Ningún cambio de código, ninguna escritura en
Supabase, ningún escaneo ejecutado.

Encargo: separar tres piezas que hoy están mezcladas o ausentes — la
etapa (fase del ciclo), la salud de corto plazo, y los hechos que la
metodología asocia a un cambio de tendencia.

Población de referencia: escaneo nocturno
`scan_id = b9ac783f-52f0-4dd9-a65e-f45e2c38f886`
(`materialized:US:2026-08-16:o0:l5609`), 3.313 filas, barras hasta el
**2026-08-14**.

Convención: **[MEDIDO]** = contado o recalculado sobre datos reales, con
la consulta al lado. **[ESTIMADO]** = extrapolación declarada.
**[LECTURA]** = derivado de leer el código. **[FUENTE]** = criterio de la
literatura, con enlace.

Método de datos: la herramienta `supabase_query` para lo puntual y, para
los volúmenes que no soporta, un script local de **solo GET** contra
`rest/v1` con paginado y agregados en local. Para el recálculo de etapas
se importó `lib/weeklyStage.js` **sin modificarlo** y se le pasaron las
barras de `daily_bars`.

---

## Aviso previo: tres cifras del encargo que no he podido reproducir

El encargo parte de que «1.775 filas pasan el filtro sin estar en etapa
2» y que «hoy pasan unas 3.000 con el filtro actual». Son las cifras del
mensaje del commit `bfbcd96`. **El documento que ese commit añade —la
auditoría— dice otra cosa, y mis mediciones coinciden con el documento,
no con el mensaje.** Antes de diseñar sobre ellas hay que decir esto.

Repliqué `stage2RejectDetail` (el código real del filtro) y lo evalué
sobre las 3.313 filas, junto con otras siete lecturas posibles de «el
filtro»: [MEDIDO]

| Criterio evaluado sobre las 3.313 filas | pasan | pasan sin ser «Etapa 2» | «Etapa 2» que quedan fuera |
|---|---|---|---|
| **`stage2RejectDetail` — el código real** | **1.117** | **53** | **182** |
| `isDailyStage2` sola | 1.107 | 53 | 192 |
| `dailyLeaderTrendIssue` vacío | 1.121 | 57 | 182 |
| `dailyLongBiasIssue` vacío (`>SMA200` y pend. `≥ −2`) | 2.104 | 887 | 29 |
| `price > SMA200` | 2.297 | 1.055 | 4 |
| `price > SMA200` y `SMA200Slope > 0` | 1.878 | 723 | 91 |
| `price > SMA50` y `> SMA200` y `slope > 0` | 1.429 | 283 | 100 |
| `price > SMA50` | 2.220 | 983 | 9 |

Ninguna da 1.775 ni ~3.000. La cifra más cercana a «unas 3.000» es
**3.313: el universo entero** — lo que la tabla muestra cuando el filtro
está desactivado, que es el estado por defecto de casi todos los presets
(`requireStage2: false` en `early`, `broad`, `ipo` y `weakness`;
`lib/screenerFilterCatalog.js:170-174`). [LECTURA]

Lo mismo con los índices: el mensaje dice «solo SPY está en etapa 2;
QQQ, IWM, DIA y ACWI están en base». Recalculado desde `daily_bars` con
el módulo real: [MEDIDO]

| ETF | Precio sem. | MM10s | MM30s | ¿P>MM10s? | ¿MM10s>MM30s? | Pend. 10 sem | Etapa actual | Etapa estricta |
|---|---|---|---|---|---|---|---|---|
| SPY | 776,34 | 752,50 | 713,77 | sí | sí | +3,63% | `stage2` | Etapa 2 |
| QQQ | 732,95 | 717,26 | 664,88 | sí | sí | +5,46% | `stage2` | Etapa 2 |
| IWM | 305,09 | 296,43 | 275,75 | sí | sí | +6,10% | `stage2` | Etapa 2 |
| ACWI | 162,29 | 157,66 | 150,12 | sí | sí | +4,01% | `stage2` | Etapa 2 |
| DIA | — | — | — | — | — | — | **sin barras en `daily_bars`** | — |

Los cuatro medibles cumplen las tres condiciones con holgura, bajo el
criterio actual y bajo el estricto. **No he podido reproducir «solo SPY».**

**Qué sí es cierto del hallazgo, y es lo que importa para este diseño:**
la puerta del filtro nunca deja que la MM30 semanal decida sola. Cuando
la etapa semanal es 2, añade una comprobación diaria que puede
tumbarla; cuando no lo es, una comprobación diaria puede colarla. Esa es
la avería cualitativa, y es real. Las magnitudes que uso a partir de
aquí son las de la tabla, no las del mensaje.

Sugerencia práctica: si la cifra 1.775 viene de una consulta concreta,
merece la pena localizarla — puede estar midiendo otra población (el
`server-scan` del 15-ago tiene 5.838 filas) o una definición distinta de
«etapa 2». No cambia el diseño; sí cambiaría el tamaño del efecto.

---

# PARTE A — Los criterios de la escuela

Lo que sigue es lo **concreto y calculable**. He descartado los consejos
cualitativos («busca acumulación institucional») que no se pueden
convertir en un número.

Una advertencia sobre las fuentes que vale para toda esta parte: la
literatura de Weinstein da **definiciones estructurales precisas** (qué
es cada etapa) pero **casi ningún umbral numérico** (cuánto es «plana»,
cuánto volumen es «fuerte»). Los umbrales duros vienen de la rama
O'Neil/IBD y de Minervini. Al consultar la fuente comunitaria de la
escuela sobre indicadores de amplitud, la propia página enumera los
indicadores sin dar un solo nivel de corte [FUENTE:
[stageanalysis.net](https://www.stageanalysis.net/blog/17614/timing-the-market-trading-using-breadth-indicators-us-stocks-weight-of-evidence)].
Es un «peso de la evidencia», no un semáforo. **Eso encaja con el
principio 1: describir el estado, no dictar el corte.**

## A.4 — Criterios del ciclo (la etapa)

| # | Criterio | Definición operable | Fuente |
|---|---|---|---|
| A1 | Media de referencia | SMA de **30 semanas** sobre cierres semanales | Weinstein [FUENTE: [TrendSpider](https://trendspider.com/blog/master-market-trends-with-ai-powered-weinstein-stage-analysis/)] |
| A2 | Etapa 1 · base | Precio lateral en torno a una MM30 **que se aplana tras una caída** | ídem |
| A3 | Etapa 2 · avance | Precio **sobre** una MM30 **ascendente** | ídem |
| A4 | Etapa 3 · techo | Precio lateral, MM30 **que se aplana tras una subida** | ídem |
| A5 | Etapa 4 · declive | Precio **bajo** una MM30 **descendente** | ídem |
| A6 | Confirmación de la 1→2 | Ruptura de la resistencia de la base **con volumen alto** | Weinstein. *Sin múltiplo numérico en las fuentes consultadas* [FUENTE: [Deepvue](https://deepvue.com/indicators/stan-weinstein-stage-analysis-when-to-buy/)] |
| A7 | Aviso de 2→3 | La MM30 «empieza a aplanarse tras un avance prolongado»; el precio pierde la MM de 10 semanas / 50 días con volumen alto | ídem |
| A8 | Fuerza relativa (Mansfield) | `MRS = 100 × (DRS_hoy / SMA(DRS, 52) − 1)`, con `DRS = precio_valor / precio_índice`, semanal, n=52, índice SPY. Weinstein exige que en la ruptura la MRS esté **subiendo y cerca o por encima de 0** | [FUENTE: [ChartMill](https://www.chartmill.com/documentation/technical-analysis/indicators/35-Mansfield-Relative-Strength), [Deepvue](https://deepvue.com/knowledge-base/deepvue-custom-indicators-mansfield-rs/)] |

**Nota importante sobre A2/A4:** las dos etapas que hoy no existen en el
producto se definen por *la media plana* **más el contexto previo**. Sin
saber qué hacía la media antes de aplanarse, etapa 1 y etapa 3 son
indistinguibles. Ese es el ingrediente que falta, no un umbral.

## A.5 — Criterios de mercado (salud a corto y deterioro)

| # | Criterio | Definición operable | Fuente |
|---|---|---|---|
| M1 | **Día de distribución** | Sesión en la que el índice cierra **−0,2% o peor** con **volumen mayor que la sesión anterior**. Se cuentan los de las **últimas 25 sesiones**; caducan a las 25, o antes si el índice sube un **6%** desde ese día | IBD [FUENTE: [aiStockSelection](https://www.aistockselection.com/en/glossary/distribution-day), [Grokipedia](https://grokipedia.com/page/Distribution_day)] |
| M2 | Umbral de acumulación de M1 | **4-5 en 3-4 semanas** = presión; **6 o más** suele preceder al cambio a corrección | ídem |
| M3 | **Follow-through day** | En un intento de rebote, a partir del **4.º día**, cierre **+1,5%** o más con volumen mayor que el día previo | IBD [FUENTE: [aiStockSelection](https://www.aistockselection.com/en/glossary/follow-through-day)] |
| M4 | % de valores sobre su media larga | Porcentaje del universo sobre su MM de 200/150/50 días — y sobre su MM30 semanal | [FUENTE: [stageanalysis.net](https://www.stageanalysis.net/blog/17614/timing-the-market-trading-using-breadth-indicators-us-stocks-weight-of-evidence)] |
| M5 | Línea de avances/descensos | Acumulado de (valores que suben − valores que bajan) por sesión | Weinstein, cap. 8 [FUENTE: [TraderLion](https://traderlion.com/trading-books/secrets-for-profiting-in-bull-and-bear-markets/)] |
| M6 | Nuevos máximos − nuevos mínimos | Valores en máximo de 52s menos los que están en mínimo de 52s | ídem |
| M7 | NYSE Bullish Percent | % de valores con señal alcista de punto y figura | ídem |
| M8 | **Divergencia índice / amplitud** | El índice marca máximos mientras cae el % de valores que lo acompañan | ídem |
| M9 | Volumen en subidas vs bajadas | Volumen acumulado de sesiones al alza dividido por el de sesiones a la baja | Weinstein («volumen sube en semanas alcistas y baja en bajistas») [FUENTE: [Deepvue](https://deepvue.com/indicators/stan-weinstein-stage-analysis-when-to-buy/)] |

## A.6 — Criterios de sector / grupo

| # | Criterio | Definición operable | Fuente |
|---|---|---|---|
| S1 | Fuerza relativa del grupo | RS del grupo frente al índice, y su **evolución** semana a semana | Weinstein (rotación sectorial, cap. 8) [FUENTE: [TraderLion](https://traderlion.com/trading-books/secrets-for-profiting-in-bull-and-bear-markets/)] |
| S2 | Amplitud dentro del grupo | % de valores del grupo sobre su media larga | [FUENTE: [stageanalysis.net](https://www.stageanalysis.net/blog/17614/timing-the-market-trading-using-breadth-indicators-us-stocks-weight-of-evidence)] — presentado allí como «% de valores sobre su MM de 150 días» por sector |
| S3 | Etapa del grupo | El propio ETF/índice del grupo clasificado con A1-A5 | Weinstein aplica las etapas también a grupos |
| S4 | Concentración vs dispersión | Qué fracción del liderazgo (los de RS más alto) se concentra en pocos grupos | Derivado de S1; sin fuente con umbral |

## A.7 — Criterios del valor individual (deterioro antes de romper)

| # | Criterio | Definición operable | Fuente |
|---|---|---|---|
| V1 | Aplanamiento de la MM30 | La pendiente de la MM30 se reduce tras un avance prolongado | Weinstein [FUENTE: [Deepvue](https://deepvue.com/indicators/stan-weinstein-stage-analysis-when-to-buy/)] |
| V2 | Pérdida de la MM de 10 semanas | El precio pierde su MM10s / SMA50 **con volumen alto** | ídem |
| V3 | Divergencia precio/volumen | Nuevo máximo de precio **con menos volumen** que el máximo anterior | ídem |
| V4 | Deterioro de la fuerza relativa | La Mansfield RS cae, o cruza por debajo de 0, con el precio aún alto | Weinstein [FUENTE: [ChartMill](https://www.chartmill.com/documentation/technical-analysis/indicators/35-Mansfield-Relative-Strength)] |
| V5 | Volumen de bajada > volumen de subida | El acumulado de volumen en sesiones bajistas supera al alcista | ídem |
| V6 | Amplitud de las oscilaciones | «Acción errática con oscilaciones amplias» en la etapa 3 | ídem |
| V7 | **Trend Template (8 criterios)** | (1) P>SMA50 · (2) P>SMA150 · (3) P>SMA200 · (4) SMA50>SMA150 · (5) SMA150>SMA200 · (6) SMA200 subiendo ≥1 mes · (7) P a ≤25% del máximo de 52s · (8) RS ≥ 70 (ideal ≥90). Además: P ≥ 30% por encima del mínimo de 52s | Minervini [FUENTE: [ChartMill](https://www.chartmill.com/trading-ideas/645-Mark-Minervinis-Trend-Template-TTP), [Deepvue](https://deepvue.com/screener/minervini-trend-template/)] |

**El Trend Template es la pieza clave de este encargo.** Los seis
primeros criterios son exactamente lo que hoy hay dentro de
`requireStage2` (`lib/trendStructure.js:44-53`). No es un criterio de
etapa mal escrito: **es el Trend Template de Minervini, completo y
correcto, con el nombre equivocado.** Minervini nunca lo llamó etapa: lo
llamó plantilla de tendencia, y su propósito es exactamente el que el
encargo describe — decir cómo está el valor ahora, no en qué fase del
ciclo está.

---

# PARTE B — Qué se puede calcular hoy

## B.8 y B.10 — Criterio a criterio, con cobertura medida

Cobertura medida sobre las 3.313 filas del nocturno. Consulta patrón:

```
GET /rest/v1/scan_results
  ?scan_id=eq.b9ac783f-52f0-4dd9-a65e-f45e2c38f886
  &metrics-><campo>=not.is.null&select=symbol
  Prefer: count=exact
```

| # | Criterio | ¿Hoy? | Cobertura [MEDIDO] | Fuente del dato |
|---|---|---|---|---|
| A1 | MM30 semanal | **Sí** | 3.308/3.313 = **99,85%** | `daily_bars` (recalculado; 5 símbolos con 39 semanas) |
| A2/A4 | Contexto previo de la media (60 semanas) | **Sí** | 3.242/3.308 = **98,0%** | `daily_bars` |
| A3/A5 | Precio vs MM30 y pendiente | **Sí** | 99,85% | `daily_bars` |
| A6 | Volumen en la ruptura | **Parcial** | `relativeVolume` 3.313 (100%), `volumeSurgePct` 3.313 (100%) | pero *falta el nivel de ruptura de la base* — el pivote hoy no es fiable (principio 7 de `principios-producto.md`) |
| A7 | Aplanamiento tras avance | **Sí** | 98,0% | `daily_bars` |
| A8 | **Mansfield RS** | **Sí, no calculado** | SPY: 400 barras; universo: 99,85% | `daily_bars`. Es `precio/SPY` suavizado a 52 semanas: dos series que ya existen |
| M1 | Días de distribución | **Sí** | SPY, QQQ, IWM, ACWI: sí · **DIA: 0 barras** | `daily_bars` (cierre + volumen) |
| M2 | Umbral de acumulación | **Sí** | ídem | derivado de M1 |
| M3 | Follow-through day | **Sí** | ídem | `daily_bars` |
| M4 | % sobre media larga | **Sí** | `extSma50` 100%, `sma200Slope` 98,9%, MM30s 99,85% | nocturno + `daily_bars` |
| M5 | Línea A/D | **Sí, con matiz** | 3.313 símbolos con barras | `daily_bars`. Es del universo del producto, **no del NYSE** — no comparable con la serie pública |
| M6 | Nuevos máximos − nuevos mínimos | **Máximos sí, mínimos no** | máximos: `distance52w` 100%; **mínimos: `lowAdvance52w` = 0/3.313** | reconstruible desde `daily_bars` (3.265/3.313 = 98,6% tienen ≥252 barras) |
| M7 | NYSE Bullish Percent | **No** | — | necesita señales de punto y figura, que no existen. **Descartado** |
| M8 | Divergencia índice/amplitud | **Sí** | índices 4/5 + universo 99,85% | ambos lados existen |
| M9 | Volumen subidas/bajadas | **Sí** | `upDownVolRatio` **3.313 = 100%** | nocturno |
| S1 | RS del grupo en el tiempo | **Sí** | 26 semanas; cruce tema↔RS: 3.232/3.313 = **97,6%** | `rs_weekly_items` + `theme` |
| S2 | Amplitud dentro del grupo | **Sí** | `theme` 3.313 = **100%** (14 temas) | nocturno |
| S3 | Etapa del ETF sectorial | **No** | **los 11 XL\* tienen 0 barras en `daily_bars`** | requiere descargarlos, o usar el tema propio |
| S4 | Concentración del liderazgo | **Sí** | `rsGlobalPct` 100%, `theme` 100% | nocturno |
| V1 | Aplanamiento de la MM30 | **Sí** | 98,0% | `daily_bars` |
| V2 | Pérdida de MM10s/SMA50 con volumen | **Sí** | `extSma50` 100%, `relativeVolume` 100% | nocturno + `daily_bars` |
| V3 | Divergencia precio/volumen en máximos | **Sí, no calculado** | 98,6% (≥252 barras) | `daily_bars` |
| V4 | Deterioro de la Mansfield RS | **Sí, no calculado** | 99,85% | `daily_bars` (serie propia, no el percentil) |
| V5 | Volumen bajada > subida | **Sí** | `upDownVolRatio` **100%** | nocturno |
| V6 | Oscilaciones amplias | **Sí** | `range63dPct` 100%, `maxDailyRange20dPct` 100%, `volatility63d` 100% | nocturno |
| V7 | Trend Template completo | **7 de 8** | ver abajo | nocturno |

### El Trend Template, criterio por criterio [MEDIDO]

| Criterio de Minervini | Campo | Cobertura |
|---|---|---|
| 1. P > SMA50 | `price`, `sma50` | 3.313 / 3.313 |
| 2. P > SMA150 | `sma150` | 3.313 |
| 3. P > SMA200 | `sma200` | 3.297 (99,5%) |
| 4. SMA50 > SMA150 | — | 3.313 |
| 5. SMA150 > SMA200 | — | 3.297 |
| 6. SMA200 subiendo | `sma200Slope` | 3.275 (98,9%) |
| 7. P a ≤25% del máximo 52s | `distance52w` | 3.313 |
| 8. RS ≥ 70 | `rsGlobalPct`, `rsRating` | 3.313 |
| **extra**: P ≥ 30% sobre el mínimo 52s | **`lowAdvance52w` = 0** | **0 / 3.313** |

**Siete de los ocho criterios están al 98,9-100%.** El único hueco es el
mínimo de 52 semanas.

## B.9 — Lo que falta, y qué dato exacto haría falta

| Hueco | Qué falta | Coste |
|---|---|---|
| **Mínimo de 52 semanas** | `lowAdvance52w` se calcula en `researchRow.js` pero **no está en la proyección ligera** (`lib/scanLightProjection.js`) — 0 de 3.313 filas lo llevan | **Ninguno externo.** Es añadir el campo a la lista de la proyección. El dato ya se calcula |
| **Etapa de los ETF sectoriales** | Los 11 SPDR (`XLK`…`XLC`) no están en `daily_bars` | Descargarlos con el mismo cron que ya trae SPY/QQQ/IWM/ACWI. **11 símbolos** |
| **DIA** | 0 barras, pese a ser uno de los 5 índices de referencia | 1 símbolo en el mismo cron |
| **Serie del agregado diario** | No existe fila «esta noche el universo estaba así». Sin ella no hay «la amplitud cae 3 semanas seguidas» | Una fila por noche, escrita por el cron que ya corre. Ya identificado en `analisis-salud-mercado-2026-08-16.md` C.5 |
| **Pivote / nivel de ruptura de la base** | Necesario para A6 (volumen en la ruptura) | **Bloqueado por decisión de producto**: `principios-producto.md` lo aplaza hasta poder calcularlo bien |
| **Bullish Percent (M7)** | Señales de punto y figura | Descartado: nada en el sistema lo produce |
| **A/D del NYSE (M5)** | La línea A/D pública | La propia sí es calculable; la comparable con la prensa, no. **Recomiendo no usar el nombre «A/D del NYSE»** para una serie que es del universo propio |

Nada de lo que propongo en la Parte C exige un dato que no exista hoy,
salvo dos descargas triviales (los 11 sectoriales y DIA) y el campo
`lowAdvance52w`, que ya se calcula.

## B.10bis — La cobertura que descarta indicadores

El listón del encargo («un indicador sobre el 40% de la población no
sirve») sólo descarta tres cosas, y las tres por ausencia total, no por
cobertura parcial:

- `lowAdvance52w`: **0%**
- `prevAvgVolume20`: **0%**
- `avgVolume5`: **0%**

Todo lo demás que propongo está entre el **97,6% y el 100%**.

---

# PARTE C — Cómo se separan las tres piezas

## C.11 — Los nombres

| Pieza | Nombre propuesto | Qué responde | Marco temporal |
|---|---|---|---|
| 1 | **Etapa** | ¿En qué fase del ciclo está? | Semanal, MM de 30 semanas |
| 2 | **Pulso** | ¿Cómo está ahora mismo? | Diario, medias de 50/150/200 sesiones |
| 3 | **Cambios de estructura** | ¿Qué hechos han ocurrido? | Hechos fechados sobre la relación precio / MM30s / volumen |

**Por qué «Pulso».** Es corto, no sugiere ninguna acción, y sobre todo
**no es una palabra del vocabulario de etapas**, así que nadie lo
confundirá con una fase. Tiene declinación natural en las tres escalas
que pide el encargo: *Pulso del mercado*, *Pulso por tema*, *Pulso del
valor*. Alternativa si se prefiere algo menos fisiológico: **«Tono»**,
con las mismas propiedades. Lo que **no** debe llamarse: «fuerza»
(colisiona con fuerza relativa), «salud» (evaluativo y ya usado como
nombre de pantalla), «calidad» (colisiona con RS Quality), «score».

Consecuencia obligatoria: el actual **«Leadership pulse» de
`/market-health` debe desaparecer o renombrarse**. Hoy es un bloque que
lee 500 filas del `localStorage` del navegador
(`analisis-salud-mercado-2026-08-16.md` A.2.3); dejar dos «pulsos» con
poblaciones distintas repetiría exactamente el problema que este
encargo viene a resolver.

**Por qué «Cambios de estructura», y no «indicios» ni «avisos».** Un
«indicio» promete algo detrás; un «aviso» es una recomendación
disfrazada. El principio 1 obliga a describir. «Cambio de estructura» es
literalmente lo que se muestra: la relación entre el precio, su media de
30 semanas y su volumen ha cambiado, y aquí está cuándo y cuánto.

Alternativas aceptables: «Estructura» a secas, «Hechos observados».
Inaceptables: «Alertas», «Avisos», «Señales», «Riesgo», «Oportunidad».

**Frontera con «¿Qué ha cambiado?»** (`docs/diseno-que-cambio-2026-08-16.md`).
Son piezas distintas y **no deben fundirse**:

| | ¿Qué ha cambiado? | Cambios de estructura |
|---|---|---|
| Compara | dos escaneos (dos fechas) | el estado actual contra la definición de la etapa |
| Responde | «qué es nuevo desde el viernes» | «qué le pasa a este valor ahora» |
| Ámbito | agregado del universo | un valor, un tema o el mercado |
| Vive en | línea de cabecera del screener + panel | ficha, Sectores, Salud de mercado |
| Ejemplo | «233 entradas en etapa 2 desde el vie 7 ago» | «perdió su MM30s hace 3 semanas; la pendiente pasó de +6,1% a +0,4%» |

Se solapan en un punto: una entrada/salida de etapa 2 es a la vez un
delta y un cambio de estructura. Regla: **el delta agregado vive en
«¿Qué ha cambiado?»; el hecho por valor vive en «Cambios de
estructura»**. Nunca los dos en la misma pantalla con el mismo número.

## C.12 — Dónde vive cada una

### La Etapa

- **Tabla del screener**: la columna 4 de las siete, como ya está
  decidido (`principios-producto.md` §7). Una palabra + el glifo de
  confirmada/tentativa (Parte D).
- **Ficha**: el glifo grande, con las tres cifras que lo sostienen
  (distancia a la MM30s, pendiente, semanas al lado actual de la media).
  Esto **corrige de paso el hallazgo C-18 de la auditoría**: hoy el
  98,8% de las filas guardan el veredicto y tiran la prueba.
- **Salud de mercado**: la distribución del universo por etapa. Es la
  única forma con contenido de la «Curva de Etapa»
  (`analisis-salud-mercado-2026-08-16.md` D.3).
- **NO** en Sectores como número propio: ahí lo que interesa es el
  reparto, no una etiqueta única por tema.

### El Pulso

- **Mercado** → `/market-health`, **bloque principal**, sustituyendo al
  proxy de 5 índices congelado desde junio. Población: las 3.313 filas.
- **Sectores** → `/sectors`, una fila por tema con su pulso y su reparto
  de etapas. Es la pieza que hoy no existe en ninguna parte.
- **Valor** → **ficha**, junto al glifo de etapa.
- **NO en la tabla.** La tabla tiene siete columnas y añadir sin quitar
  es cómo se llega a quince. El pulso entra en la tabla sólo como
  **filtro**, no como columna.

### Los Cambios de estructura

- **Valor** → ficha, lista de hechos fechados bajo el glifo.
- **Mercado** → `/market-health`, bloque bajo el pulso: los mismos
  hechos contados sobre el universo y sobre los índices (días de
  distribución).
- **Sectores** → `/sectors`, como columna de conteo por tema.
- **NO en la tabla**, ni como columna ni como chip por fila. Sí como
  **filtro** («valores que han perdido su MM30s en las últimas 4
  semanas»).

### Resumen en una rejilla

| | Tabla | Ficha | Salud de mercado | Sectores |
|---|---|---|---|---|
| **Etapa** | columna + glifo | glifo + evidencia | distribución del universo | reparto por tema |
| **Pulso** | sólo filtro | sí | **bloque principal** | **una fila por tema** |
| **Cambios de estructura** | sólo filtro | lista de hechos | conteos + distribución | conteo por tema |

## C.13 — Qué pasa con `requireStage2`

**Se retira, y se parte en dos controles honestos.** No se renombra: un
solo control no puede seguir mezclando dos preguntas.

| Hoy | Propuesta |
|---|---|
| `requireStage2: boolean` — mezcla etapa semanal y Trend Template diario | **`etapa`**: selección múltiple de 1 / 2 / 3 / 4, con casilla «sólo confirmadas» |
| | **`pulso`**: umbral 0-8 sobre los criterios del Trend Template cumplidos |

Ventajas concretas:

1. **Cada uno hace lo que dice.** Quien pide etapa 2 recibe etapa 2.
2. **Aparece lo que hoy es imposible pedir**: «valores en etapa 1
   confirmada» — la base de Weinstein, el sitio donde la metodología
   busca antes de la ruptura. Hoy no se puede filtrar porque la etapa 1
   no existe.
3. **El filtro de deterioro se vuelve trivial**: etapa 3 + etapa 4.
4. Los presets se traducen mecánicamente:
   `leader`/`nearPivot`/`pullback` (`requireStage2: true`) pasan a
   `etapa: [2], soloConfirmadas: true, pulso ≥ 6`. El preset `early`
   pasa a `etapa: [1], soloConfirmadas: true`.

Renombrar y conservar el comportamiento actual **no es una opción**: el
comportamiento actual es el defecto.

---

# PARTE D — El criterio estricto de etapa

## D.14 — La definición

### Ingredientes

Todos sobre **cierres semanales** (semana ISO desde lunes, como hoy en
`weeklyBarsFromDaily`):

| Símbolo | Definición |
|---|---|
| `P` | cierre de la última semana |
| `MM30` | media simple de los 30 últimos cierres semanales |
| `pend` | `(MM30[0] / MM30[10] − 1) × 100` — variación de la media en 10 semanas |
| `pendPrev` | `(MM30[10] / MM30[30] − 1) × 100` — la misma medida, 20 semanas antes |
| `dist` | `(P / MM30 − 1) × 100` |
| `semLado` | semanas consecutivas que `P` lleva del lado actual de la `MM30` |

`pend` y la ventana de 10 semanas se conservan tal cual están hoy: son
correctas y ya están probadas. **Lo nuevo es `pendPrev`** — el
ingrediente sin el cual las etapas 1 y 3 no se pueden distinguir.

### El umbral de «media plana»

**`T = ±2,0%` en 10 semanas** (≈ ±0,2% por semana).

Es la única constante nueva y es una **decisión de diseño**, no un
hallazgo: la literatura de la escuela no da ningún número para «plana»
(A). La sensibilidad está medida y es suave entre 1% y 3%: [MEDIDO]

| `T` | Etapa 1 | Etapa 2 | Etapa 3 | Etapa 4 |
|---|---|---|---|---|
| ±1,0% | 573 (17,3%) | 1.648 (49,8%) | 493 (14,9%) | 594 (18,0%) |
| ±1,5% | 592 (17,9%) | 1.615 (48,8%) | 541 (16,4%) | 560 (16,9%) |
| **±2,0%** | **612 (18,5%)** | **1.572 (47,5%)** | **587 (17,7%)** | **537 (16,2%)** |
| ±3,0% | 666 (20,1%) | 1.469 (44,4%) | 692 (20,9%) | 481 (14,5%) |

Elijo 2,0% porque con 1,0% las etapas 1 y 3 **confirmadas** caen a 283
de 3.308 (8,6%) — demasiado pocas para dos fases que la metodología
considera la mitad del ciclo — y con 3,0% la etapa 2 empieza a perder
valores que cualquiera llamaría tendenciales. **El umbral debe ser
configurable y publicado en la página de metodología** (principio 5).

### Las reglas

Evaluadas en orden. `T = 2,0`.

```
si  |pend| ≤ T                       →  media plana
        pendPrev < 0   →  ETAPA 1   (base)      · confirmada
        pendPrev > 0   →  ETAPA 3   (techo)     · confirmada
        pendPrev n/d   →  etapa 1 o 3           · sin contexto

si  pend >  T  y  dist > 0            →  ETAPA 2 (avance)   · confirmada
si  pend < −T  y  dist < 0            →  ETAPA 4 (declive)  · confirmada

si  pend >  T  y  dist < 0            →  ETAPA 3            · tentativa
si  pend < −T  y  dist > 0            →  ETAPA 1            · tentativa
```

Las cuatro primeras líneas son la definición de la escuela, literal. Las
dos últimas son la aportación de este diseño y se explican en D.15.

**Histórico necesario**: 60 semanas (30 de media + 30 de contexto), frente
a las 40 de hoy. Coste medido: **3.242 de 3.308 símbolos (98,0%)** tienen
las 60. Los 66 restantes conservan etapa 1/2/4 normalmente y sólo caen en
«sin contexto» cuando además la media está plana — **16 filas de 3.308
(0,48%)**. [MEDIDO]

## D.15 — Confirmada frente a tentativa

El encargo lo plantea así: «las etapas 1 y 3 sólo se confirman cuando ya
han roto». La traducción exacta a esta definición es **quién ha cambiado
primero, el precio o la media**:

- **La media ya se aplanó** → la etapa 1 o 3 está **confirmada**. El
  hecho estructural ha ocurrido.
- **El precio ha cruzado la media pero la media sigue en la dirección
  anterior** → **tentativa**. El precio ha roto; la media todavía no lo
  ha confirmado.

Es literalmente lo que describe la fuente: la MM30 «empieza a aplanarse
tras un avance prolongado» *después* de que el precio pierda su media
corta [FUENTE:
[Deepvue](https://deepvue.com/indicators/stan-weinstein-stage-analysis-when-to-buy/)].
El precio va delante; la media confirma.

| Situación | Etapa | Estado |
|---|---|---|
| `P` sobre la MM30, media subiendo | 2 | confirmada |
| `P` bajo la MM30, media bajando | 4 | confirmada |
| Media plana tras subir | 3 | **confirmada** |
| Media plana tras caer | 1 | **confirmada** |
| `P` **bajo** la MM30, media **aún subiendo** | 3 | **tentativa** |
| `P` **sobre** la MM30, media **aún cayendo** | 1 | **tentativa** |

Reparto real del universo con `T = 2,0%`: [MEDIDO]

| Etapa | Confirmada | Tentativa | Sin contexto | Total |
|---|---|---|---|---|
| 1 · base | 230 | **366** | 16 | 612 |
| 2 · avance | 1.572 | — | — | 1.572 |
| 3 · techo | 310 | **276** | 1 | 587 |
| 4 · declive | 537 | — | — | 537 |
| **Total** | **2.649** | **642** | **17** | **3.308** |

Las etapas 2 y 4 no tienen tentativa **por construcción**: son los dos
estados en los que precio y media apuntan al mismo sitio. Si están de
acuerdo, no hay nada tentativo.

**Las 642 tentativas son exactamente la población que el producto no
puede nombrar hoy** — el 19,4% del universo, repartido hoy entre «Base»
(366) y «Mixta» (276).

### El glifo

Lo pidió el dueño explícitamente. La forma sigue el estado:

- **Confirmada**: glifo lleno, sobre la curva de etapa.
- **Tentativa**: glifo **hueco** (mismo contorno, sin relleno), con el
  contorno del color de la etapa hacia la que apunta y colocado en la
  **frontera** entre las dos zonas.
- **Sin contexto**: glifo hueco **de trazo discontinuo**, colocado en el
  centro de las dos zonas posibles, con el motivo al pasar por encima
  («faltan 60 semanas de histórico»). Sólo afecta a 16 filas.

Lleno/hueco es la codificación correcta porque no inventa una tercera
categoría: la etapa es la misma, cambia su grado de confirmación. Y no
depende del color, que ya carga la semántica de la etapa.

**Aviso de implementación** (de la auditoría, C-19): la zona del glifo
**no puede deducirse buscando dígitos dentro de un texto**. Hoy
`RegimeConstellation.jsx:22-26` hace `/3/i.test(stage)` y el literal
`"Bajo MM30s"` contiene un 3, así que un valor por debajo de su media
acaba en la zona de techo. El glifo debe recibir `{etapa: 1|2|3|4,
estado: "confirmada"|"tentativa"|"sin_contexto"}`, nunca una cadena.

## D.16 — Qué compone el Pulso, exactamente

El Pulso es el **Trend Template de Minervini** (V7), que es lo que ya
está implementado dentro de `requireStage2`, con el nombre correcto y
dos criterios que hoy no se comprueban.

| # | Criterio | Campo | ¿Hoy? |
|---|---|---|---|
| 1 | P > SMA50 | `price`, `sma50` | sí |
| 2 | P > SMA150 | `sma150` | sí |
| 3 | P > SMA200 | `sma200` | sí |
| 4 | SMA50 > SMA150 | — | sí |
| 5 | SMA150 > SMA200 | — | sí |
| 6 | SMA200 ascendente | `sma200Slope > 0` | sí |
| 7 | P a ≤25% del máximo de 52s | `distance52w ≥ −25` | **no se comprueba** |
| 8 | RS ≥ 70 | `rsGlobalPct ≥ 70` | **no se comprueba aquí** |

Se muestra como **«n de 8»**, no como un score de 0 a 100: cada criterio
es binario y verificable, y un número compuesto oculta cuál falla. Al
abrirlo, la lista con el que falla marcado.

El criterio extra de Minervini (P ≥ 30% sobre el mínimo de 52s) queda
**fuera hasta que `lowAdvance52w` entre en la proyección ligera**
(B.9). Mientras tanto, «n de 8», no «n de 9». Nada que el sistema no
pueda demostrar (principio 3).

### El Pulso del mercado y de los sectores

Los mismos ingredientes, agregados. Todo calculable hoy: [MEDIDO]

| Indicador | Valor del 2026-08-14 | Cobertura |
|---|---|---|
| Sobre su MM30s | 2.279 / 3.308 = **68,9%** | 99,85% |
| MM30s ascendente (>+2%) | 1.848 = **55,9%** | 99,85% |
| MM30s plana | 557 = **16,8%** | 99,85% |
| MM30s descendente | 903 = **27,3%** | 99,85% |
| Sobre su SMA50 | 2.220 / 3.313 = 67,0% | 100% |
| SMA200 ascendente | 2.153 = 65,0% | 98,9% |
| Volumen de subida ≥ el de bajada | 2.323 = 70,1% | 100% |
| RS ≥ 80 | 653 = 19,7% | 100% |
| A ≤1% de su máximo de 52s | 166 = 5,0% | 100% |

Y los días de distribución de los índices, con la regla de IBD (M1)
sobre las últimas 25 sesiones: [MEDIDO]

| Índice | Distribución | Acumulación | Ventana |
|---|---|---|---|
| SPY | **4** | 6 | 14 jul → 14 ago |
| QQQ | **7** | 5 | 14 jul → 14 ago |
| IWM | **6** | 3 | 13 jul → 14 ago |
| ACWI | **5** | 7 | 14 jul → 14 ago |
| DIA | — | — | sin barras |

Cómo se enuncia, sin predecir (principio 1):

> «QQQ acumula **7 días de distribución** en las últimas 25 sesiones;
> IWM, 6. El **68,9%** del universo sostiene su media de 30 semanas y el
> **47,5%** está en etapa 2. Los cuatro índices con datos están en etapa
> 2, entre un +8,1% y un +10,6% por encima de su media de 30 semanas.»

Todo son hechos con su cifra y su ventana. Ninguno dice qué va a pasar
ni qué hacer. El lector saca su conclusión — que es exactamente el
reparto de trabajo del principio 1.

### El Pulso por tema, hoy [MEDIDO]

Las 14 categorías de `theme` tienen cobertura **100%** y sólo una tiene
menos de 20 valores. Recalculado con la etapa estricta (`T = 2,0%`):

| Tema | n | E1 | E2 | E3 | E4 | sobre MM30s | vol. bajada > subida |
|---|---|---|---|---|---|---|---|
| Semis / fotónica | 117 | 7% | **67%** | 22% | 4% | 74% | **64%** |
| Finanzas | 570 | 20% | 59% | 13% | 8% | 85% | 17% |
| Consumer tech / hardware | 31 | 32% | 58% | 3% | 6% | 90% | 42% |
| Automatización | 229 | 9% | 55% | 20% | 16% | 65% | 43% |
| Autos / movilidad | 79 | 14% | 52% | 18% | 16% | 66% | 48% |
| Energía / red | 298 | 4% | 50% | **34%** | 13% | 57% | 48% |
| Inmobiliario / REIT | 348 | 17% | 49% | 17% | 17% | 68% | 32% |
| Medtech / biotech | 518 | 22% | 48% | 16% | 14% | 74% | 18% |
| Defensa / aeroespacial | 81 | 16% | 41% | 27% | 16% | 59% | 42% |
| Consumo / marca | 426 | 19% | 38% | 18% | 25% | 57% | 31% |
| Internet / plataformas | 212 | 21% | 38% | 14% | 27% | 62% | 37% |
| Software / IA | 361 | **35%** | 33% | 12% | 20% | 69% | 36% |
| Basic Materials | 37 | 0% | 22% | **46%** | 32% | 49% | 43% |

Obsérvese Semis: el tema con más etapa 2 (67%) es a la vez el que tiene
más valores con **el volumen de bajada por encima del de subida (64%)**.
Es un hecho, y es el tipo de hecho que ninguna pantalla del producto
puede enseñar hoy.

### Rotación entre temas [MEDIDO]

`rs_weekly_items` tiene **28 snapshots del motor vigente
`statsedge-us-equity-rs-v1`, que son 26 semanas distintas** (W07 a W32;
la W32 aparece tres veces, una de ellas con muestra parcial de 4.217 —
hay que deduplicar por `week_key`, como ya hace `dedupeWeeklySnapshots`
en `lib/marketBreadth.js`).

El cruce con `theme` alcanza **3.232 de 3.313 símbolos del nocturno
(97,6%)**. RS medio por tema, últimas 6 semanas:

| Tema | W27 | W28 | W29 | W30 | W31 | W32 | Δ |
|---|---|---|---|---|---|---|---|
| Semis / fotónica | 79,5 | 79,6 | 74,8 | 73,5 | 70,5 | 72,3 | **−7,2** |
| Software / IA | 46,5 | 47,4 | 49,1 | 47,1 | 51,1 | 53,1 | **+6,6** |
| Basic Materials | 53,2 | 48,4 | 42,3 | 47,7 | 47,2 | 65,8 | +12,6 |
| Finanzas | 57,7 | 58,0 | 59,7 | 60,9 | 61,8 | 59,7 | +2,0 |
| Energía / red | 52,8 | 57,1 | 61,3 | 63,7 | 60,7 | 54,5 | +1,7 |
| Medtech / biotech | 66,7 | 66,2 | 65,2 | 64,5 | 64,7 | 66,4 | −0,3 |
| Automatización | 64,6 | 63,8 | 60,9 | 62,4 | 61,4 | 63,0 | −1,5 |

Se enuncia como hecho: «Semis / fotónica ha perdido 7,2 puntos de RS
medio en seis semanas; Software / IA ha ganado 6,6». Sin adjetivos.

### Concentración del liderazgo [MEDIDO]

De los 318 valores con `rsGlobalPct ≥ 90`, **el 58% está en dos temas
(Medtech/biotech 38%, Software/IA 19%) que son el 27% del universo**.

## D.17 — Los Cambios de estructura, uno por uno

Cada uno es un hecho con su cifra y su fecha. Prevalencia medida sobre
los 3.308 símbolos con barras suficientes: [MEDIDO]

| Hecho | Enunciado en la ficha | Filas | % |
|---|---|---|---|
| Precio bajo su MM30s | «cotiza un X% por debajo de su media de 30 semanas» | 1.029 | 31,1% |
| Cruce a la baja reciente (≤4 semanas) | «perdió su media de 30 semanas hace N semanas» | 358 | 10,8% |
| Cruce al alza reciente (≤4 semanas) | «recuperó su media de 30 semanas hace N semanas» | 631 | 19,1% |
| MM30s se ha aplanado tras venir subiendo | «la pendiente pasó de +A% a +B% en 10 semanas» | 252 | 7,6% |
| MM30s se ha aplanado tras venir cayendo | ídem, a la inversa | 192 | 5,8% |
| La pendiente se ha reducido a menos de la mitad | «la media sube la mitad de rápido que hace 10 semanas» | 818 | 24,7% |
| Volumen de bajada > volumen de subida (50 sesiones) | «en 50 sesiones, el volumen de las bajadas supera al de las subidas» | 1.059 | 32,0% |
| …y además está en etapa 2 | (el caso que interesa: tendencia intacta, volumen no) | **349** | **10,6%** |
| Precio bajo la MM30s con la media aún subiendo | = etapa 3 tentativa | 276 | 8,3% |
| Precio sobre la MM30s con la media aún cayendo | = etapa 1 tentativa | 366 | 11,1% |

Reglas de redacción, que valen para las tres escalas:

1. **Cada hecho lleva su número y su ventana.** «El volumen de bajada
   supera al de subida» sin decir «en 50 sesiones» no es verificable.
2. **Ningún hecho lleva adjetivo de gravedad.** Ni «preocupante», ni
   «fuerte», ni «grave».
3. **Ningún hecho se agrega en un contador único.** «3 avisos» es
   exactamente el número agregado sin desglose que
   `diseno-que-cambio-2026-08-16.md` C.12 prohíbe.
4. **La ausencia de hechos se dice.** «Sin cambios de estructura en las
   últimas 4 semanas» es información.
5. **Nunca se ordena por número de hechos.** Ordenar por deterioro y
   destacar el primero es señalar (principio 1, último párrafo).

---

# PARTE E — El efecto

## E.16 — Cuántas filas cambian de etapa

Recálculo completo: se bajaron 400 barras diarias de cada uno de los
3.313 símbolos del nocturno desde `daily_bars`, se construyeron las
velas semanales con `weeklyBarsFromDaily` de `lib/weeklyStage.js` sin
modificar, y se aplicó el criterio de D.14 con `T = 2,0%`. **Es
medición sobre el universo entero, no muestra.** [MEDIDO]

**Distribución actual → estricta**

| Hoy | Filas | | Estricta | Filas | % |
|---|---|---|---|---|---|
| `stage2` «Etapa 2» | 1.246 | | **Etapa 1 · base** | **612** | 18,5% |
| `base` «Base» | 1.033 | | **Etapa 2 · avance** | **1.572** | 47,5% |
| `stage4` «Etapa 4» | 655 | | **Etapa 3 · techo** | **587** | 17,7% |
| `mixed` «Mixta» | 374 | | **Etapa 4 · declive** | **537** | 16,2% |
| `insufficient_history` | 5 | | sin histórico | 5 | 0,2% |

El reparto pasa de tener el **42,5% del universo en dos categorías que
no son etapas** («Base» + «Mixta») a tener el 100% clasificado en las
cuatro de la metodología.

**Matriz completa de reasignación** [MEDIDO]

| Etiqueta actual | → Etapa estricta | Filas |
|---|---|---|
| `stage2` | → **Etapa 2 confirmada** | 1.101 |
| `stage4` | → **Etapa 4 confirmada** | 537 |
| `base` | → **Etapa 2 confirmada** | **471** |
| `base` | → **Etapa 1 tentativa** | **366** |
| `mixed` | → **Etapa 3 tentativa** | **276** |
| `base` | → Etapa 1 confirmada | 111 |
| `stage4` | → **Etapa 3 confirmada** | **90** |
| `base` | → Etapa 3 confirmada | 80 |
| `mixed` | → Etapa 3 confirmada | 73 |
| `stage2` | → **Etapa 3 confirmada** | **67** |
| `stage2` | → **Etapa 1 confirmada** | **67** |
| `stage4` | → Etapa 1 confirmada | 27 |
| `mixed` | → Etapa 1 confirmada | 25 |
| `stage2` | → Etapa 1 sin contexto | 11 |
| `base` | → Etapa 1 sin contexto | 5 |
| `stage4` | → Etapa 3 sin contexto | 1 |

**Cambian de palabra 1.670 de 3.308 filas = 50,5%.**

Los movimientos que más importan:

- **471 filas que hoy dicen «Base» son etapa 2 de libro** (precio sobre
  una media de 30 semanas que sube más del 2% en diez semanas). Es el
  coste de exigir además la media de 10 semanas, que la auditoría marcó
  como divergencia deliberada (C-4).
- **366 «Base» + 276 «Mixta» = 642 filas** pasan a ser tentativas de
  etapa 1 y 3: la población que hoy el producto no puede nombrar.
- **134 filas que hoy dicen «Etapa 2» o «Etapa 4»** resultan tener la
  media plana y pasan a etapa 3 (67+90) o etapa 1 (67+27). Son los casos
  del tipo ABVX que la auditoría señaló: media al −0,06% etiquetada
  «Etapa 4».

## E.17 — Cuántas pasarían un filtro de etapa 2 honesto

[MEDIDO] Sobre los 3.308 con barras suficientes:

| Filtro | Filas | % del universo |
|---|---|---|
| **`requireStage2` actual** | **1.117** | 33,8% |
| **Etapa 2 estricta** (el filtro honesto) | **1.572** | 47,5% |
| Etapa 2 estricta **y Pulso 6/6** (los seis criterios diarios que hoy existen) | **1.047** | 31,7% |
| Etapa 2 estricta y Pulso ≥ 5/6 | 1.512 | 45,7% |
| Etapa 2 estricta y Pulso ≥ 4/6 | 1.559 | 47,1% |
| Intersección `requireStage2` actual ∩ etapa 2 estricta | 1.050 | — |
| Pasan hoy y **no** son etapa 2 estricta | **67** | 2,0% |
| Son etapa 2 estricta y el filtro actual **rechaza** | **522** | 15,8% |

Las dos cifras próximas a 1.050 miden cosas distintas y conviene no
confundirlas: **1.047** es «etapa 2 estricta con los seis criterios
diarios cumplidos»; **1.050** es la intersección con el filtro actual,
que además deja entrar por la vía diaria. Las tres filas de diferencia
son valores que hoy pasan sin ser etapa 2 semanal.

**Distribución del Pulso en el universo** (criterios 1-6, los únicos
comprobables hoy — el 7 y el 8 requieren fijar sus umbrales, y el extra
de Minervini requiere `lowAdvance52w`): [MEDIDO]

| Pulso | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| Filas | 248 | 325 | 292 | 303 | 385 | 648 | **1.107** |
| % | 7,5% | 9,8% | 8,8% | 9,2% | 11,6% | 19,6% | **33,5%** |

El reparto es utilizable como filtro: ninguna clase se lleva más de un
tercio y hay población en los siete escalones. Nótese que **1.107 filas
tienen el pulso pleno pero sólo 1.047 de ellas están en etapa 2
estricta** — 60 valores están perfectamente alineados en diario sin
estar en fase de avance semanal. Esa es la separación entre las dos
piezas, medida.

Ese 1.107 es el mismo número que aparece en la tabla del aviso previo
para `isDailyStage2`, y **no es una coincidencia ni un error de copia**:
pulso 6/6 e `isDailyStage2` son literalmente el mismo cálculo. Es la
comprobación aritmética de la tesis de A.7 — lo que hoy vive dentro de
`requireStage2` no es un criterio de etapa mal escrito, es el Pulso.

Desglose de las 67 que hoy se cuelan: 52 son **etapa 3 confirmada**
(media plana tras subir), 4 etapa 1 confirmada, 10 sin contexto, 1 etapa
3 tentativa. Desglose de las 522 que hoy quedan fuera: 420 llevan hoy la
etiqueta «Base» y 102 la etiqueta «Etapa 2».

**Lectura para el dueño**: si el filtro se parte en dos como propone
C.13, quien pida «etapa 2» pasa de recibir 1.117 filas a recibir 1.572,
y quien pida «etapa 2 **y** pulso pleno» recibe 1.047 — que es
prácticamente el conjunto que el filtro actual entrega hoy (1.117, con
1.050 en común). **El comportamiento actual no se pierde: se vuelve
pedible por su nombre.** Lo que se gana es todo lo demás: las 522 etapa
2 que hoy no son alcanzables, los siete escalones de pulso, y las cuatro
etapas como criterio.

Sobre la cifra del encargo («hoy pasan unas 3.000»): las 3.313 filas del
nocturno son lo que la tabla muestra **con el filtro desactivado**. Si
la referencia era esa, el filtro honesto no reduce de 3.000 a 1.572 —
reduce de 3.000 a 3.000, porque no hay filtro activo. La comparación
correcta es 1.117 → 1.572.

## E.18 — Orden sugerido

No es parte del encargo, pero el diseño deja un orden natural:

1. **`pendPrev` y el criterio estricto** en `lib/weeklyStage.js`. Es el
   cambio del que cuelga todo lo demás, y no toca ninguna superficie.
2. **Partir `requireStage2`** en `etapa` + `pulso` (C.13). Cierra el
   hallazgo C-15 de la auditoría.
3. **Persistir la evidencia** (`weeklySlowMa`, `weeklySlowMaSlope`,
   `weeklyDistanceSlowMa`, `lowAdvance52w`) en la proyección ligera.
   Sin esto, la ficha no puede mostrar por qué un valor está donde está.
4. **El glifo** con lleno/hueco, recibiendo un objeto y no una cadena.
5. **El Pulso del mercado y de los temas** en Salud de mercado y
   Sectores, sobre las 3.313 filas.
6. **Cambios de estructura** en la ficha.
7. Descargar los 11 ETF sectoriales y DIA (12 símbolos) si se quiere la
   etapa del sector por su ETF además de por su reparto.

---

# CONFIANZA

**Alta — medición sobre el universo entero, reproducible:**

- La distribución estricta (612 / 1.572 / 587 / 537) y la matriz de
  reasignación. Recálculo de los 3.313 símbolos desde `daily_bars` con
  `lib/weeklyStage.js` sin modificar. No es muestra.
- El reparto confirmada / tentativa (2.649 / 642 / 17).
- Las cifras del filtro: 1.117 actual, 1.572 estricto, 1.050
  intersección, 67 y 522 de discrepancia.
- La cobertura de todos los campos (tablas de B.8), con
  `Prefer: count=exact` sobre las 3.313 filas.
- Los días de distribución de SPY/QQQ/IWM/ACWI y la ausencia de DIA y de
  los 11 ETF sectoriales en `daily_bars`.
- Los 26 snapshots semanales distintos en 28 registros, y el cruce
  tema↔RS al 97,6%.
- El reparto por tema y la concentración del liderazgo.
- Que los cuatro ETF medibles están en etapa 2 bajo los dos criterios.

**Media — decisiones de diseño con base medida pero discutibles:**

- El umbral `T = ±2,0%`. La sensibilidad está medida (1% a 3%) y es
  suave, pero el número lo elijo yo: la literatura no da ninguno.
- La regla que convierte los casos cruzados en tentativas de 1 y 3. Es
  mi lectura de «se confirman cuando ya han roto» y encaja con las
  fuentes, pero no aparece literalmente en ninguna.
- Que el Pulso sea el Trend Template. La correspondencia con lo que hoy
  hay en `requireStage2` es exacta [LECTURA]; que Minervini sea la
  referencia correcta para «salud de corto plazo» es criterio mío.
- Los nombres. «Pulso» y «Cambios de estructura» los propongo; el dueño
  decide.

**Baja — declarado como tal:**

- Que 26 semanas de RS basten para juzgar rotación sectorial. Es el
  histórico que hay; no he probado si la serie es estable.
- Los enunciados de ejemplo de D.16. Son ilustraciones de redacción, no
  copia definitiva.

---

# LO QUE NO HE VERIFICADO

1. **De dónde salen las cifras 1.775, 233 y «unas 3.000»** del mensaje
   del commit `bfbcd96` y del encargo. Probé ocho lecturas del filtro y
   ninguna las produce. Puede haber una consulta que no he reconstruido,
   sobre otra población o con otra definición de etapa 2. **No he
   descartado que la equivocada sea la mía**, sólo que no la reproduzco.
2. **«Solo SPY está en etapa 2».** Mis cuatro recálculos dicen lo
   contrario con las barras del 14-ago. No he mirado el payload cacheado
   de `/api/market-health` (17-jun), que podría ser el origen.
3. **DIA.** No está en `daily_bars` y no he llamado a Yahoo. El commit
   `107da9c` afirma haberlo verificado a 536,80; lo doy por bueno sin
   comprobarlo.
4. **Ninguna superficie en ejecución.** No he abierto el screener, ni la
   ficha, ni Salud de mercado, ni Sectores. Todo lo de la Parte C sobre
   dónde vive cada pieza sale de leer el código y los análisis previos.
5. **El impacto sobre RS, compuesto y Listas.** La etapa alimenta
   `weinsteinScore`, `compositeScore` y varias listas
   (`lib/leaderboards.js` tiene su propia definición de etapa 2). No he
   medido cuánto se moverían.
6. **Otros mercados y otras noches.** Todo se mide sobre el nocturno de
   EEUU del 16-ago. Europa no tiene nocturno completo.
7. **Los tests.** No he ejecutado la suite ni he mirado si algún test
   fija el comportamiento actual del clasificador — dato necesario antes
   de tocar `lib/weeklyStage.js`.
8. **La Mansfield RS.** La propongo como calculable (A8, V4) porque los
   dos ingredientes existen, pero **no la he calculado ni una vez**. Su
   coste real y su distribución están sin medir.
9. **El follow-through day (M3).** Verificado que los datos existen; no
   lo he calculado.
10. **La estabilidad semana a semana del criterio estricto.** No sé
    cuántos valores cambiarían de etapa cada semana con `T = 2,0%`, que
    es la prueba que diría si el umbral produce parpadeo. Requiere
    recalcular varias semanas hacia atrás — factible con `daily_bars`,
    no hecho.

---

# Fuentes

- [Stan Weinstein's Stage Analysis — TrendSpider](https://trendspider.com/blog/master-market-trends-with-ai-powered-weinstein-stage-analysis/)
- [Stan Weinstein Stage Analysis — Deepvue](https://deepvue.com/indicators/stan-weinstein-stage-analysis-when-to-buy/)
- [Secrets for Profiting in Bull and Bear Markets — reseña, TraderLion](https://traderlion.com/trading-books/secrets-for-profiting-in-bull-and-bear-markets/)
- [Timing the Market — Breadth Indicators, stageanalysis.net](https://www.stageanalysis.net/blog/17614/timing-the-market-trading-using-breadth-indicators-us-stocks-weight-of-evidence)
- [Distribution Day — aiStockSelection](https://www.aistockselection.com/en/glossary/distribution-day)
- [Distribution day — Grokipedia](https://grokipedia.com/page/Distribution_day)
- [Follow-Through Day — aiStockSelection](https://www.aistockselection.com/en/glossary/follow-through-day)
- [Mansfield Relative Strength — ChartMill](https://www.chartmill.com/documentation/technical-analysis/indicators/35-Mansfield-Relative-Strength)
- [Mansfield RS — Deepvue](https://deepvue.com/knowledge-base/deepvue-custom-indicators-mansfield-rs/)
- [Minervini Trend Template — ChartMill](https://www.chartmill.com/trading-ideas/645-Mark-Minervinis-Trend-Template-TTP)
- [Minervini Trend Template — Deepvue](https://deepvue.com/screener/minervini-trend-template/)

---

# Apéndice — cómo reproducir las mediciones

Todas las consultas son GET de solo lectura contra PostgREST.

**Cobertura de un campo:**

```bash
curl -s -o /dev/null -D - -G "$SUPABASE_URL/rest/v1/scan_results" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Prefer: count=exact" -H "Range: 0-0" \
  --data-urlencode "scan_id=eq.b9ac783f-52f0-4dd9-a65e-f45e2c38f886" \
  --data-urlencode "metrics->upDownVolRatio=not.is.null" \
  --data-urlencode "select=symbol" | grep -i content-range
```

**Barras de un símbolo** (orden descendente, el contrato que usan
`researchRow.js:107` y `materializedScanner.js:411`):

```
GET /rest/v1/daily_bars?symbol=eq.SPY&owner_id=eq.personal
  &select=trade_date,high,low,close,volume&order=trade_date.desc&limit=400
```

**Snapshots de RS** (PostgREST no hace DISTINCT; keyset descendente):

```
GET /rest/v1/rs_weekly_items?owner_id=eq.personal
  &engine_version=eq.statsedge-us-equity-rs-v1
  &select=snapshot_date,week_key,sample_size
  &order=snapshot_date.desc&limit=1&snapshot_date=lt.<anterior>
```

**Etapa estricta**: importar `weeklyBarsFromDaily` de
`lib/weeklyStage.js`, construir las semanas desde las barras, y calcular
`MM30 = sma(semanas,30,0)`, `pend = (sma(...,30,0)/sma(...,30,10)−1)×100`,
`pendPrev = (sma(...,30,10)/sma(...,30,30)−1)×100`,
`dist = (semanas[0].close/MM30−1)×100`. Reglas de D.14 con `T = 2,0`.

**Días de distribución**: sobre las 25 barras diarias más recientes,
contar las sesiones con `(close/close_anterior − 1) ≤ −0,002` y
`volume > volume_anterior`.
