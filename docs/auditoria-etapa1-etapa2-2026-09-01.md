# Auditoría — Etapa 1 vs Etapa 2 (semanal)

Fecha: 2026-09-01  
Rama: `codex/statsedge-ui-polish`  
Tipo: diseño y medición read-only. **No** se ha tocado `lib/weeklyStage.js`, el screener ni la UI de producto.  
Origen: MSI tanda 3 + `docs/auditoria-etapa1-etapa2-semanal-propuesta-2026-09-01.md`  
Script: `research/contracciones/arneses/etapa-codigo-vs-candidato.mjs`

Convención: **[PDF]** extraído hoy con `pdftotext` de los ficheros locales gitignored en `research/books/`. **[CÓDIGO]** leído de HEAD. **[MEDIDO]** recalculado sobre `daily_bars` (solo GET). **[LECTURA]** juicio sobre las barras, no un umbral del producto.

---

## Resumen

1. Weinstein define el **inicio** de etapa 2 como la **fuga por encima del techo de la base y de la MM30s**, con volumen, y *después* máximos y mínimos crecientes. El código actual equivale solo a «precio > MM30s y pendiente > 2%». Esa es una **condición necesaria** de etapa 2, no la fuga.
2. Minervini hereda las cuatro etapas y exige etapa 2 **antes** de buscar VCP, pero **pinpoint** de etapa 2 = Trend Template (ocho criterios de medias/RS), no la fuga horizontal. O'Neil **no usa** etapa Weinstein; usa bases, pivote y recuento de bases (1ª–4ª).
3. Ancla **MSI**: código `Etapa 2 confirmada` (MM30s +5,2%, precio +11,2% sobre ella). Ventana dueño 2025-09-11→2026-08-31: techo 493,57 el 2026-08-03, cierre 485,30 (**−1,7%, sin fuga**). Candidato operativo: **E1 potencial / `E2_ma_only`**.
4. Muestra de 18 (tanda 3 + KO, NDSN, MPC, SPY, AMD, QQQ): 17/18 son `stage2` en código. Con el candidato B (caja 26s / tendencia), **4 salen E1**, **5 E2**, **8 dudoso**. El proxy ingenuo «cierre vs máximo 52s» marca 13 E1 e incluye a SPY: **no distingue** una base E1 de una digestión alta de E2.
5. ADR: **no cambiar** `weeklyStage.js`. Añadir un **campo paralelo** (`pre_breakout` / `E2_ma_only` vs `E2_structural`) para brief y, más adelante, filtro VCP. Hasta entonces, `chart-brief.mjs` no debe decir «Etapa 2» a secas.

---

## 1. Qué hace el código hoy

[CÓDIGO] `lib/weeklyStage.js` (post-auditoría 2026-08-16):

| Estado | Regla |
|---|---|
| Etapa 2 confirmada | precio > MM30s **y** pendiente MM30s > `flatPct` (2% en 10 semanas) |
| Etapa 4 confirmada | precio < MM30s **y** pendiente < −2% |
| Etapa 1 / 3 confirmada | \|pendiente\| ≤ 2% **y** contexto previo (la media venía cayendo o subiendo) |
| Etapa 1 / 3 tentativa | el precio cruzó la media; la media aún no ha girado |

No entra: techo de la base, fuga, HH/HL, volumen de ruptura. El comentario de cabecera lo declara: la etapa se decide **solo** con precio vs MM30s y pendiente.

Eso cierra C-9/C-10 de agosto (existen las cuatro etapas). **No** responde a: *¿empezó de verdad el avance post-fuga?*

La salud de etapa (MET-5, `docs/spec-salud-etapa.md`) mide solidez **dentro** de 2 y 4 y **prohíbe** re-codificar la etapa. Cualquier arreglo de esta frontera tiene que vivir **al lado**, no dentro, del clasificador.

---

## 2. Tabla libro → criterio operativo → medible

PDFs leídos hoy (capa de texto recuperable en los tres):

| Fichero local | Libro | Páginas PDF |
|---|---|---|
| `kupdf.net_stan-weinstein-…arreglado-erwing (1).pdf` | Weinstein, *Los secretos para ganar dinero…* (trad. castellana; OCR ABBYY) | 355 |
| `mark minervini.pdf` | Minervini, *Trade Like a Stock Market Wizard* (2013) | 353 |
| `Think & trade like a champion .pdf` | Minervini, *Think and Trade Like a Champion* (2017) | 218 |
| `how-to-make-money-in-stocks-william-j-o-neil.pdf` | O'Neil, *How to Make Money in Stocks*, 4ª ed. (reflujo Calibre) | 2371 (ebook; el nº de página PDF ≠ página impresa) |

El PDF de O'Neil **sí** tiene texto esta vez (`pdftotext` → ~686 KB). Una auditoría previa (17-ago) no pudo extraerlo con otro lector; aquí las citas de O'Neil van con **capítulo + sección + página PDF de este fichero**, no con página de la edición papel.

Las frases se **parafrasean**. No se copia el libro.

### 2.1 Weinstein

| # | Criterio en el libro | Operativo | Medible en código (candidato) |
|---|---|---|---|
| W1 | Etapa 1 = área base tras meses de caída: lateral, MM30s que pierde pendiente bajista y se aplana; oscilaciones entre suelo y techo de la gama; puede durar meses o años. Cap. 2, § «Etapa 1: el área base», p. 32 [PDF 45–46] | Lateral **bajo el techo** de la gama, media aplanándose o empezando a curvar **después** de caer | Código `stage1` **o** (`stage2` **y** cierre ≤ techo de la caja). El código solo cubre el primer brazo |
| W2 | No comprar el suelo de la base: el dinero se queda atado. Mismo § [PDF 46] | Etapa 1 no es cazable | El brief no debe tratar un `stage2` ma-only como setup de avance |
| W3 | **Inicio de etapa 2** = el valor **ya salió de la base**: fuga por encima del techo de resistencia **y** de la MM30s, normalmente con volumen fuerte. Cap. 2, § «Etapa 2: etapa de avance», p. 34 [PDF 47]; glosario «Fuga», cap. 1 p. 14 [PDF 27] | Evento: cierre (o perforación del techo) **sobre** la resistencia de la gama | `close_semanal > resistencia_clave` (def. §3) |
| W4 | Tras la fuga, la MM30s **gira al alza**. Cada cresta sucesiva más alta; mínimos de corrección progresivamente más altos. Cap. 2 p. 34 [PDF 47] | HH + HL **después** de la fuga, no dentro de la caja | Pivotes semanales radio 2: últimos dos máximos y dos mínimos crecientes, **y** W3 |
| W5 | Sacudidas válidas mientras ocurran **por encima de la MM30s ascendente**. Cap. 2 p. 35 [PDF 48] | Pullback ≠ cambio de etapa | Ya está en el código como «precio vs media»; no sustituye a W3 |
| W6 | Cuestionario cap. 2: «Etapa 1 = MM plana y precio **todavía en el área base por debajo de la resistencia**»; «Etapa 2 = el valor se fugó por encima de la resistencia importante… completando la base». Respuestas p. 48 [PDF 59] | La resistencia **forma parte** de la definición de etapa 1 vs 2, no es un extra de entrada | Campo paralelo: `E2_ma_only` vs `E2_structural` |
| W7 | Compra del inversionista: (1) fuga 1→2; (2) estirón hacia el punto de fuga. Cap. 3 p. 60 [PDF 71] | La «caza» es la fuga o el retest, no «MM alza dentro de la caja» | Distancia al techo + si se ha despejado |
| W8 | Volumen de fuga: punta ≥ **2×** la media del mes anterior, **o** volumen de 3–4 semanas ≥ 2× la media previa, con al menos un aumento ligero la semana de la fuga. Cap. 4 p. 105 [PDF 115]; campeones: >2× la media de 4 semanas, cap. 5 [PDF 162] | Confirmación, no la etapa en sí | `vol_semana_fuga / mediana(4 previas)`; en esta muestra nadie rompe con 2× (sesgo de la última semana seca) |
| W9 | Resistencia = zona (no un tick) donde una recuperación se detiene; cuantas más pruebas y más tiempo, más alcista es la fuga. Glosario cap. 1 pp. 12–13 [PDF 25–26] | Techo = zona de máximos de la gama, no el máximo de 52 semanas del universo | §3.1 |
| W10 | La MM30s es «la más adecuada» para inversión; no comprar bajo una MM30s descendente. Glosario p. 13–14 [PDF 26–27] | El código cubre **esta** mitad | `weeklyStage` actual |

Weinstein **no** publica un número para «media plana». El `flatPct = 2%` sigue siendo decisión de producto (auditoría 16-ago).

### 2.2 Minervini

| # | Criterio en el libro | Operativo | Medible |
|---|---|---|---|
| M1 | Cuatro etapas (neglect / advancing / topping / declining), adoptadas de Weinstein. TLSMW cap. 5 pp. 65–66 [PDF 80–81]; T&T «Stage 2 only» [PDF 103–104] | Contexto de ciclo, no el pivot | `weeklyStage` (Weinstein) **aparte** del Trend Template (`lib/trendStructure.js`) — ya es la política D.14 |
| M2 | Etapa 1: lateral alrededor de la media de 200d/40s, meses o años, a menudo tras etapa 4. **No comprar etapa 1.** TLSMW p. 66–67 [PDF 81–82] | Alineado con el dueño en MSI | Código `stage1` cubre media plana; **no** cubre «caja bajo techo con MM ya alza» |
| M3 | Transición 1→2: precio > 150d y 200d; 150d > 200d; 200d girada al alza; **serie de HH y HL**; volumen en subidas vs secado en pullbacks; avance previo **≥ 25–30%** desde el mínimo de 52s antes de concluir que etapa 2 está en marcha. TLSMW pp. 68–70 [PDF 83–85] | HH/HL + avance mínimo; **no** exige la fuga horizontal de Weinstein | HH/HL semanal (§3.3) + `lowAdvance52w` (hoy no está en la fila ligera) |
| M4 | Trend Template: **ocho** criterios, todos, para «confirmed stage 2 uptrend». TLSMW p. 79 [PDF 94]; T&T [PDF 105–106] (el 5º umbral de T&T es 25% sobre el mínimo 52s, no 30%) | Salud de tendencia, no techo de base | Ya en producto con otro nombre. **No** resolver MSI: un valor puede cumplir MM y seguir dentro de la caja |
| M5 | VCP **después** de etapa 2 confirmada (los ocho). T&T [PDF 109]: «Once I determine a stock is in a confirmed Stage 2 uptrend—it meets all eight… I look at the current chart pattern». TLSMW cap. 10 pp. 196–198 [PDF 211–213] | Filtro de contexto del detector ≠ definición de etapa Weinstein | Hoy el prototipo v4 usa pendiente MM30s > 0. Falta la puerta **fuga o subestado** si se quiere el criterio del dueño |
| M6 | Bases **dentro** de etapa 2 (el «monte»): pausas de 5–26 semanas, bases 1–2 las mejores, 4–5 tardías. TLSMW pp. 80–81 [PDF 95–96] | Una caja en E2 **no** es etapa 1. SPY/QQQ caen aquí | `rng26` bajo + MM alza + **ya** hubo fuga previa (histórico de techos) — el candidato B **no** lo resuelve del todo |
| M7 | Pivot = máximo de la última contracción; comprar lo más cerca posible, sin perseguir más de unos puntos. TLSMW cap. 10 [PDF 239]; T&T p. 130 citado en `docs/diseno-contracciones-v2-2026-08-18.md` | Evento de entrada, no de etapa | Detector de contracciones (otro ticket) |

Tensión real, no un empate de redacción: **Weinstein** pone la frontera 1→2 en la **fuga del techo**. **Minervini** la pone en **medias alineadas + HH/HL + 25–30% off lows**, y luego busca bases *en* esa etapa 2. El dueño, en MSI, se alinea con Weinstein (caja sin fuga = E1 potencial, no E2 cazable). El código se alinea con la **mitad Weinstein** (MM alza) y con **cero** de la fuga.

### 2.3 O'Neil

| # | Criterio en el libro | Operativo | Medible |
|---|---|---|---|
| O1 | **No hay** «Stage 2» Weinstein. Búsqueda de `stage 2` / `stage analysis` en el PDF = 0 hits | No usar a O'Neil para etiquetar E1/E2 del clasificador | — |
| O2 | Pivote / «line of least resistance» (Livermore): el punto de compra al salir de una base correcta (taza con asa, etc.). Cap. 2, «Find Pivot Points…» [PDF 194–198] | Ruptura del pivote de **esa** base, no de la MM30s | Techo del asa / última contracción (detector VCP) |
| O3 | Volumen el día de la fuga ≥ **40–50%** sobre lo normal; en rupturas mayores, múltiplos enormes. Mismo cap. [PDF 195–196] | Confirmación de la fuga de patrón | `relativeVolume` / `volumeSurgePct` (ya al 100% en nocturno) |
| O4 | Comprar **en** el pivote, no antes (prematuro; muchas bases nunca rompen) ni >5–10% después (extendido). [PDF 198–200] | Distingue E1-en-caja de E2-cazable igual que el dueño | Distancia al techo; MSI está **antes** |
| O5 | «Third- or fourth-stage bases»: recuento de **bases del avance**, no etapas Weinstein. Cap. 2, asas [PDF 190] | Una base tardía puede ser E2 maduro | Recuento de bases (Minervini M6); no está en producto |
| O6 | El pivote **no** es típicamente el máximo histórico viejo. [PDF 200] | Resistencia clave ≠ máximo de 52 semanas por defecto | §3.1, fallo del candidato A |

---

## 3. Definiciones candidatas medibles

Umbrales **declarados** (no están en los libros como número único). El script los usa; son hipótesis para el ADR, no producto.

### 3.1 Resistencia clave

**Candidato A — techo 52s-4.** Máximo de los máximos semanales de 52 semanas **excluyendo las 4 más recientes**. Ruptura = cierre semanal > ese techo.

- Pros: barato, reproducible, acierta MSI (−1,7% vs 493,57 el 2026-08-03).
- Contras: un pullback bajo un ATH reciente (SPY −1,4%, DELL −6%) sale «sin fuga» aunque el ciclo sea un avance. O'Neil O6: el pivote no es el máximo viejo. **No usar A solo.**

**Candidato B — caja vs tendencia (el de la muestra).**

| Pieza | Regla |
|---|---|
| Caja 26s | `(máx−mín)/mín` de 26 semanas ≤ **32%** y cierre ≤ techo A → **E1** (potencial / `E2_ma_only`) |
| Fuga estructural | cierre > techo A **y** HH+HL → **E2** |
| Tendencia ancha | rango 26s ≥ **50%**, pullback ≥ −8% del techo A, HH+HL, código `stage2` → **E2** (no es base E1) |
| Resto | **dudoso** |

Hueco conocido: un índice o blue chip en **digestión alta de E2** (SPY, rango 26s = 24%) cae en «caja» igual que MSI. Distinguir «primera base post-caída» de «base 3 del monte» exige **histórico de fugas** o recuento de bases (M6/O5), que este ticket no implementa.

**Candidato C — zona Weinstein (aún no en el script).** Agrupar máximos semanales que tocan una banda (±2% o 0,5×ATR semanal) ≥ 3 veces en ≥ 8 semanas. Más fiel a W9; más parámetros. Siguiente iteración si se acepta B.

Base **ascendente** (MPC en corpus): el techo no es horizontal. B marca MPC **E2** porque el cierre está +14,5% sobre el techo 52s-4 (ya salió). Una base ascendente **sin** haber despejado el último hombro seguiría en dudoso/E1 — correcto para el dueño.

### 3.2 Ruptura

Cierre semanal por encima del **techo de la zona** (A o C), no un mecha intradía. Weinstein glosario: la fuga se produce cuando «el techo de la zona de resistencia está despejado» (12 1/8 si la zona acaba en 12) [PDF 27].

Volumen: reportar `vol_semana / mediana(4 previas)`; **no** exigir 2× para el veredicto de etapa (W8 es confirmación de la *compra*, y la última semana de esta muestra está seca en todos).

### 3.3 HH/HL en formación

Pivotes semanales con radio **2** (un máximo que supera las 2 semanas a cada lado). HH = los dos últimos máximos pivote crecientes; HL = los dos últimos mínimos pivote crecientes.

- Weinstein W4: aplican **tras** la fuga. Dentro de la caja, MSI tiene HH=sí y HL=sí: son oscilaciones de gama (W1), no el avance. Por eso B exige fuga **o** tendencia ancha, no HH/HL sueltos.
- ¿Cuántos pares? El libro dice «cada cresta sucesiva» / «serie». El candidato usa **un** par (2 y 2). Un segundo par sería más estricto y dejaría más dudosos; no lo he medido en universo.
- Reconfiguración (NDSN en la propuesta): un HL que perfora y recupera sigue siendo HL si el último pivote es más alto. NDSN sale **E2** (fuga +1,9% y HH/HL). No he etiquetado a mano el gráfico; es el veredicto mecánico.

---

## 4. Muestra (18 símbolos)

Barras: `daily_bars` del owner `personal`, filtro de barras mensuales (día 1 y volumen >4× mediana de 20). `weeklyStageForBars` **importado sin modificar**. Fecha de barras: última semana del 2026-08-31 en MSI.

Tanda 3: APH DELL F GE HPE MDLZ MMM MSI NVDA SCHW STX VLO.  
Nocturno / contexto: KO, NDSN, MPC, SPY, AMD, QQQ.  
Excluidos a propósito: AAPL/JPM/MSFT/TXN/WELL (barras residuales).

**Veredicto candidato = B.** A se enseña para ver el sesgo del techo 52s.

| símbolo | etapa código | A | B (candidato) | ruptura | HH | HL | vs techo | rng26 | una línea |
|---|---|---|---|---|---|---|---|---|---|
| **MSI** | Etapa 2 confirmada | E1 | **E1** | no | sí | sí | −1,7% | 30% | Ancla: caja bajo 493,57 (8-ago); MM +5,2% = `E2_ma_only`, no fuga |
| APH | Etapa 2 confirmada | E1 | **dudoso** | no | no | sí | −11,2% | 52% | 11% bajo el techo de jun; ni caja estrecha ni fuga |
| DELL | Etapa 2 confirmada | E1 | **E2** | no | sí | sí | −6,1% | 276% | Avance violento, no base E1; rng26 extremo (split/dato: ojo) |
| F | Etapa 2 confirmada | E1 | **dudoso** | no | no | sí | −20,7% | 62% | 14+ sem bajo el techo de mayo |
| GE | Etapa 2 confirmada | E1 | **dudoso** | no | sí | sí | −13,7% | 45% | Entre caja y tendencia; sin fuga |
| HPE | Etapa 2 confirmada | E1 | **dudoso** | no | sí | sí | −18,5% | 214% | Avance, lejos del techo de junio |
| MDLZ | Etapa 2 confirmada | E1 | **E1** | no | sí | sí | −6,9% | 25% | Caja tipo MSI |
| MMM | Etapa 1 confirmada | E1 | **E1** | no | sí | sí | −6,7% | 33% | El único donde **código y dueño coinciden** |
| NVDA | Etapa 2 confirmada | E1 | **E2** | no | sí | sí | −3,3% | 63% | Serie desde 2021 (167 sem vs 84 del resto); techo A en 2024. Dato mixto |
| SCHW | Etapa 2 confirmada | dudoso | **dudoso** | sí | no | no | +1,0% | 37% | Mecha/cierre sobre el techo 4s, sin HH/HL |
| STX | Etapa 2 confirmada | E1 | **dudoso** | no | no | no | −27,6% | 235% | Avance, recorte profundo |
| VLO | Etapa 2 confirmada | E2 | **E2** | sí | sí | sí | +12,5% | 71% | Fuga + estructura |
| KO | Etapa 2 confirmada | E1 | **E1** | no | sí | sí | −2,5% | 26% | Caja; en corpus KO ya fue base etiquetada |
| NDSN | Etapa 2 confirmada | E2 | **E2** | sí | sí | sí | +1,9% | 34% | Fuga corta + HH/HL (reconfiguración: no auditada a mano) |
| MPC | Etapa 2 confirmada | E2 | **E2** | sí | sí | sí | +14,5% | 80% | Base ascendente del corpus, ya despejada |
| SPY | Etapa 2 confirmada | E1 | **E1\*** | no | sí | sí | −1,4% | 24% | \*Mecánico: caja 26s. Lectura: digestión de E2 de índice, no E1 post-caída |
| AMD | Etapa 2 confirmada | E1 | **dudoso** | no | sí | no | −19,5% | 209% | Avance, lejos del techo |
| QQQ | Etapa 2 confirmada | E1 | **dudoso** | no | no | no | −4,2% | 35% | 13 sem bajo el techo de junio; borde de caja |

Conteos **sobre los 17 `stage2` del código** (MMM es `stage1`):

| Regla | E2 | E1 | dudoso |
|---|---|---|---|
| Código | 17 | 0 | — |
| A (techo 52s-4) | 3 | 13 | 1 |
| **B (caja / tendencia)** | **5** | **4** | **8** |

B: 4/17 (24%) de los «Etapa 2 confirmada» serían E1 potencial en esta muestra (MSI, MDLZ, KO, y SPY mecánico). **No extrapolar al universo** (n=18, sesgo tanda 3 = «avance o primera base»).

### 4.1 Ancla MSI (dueño)

```
MSI · POTENCIAL · PERIODO: 2025-09-11→2026-08-31 · base larga sin ruptura ·
semanal = E1 potencial, no E2 cazable · jun-ago = tendencia diaria, no el VCP
```

[MEDIDO]

| | |
|---|---|
| Código | Etapa 2 confirmada · pend MM30s **+5,2%** · dist MM30s **+11,2%** |
| Ventana dueño | 51 semanas 2025-09-15→2026-08-31 |
| Techo | **493,57** el 2026-08-03 |
| Cierre | **485,30** (−1,7%); no cleared |
| B | **E1** · caja 26s 30% |

El desacuerdo no es un bug de ejecución: el clasificador hace lo que dice. El dueño pide la **otra** pregunta (fuga de la caja).

Jun–ago diario: el brief automático de `chart-brief.mjs` midió un avance ~6 meses y lo narró como consolidación/VCP. Escala incorrecta; el VCP que el dueño etiqueta es **semanal** en esa base larga.

---

## 5. Nota para `chart-brief.mjs` (no implementar hasta ADR)

Hoy el brief abre con `stage.label` («Etapa 2 confirmada») y, si el avance 130 sesiones es pequeño, sugiere «primera base de etapa 2». En MSI eso es falso: el código es `E2_ma_only` y el patrón es E1 potencial.

Hasta que exista subestado:

1. No escribir «Etapa 2» (ni «confirmada») **sin** calificar: `código: Etapa 2 (MM30s alza)` vs `operativo: sin fuga de techo / E1 potencial`.
2. No inferir «primera base de etapa 2» solo por `advancePct < 35`.
3. Si `weeklyStage.state === "stage2"` y el cierre semanal sigue bajo el máximo de las últimas 26–40 semanas en una caja ≤32%, la frase es **base / pre-fuga**, no avance cazable.
4. No mezclar un tramo diario (jun–ago) con el periodo de la base semanal que el dueño va a etiquetar. El periodo del brief debe ser el de la **ventana del gráfico** (290 sesiones) o el que ponga el etiquetador, no un lookback interno distinto.

Implementación: ticket **después** del ADR. Este ticket no edita `chart-brief.mjs`.

---

## 6. ADR corto — qué hacer con el clasificador

**Decisión propuesta: campo paralelo. No cambiar `weeklyStage.js`.**

| Opción | Qué | Veredicto |
|---|---|---|
| A. Cambiar el clasificador (E2 = MM + fuga + HH/HL) | Rompe MET-5 («`weeklyStage` no se modifica»), C-4 documentado (etapa = precio/media), y el índice de salud 2/4. Re-mezcla ciclo con setup | **Rechazada** |
| B. Campo paralelo | Conservar `weeklyStageState`. Añadir p.ej. `weeklyStageStructure`: `pre_breakout` \| `E2_ma_only` \| `E2_structural` \| `n/a`. El brief y, luego, el detector VCP leen el paralelo | **Propuesta** |
| C. Solo UI / brief | Textos honestos sin persistir el subestado. Barato; el nocturno y el filtro «Etapa 2» siguen mintiendo en la mesa | Parche temporal, no cierra VCP-1 |

Nombres tentativos (producto, no jerga de escuela):

| Valor | Significa |
|---|---|
| `E2_ma_only` | Código etapa 2; cierre aún bajo el techo de la caja 26s (MSI, MDLZ, KO) |
| `pre_breakout` | Igual, pero junto al techo (p.ej. dist > −3%) — opcional, puede fusionarse con el anterior en v1 |
| `E2_structural` | Fuga del techo **y** HH/HL (VLO, NDSN, MPC en la muestra) |
| `n/a` | Etapas 1/3/4 o histórico corto |

El filtro `requireStage2` **no** debe leer el paralelo en v1 (lección C-15: no volver a tener dos «Etapa 2»). Si más adelante se filtra «cazable», que sea un **filtro nuevo** con otro nombre.

VCP: el filtro de contexto v4 (pendiente MM30s > 0) **no basta** para el criterio del dueño. La puerta extra es el paralelo, no un segundo `weeklyStage`.

---

## Confianza

| Afirmación | Base |
|---|---|
| Citas Weinstein / Minervini / O'Neil con cap. y pág. PDF | Extracción `pdftotext` 2026-09-01; OCR Weinstein ruidoso, sentido comprobado en glosario + cap. 2–4 |
| Código `weeklyStage` = MM30s + pendiente | Lectura del módulo en HEAD |
| MSI techo 493,57 / cierre 485,30 | Recálculo `daily_bars` + `weeklyBarsFromDaily` |
| Tabla de 18 | Mismo script, una corrida |
| Umbral caja 26s = 32% | **Declarado.** 32% deja a MSI/MDLZ/KO/SPY dentro y a GE (45%) fuera; no está en ningún libro |
| SPY como E1 mecánico | Limitación de B, declarada |
| DELL rng26 = 276% | Sospechoso (split o barra); no he inspeccionado velas |

## Lo que no verifiqué

- Gráficos a mano de los 18 (salvo la narrativa MSI del dueño). NDSN/MPC «E2» es mecánico.
- Universo del nocturno (~3,3k). 24% no es una tasa de producto.
- Volumen 2× en la **semana de la fuga histórica** (solo se midió la última semana).
- Trend Template de los 18 (otro módulo).
- Candidato C (zona de máximos tocada 3 veces).
- `chart-brief.mjs` en HTML de tanda 3 (no se regeneró).
- Página impresa de O'Neil (el PDF es reflujo Calibre).
- Nada en navegador ni commit.

Sin commit ni push. `lib/weeklyStage.js` no se ha modificado.

---

## Cómo reproducir

```bash
node --env-file=.env.local --loader ./scripts/loader.mjs \
  research/contracciones/arneses/etapa-codigo-vs-candidato.mjs
```

Solo lectura. No escribe en Supabase ni en disco (salvo stdout).
