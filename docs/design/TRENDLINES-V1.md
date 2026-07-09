# TRENDLINES-V1 — Documento de decisión: líneas de tendencia sobre UniversalPriceChart

Estado: **decidido, pendiente de ejecución** · Fecha: 2026-07-09
Alcance: dibujar / ver / seleccionar / borrar líneas rectas libres. Sin persistencia en Supabase (fase futura). Nivel MarketSmith, no TradingView.

Contexto técnico que condiciona todo lo demás (verificado en el código actual):

- `app/UniversalPriceChart.jsx` usa **lightweight-charts v5** (`chart.addSeries(CandlestickSeries…)`, `createSeriesMarkers`). La v5 expone la API de **series primitives** (`ISeriesPrimitive`): la vía canónica para dibujo custom que se re-renderiza en sincronía con pan/zoom del canvas.
- El efecto principal **destruye y recrea el chart entero** en cada cambio de `rows/style/interval/…` (`chart?.remove()` en el cleanup). Cualquier estado de dibujo que viva "dentro" del chart muere constantemente → el estado tiene que vivir fuera y re-adjuntarse en cada creación.
- Gestos ya ocupados: **arrastre = pan** (`pressedMouseMove: true`, `horzTouchDrag: true`), **pinch = zoom**, rueda desactivada. El chart funciona en móvil (~375 px).
- El componente ya pesa 1.075 líneas y acumula navegación, colores, RS, VCP.

---

## D1 · Modelo de datos de una línea

**Decisión: dos puntos ancla en coordenadas de dominio `{ time, price }` — tiempo en segundos UTC (el mismo dominio que `row.time`) y precio absoluto. Nunca coordenadas de píxel ni índice lógico.**

- El índice lógico (posición de barra) es inestable: cambia con el rango cargado, con la agregación W/M y con la llegada de datos remotos. `{time, price}` es invariante ante todo eso.
- Es exactamente el modelo agnóstico que pide el modo replay futuro: recortar las velas a una fecha pasada no altera las anclas; la porción de línea que cae más allá del borde derecho simplemente se recorta al proyectar. Cero rediseño.
- Serializa 1:1 a una fila de Supabase futura (`symbol, t1, p1, t2, p2, …`).

**Ámbito: la línea pertenece al `symbol`, no al par símbolo+temporalidad.** Como las anclas son tiempo/precio absolutos, la reproyección a 1D/1S/1M es automática — no hay nada que "convertir" al cambiar de temporalidad; solo se vuelve a proyectar. Esto es lo que hace MarketSmith y es lo que un swing trader Weinstein espera: la directriz del semanal tiene que verse en el diario. Se guarda `createdAtInterval` como **metadato** (útil para auditoría y para un filtro futuro "solo líneas de este marco"), pero **no restringe la visibilidad en v1**.

Detalle de proyección (contrato, no implementación): `timeToCoordinate()` devuelve `null` para tiempos que no coinciden con una barra (pasa siempre al agregar a W/M). La proyección correcta es: búsqueda binaria del tiempo del ancla sobre `rowTimes` → índice lógico fraccional interpolado → `logicalToCoordinate()`. Anclas fuera del rango cargado se extrapolan linealmente en el eje lógico y el segmento se recorta al viewport.

### Esquema concreto

```js
// Una línea (estado en memoria; misma forma que la futura fila de Supabase)
{
  id: "c0a8…",                // crypto.randomUUID()
  symbol: "AAPL",
  kind: "trendline",           // enum cerrado; futuro: "hline", "ray"…
  points: [
    { time: 1736467200, price: 231.40 },   // segundos UTC, precio absoluto
    { time: 1741737600, price: 258.90 },
  ],
  createdAtInterval: "D",      // metadato informativo, no filtra
  createdAt: "2026-07-09T10:32:00Z",
  // Sin campo de estilo en v1: el estilo lo fija el sistema (D5).
  // Sin extensión de rayo en v1: la línea es un segmento puro.
}
```

```js
// Contenedor de sesión (módulo, no React state): sobrevive a la navegación
// SPA entre screener/ficha/Review, muere al recargar (intencional en v1).
// Interfaz mínima — es el único punto que se toca al añadir Supabase:
drawingsStore = {
  list(symbol) -> Drawing[],
  add(symbol, drawing), remove(symbol, id), update(symbol, drawing),
  subscribe(symbol, cb) -> unsubscribe,   // notifica a todos los charts montados del mismo símbolo
}
```

Futura tabla: `user_drawings (id uuid pk, user_id, symbol, kind, points jsonb, created_at_interval, created_at)` — el estado local ya tiene esa forma; migrar es cambiar el backend del store, no el modelo.

## D2 · Interacción de dibujo

**Decisión: clic-clic (clic fija P1, la línea previsualiza siguiendo el crosshair, segundo clic fija P2 y consolida). Nunca click-drag.**

- El arrastre **ya significa pan** en este chart, en ratón y en táctil. Click-drag para dibujar obligaría a suprimir el pan y crearía ambigüedad en móvil (drag corto = ¿pan o línea?). Clic-clic no colisiona con ningún gesto existente: en táctil es tap-tap, y **el usuario puede seguir paneando/zoomeando entre los dos clics** para colocar el segundo punto fuera de la vista inicial — algo imposible con drag.
- `Escape` (o tap en el botón de herramienta) cancela un dibujo a medias. Sin imán/snap a OHLC en v1 (nivel MarketSmith; el snap es candidato a v1.1, no cambia el modelo).

## D3 · Modo herramienta

**Decisión: toggle explícito en `universalChartNavGroup` (icono lápiz/TrendingUp junto a zoom/pan). Modo "un disparo": tras consolidar una línea, la herramienta se desactiva sola.**

- Mientras está activo: botón en estado activo según doctrina de tokens (`--active-bg` + `--active-border`, texto tinta — la interacción es tinta, nunca señal), cursor `crosshair` sobre el canvas, y el chip de modo del rail de viewport (`universalChartViewportRail`) muestra «Dibujando · clic para punto 1/2» reutilizando el patrón de chips existente.
- **El pan/zoom no se desactiva en modo dibujo** — no hace falta, porque dibujar consume clics y navegar consume arrastres. Esto elimina la clásica fricción "estoy atrapado en modo dibujo".
- Un disparo en vez de modo persistente: el caso de uso Weinstein es 1–3 líneas por gráfico, no sesiones de dibujo largas. Quien quiere otra línea vuelve a pulsar. Menos estados que recordar, imposible quedarse dibujando sin querer.

## D4 · Selección, edición y borrado

**Decisión: en modo normal (sin herramienta activa), un clic con hit-test a ≤ 6 px del segmento selecciona la línea. Clic en vacío deselecciona. Seleccionada = trazo activo + dos tiradores en los extremos. Borrar = tecla `Supr`/`Backspace` o botón «Borrar línea» que aparece en el nav group solo mientras hay selección. Editar en v1 = arrastrar tiradores de extremo; trasladar el cuerpo completo se difiere a v1.1.**

- El conflicto con el pan se resuelve por captura condicional: en `mousedown`/`touchstart`, si el hit-test da positivo sobre un tirador (o el cuerpo, solo para seleccionar), se desactiva temporalmente el scroll del chart (`chart.applyOptions({ handleScroll: { pressedMouseMove:false, horzTouchDrag:false } })`) durante ese arrastre y se restaura en `mouseup`. Fuera de un hit, el pan funciona exactamente igual que hoy — el coste de "robar" el gesto solo se paga encima de la propia línea, que es una diana pequeña y deliberada.
- Al soltar un tirador, el punto se re-lee en dominio `{time, price}` (proyección inversa) y se persiste en el store — el modelo de datos nunca ve píxeles.
- Sin menú contextual, sin doble clic, sin panel de propiedades: selección → borrar/estirar. Es el techo de complejidad de la v1.

## D5 · Estilo visual (Pizarra y Tiza)

**Decisión: nueva categoría semántica de token — la anotación del usuario. Ni `--senal` ni `--traza`.**

Razonamiento por descarte con la doctrina vigente de `tokens-v2.css`:

- `--senal` está reservada a decisión Vigilar/atención de mercado del **sistema** ("el color es convicción"; máx. un elemento señal por vista). Una línea del usuario es su propio análisis, no un veredicto del sistema — usar ámbar devaluaría la señal.
- `--traza` significa análisis, lo cual encaja semánticamente, **pero ya es la tinta de la RS Line** (trazo de 2 px sobre el mismo canvas). Dos líneas azules indistinguibles en el mismo gráfico es un fallo de legibilidad, no una economía de tokens.
- La metáfora correcta del sistema es literal: **el usuario dibuja con tiza sobre la pizarra**. La anotación es tinta de tiza, diferenciada de los datos del sistema por intensidad, igual que `--ghost` y `--curve-track` ya gradúan la tiza por significado.

Tokens nuevos (en `tokens-v2.css`, junto al bloque de calidad de dato):

```css
/* Anotación del usuario (trendlines): tiza del usuario sobre la pizarra.
   No es decisión del sistema (nunca --senal) ni dato calculado (nunca --traza). */
--anotacion        : rgba(237, 232, 218, .60);  /* reposo: entre --line3 (.45) y tiza plena */
--anotacion-activa : var(--tiza);               /* seleccionada / en dibujo: tinta plena */
--anotacion-handle : 4px;                       /* radio del tirador, = --curve-dot */
```

Aplicación: reposo = trazo 1,5 px `--anotacion`, sin sombra ni glow ("la tiza no brilla"). Seleccionada o en previsualización = trazo 2 px `--anotacion-activa` + tiradores de radio `--anotacion-handle` (relleno `--pizarra`, borde `--tiza` 2 px, coherentes con el punto de la Curva de Etapa). La selección es interacción y la interacción es tinta — consistente con `--accent`/`--active-border`. Como el canvas no entiende CSS, estos tokens entran por `resolveCssTokens()` como los demás.

## D6 · Estructura del componente

**Decisión: extraer. Nada de esta lógica entra en `UniversalPriceChart.jsx` más allá de ~15 líneas de integración.**

El archivo tiene 1.075 líneas y el efecto de render ya es el punto más frágil del componente. Además el requisito de re-adjuntar el dibujo cada vez que el chart se recrea fuerza de forma natural una frontera limpia:

| Pieza | Archivo | Responsabilidad |
|---|---|---|
| Modelo + geometría pura | `lib/chartDrawings.js` | Esquema, store de sesión por símbolo, hit-test punto-segmento, proyección time↔lógico-fraccional (binaria + interpolación), recorte al viewport. **Sin React ni DOM → testeable en vitest** (el repo ya tiene `tests/`). |
| Primitive de render | `lib/trendlinePrimitive.js` | Clase `ISeriesPrimitive` (v5) que pinta líneas + tiradores en los pane views del canvas leyendo el store. Se adjunta a `mainSeries`; lightweight-charts la repinta sola en cada pan/zoom — sin overlay DOM sincronizado a mano (el patrón del `updateRsBadge` con rAF es justo lo que queremos no repetir). |
| Hook de interacción | `app/useChartDrawings.js` | Estado React (herramienta activa, línea en curso, selección), suscripción al store, handlers de clic/drag/teclado, la danza de desactivar-restaurar `handleScroll`. Expone `{ attach(chart, series), detach, toolbarProps }`. |
| Integración | `UniversalPriceChart.jsx` | Llama al hook, ejecuta `attach()` dentro de `render()` tras crear `mainSeries`, `detach()` en el cleanup, y pinta el botón de herramienta + botón borrar en el nav group. |

Contrato clave: `attach/detach` idempotentes, porque el efecto los invocará en cada recreación del chart (cambio de rango, intervalo, estilo, resize). El estado de las líneas nunca vive en el chart: vive en el store del módulo, así que recrear el chart —o navegar del screener a la ficha del mismo ticker— repinta las mismas líneas gratis.

---

## Fuera de alcance v1 (explícito)

Persistencia Supabase (el store ya tiene la forma; se cambia el backend, no el modelo) · líneas horizontales/rayos/canales/Fibonacci · snap a OHLC · traslación del cuerpo completo · estilos por línea · alertas sobre líneas · filtro por temporalidad de creación.
