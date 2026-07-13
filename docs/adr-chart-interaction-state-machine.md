# ADR — Máquina de estados de interacción del chart (pan / drawing / editing / pinch)

- **Fecha:** 2026-07-12
- **Estado:** Propuesto (pendiente de revisión de Alejandro; ejecución → MiniMax M3)
- **Alcance:** SOLO arbitraje de la interacción existente. Sin persistencia Supabase, sin nuevas herramientas de dibujo, sin tocar `app/api/chart/route.js`, sin reactivar `mouseWheel:true`.
- **Archivos afectados (implementación futura):** `app/useChartDrawings.js`, `app/UniversalPriceChart.jsx` (mínimo), nuevos `lib/chartInteractionMachine.js` y `app/useChartInteraction.js`.

---

## 0. Hechos técnicos verificados que condicionan el diseño

Estos cuatro hechos están verificados leyendo `node_modules/lightweight-charts/dist/lightweight-charts.development.mjs` (v5) y el código propio. El diseño se cae si alguno se ignora, así que van primero:

**H1 — La librería NO usa Pointer Events.** Su `MouseEventHandler` se suscribe a `mousedown`, `mousemove`, `touchstart`, `touchmove`, `touchend` (líneas ~8310–8423 del bundle de desarrollo), sobre el **canvas superior interno** (`topCanvasBinding.canvasElement`, línea ~9565), en fase bubble.

> Consecuencia: `event.stopPropagation()` sobre `pointerdown`/`pointermove` **no bloquea absolutamente nada** de la librería. `pointerdown` y `mousedown`/`touchstart` son despachos independientes del navegador; detener la propagación de uno no afecta al otro. Cualquier diseño que "arbitre" con stopPropagation de pointer events es un placebo.

**H2 — La librería lee las opciones perezosamente, en el momento del evento.** `handleScroll.pressedMouseMove`, `horzTouchDrag`, `handleScale.pinch`, etc. se evalúan vía closures sobre `chart.options()` cuando el gesto empieza o avanza (líneas ~6473, ~9566–9567), no se cachean al crear el chart.

> Consecuencia: un `chart.applyOptions({ handleScroll: {...}, handleScale: {...} })` **síncrono** dentro de un listener de captura surte efecto antes de que la librería procese el `mousedown`/`touchstart` de ese mismo gesto. Esto ya lo demuestra `captureHandleScroll()` en `useChartDrawings.js:212` — funciona hoy. **Este es el mecanismo canónico de arbitraje**, no los stopPropagation.

**H3 — Orden de despacho garantizado.** Para un mismo contacto, el navegador dispara `pointerdown` **antes** que `mousedown`/`touchstart`. Y nuestros listeners en fase de captura sobre el contenedor se ejecutan antes que los listeners de la librería en su canvas descendiente. Por tanto: todo lo que la máquina decida y aplique síncronamente en su `pointerdown` de captura llega a tiempo.

**H4 — `preventDefault()` sobre `pointerdown` suprime los *compatibility mouse events* (mousedown/mousemove/mouseup sintéticos) solo para punteros táctiles/pen — NO suprime el `mousedown` de un ratón real.** Además, el `touchstart` de la librería está registrado `{passive:true}`, y un `touchstart` real no se suprime cancelando `pointerdown`.

> Consecuencia: `preventDefault` es útil (bloquea selección de texto, y el camino mouse-compat del táctil), pero **nunca es suficiente por sí solo**. El bloqueo fiable en todos los tipos de puntero es H2 (applyOptions).

---

## 1. Decisión en una frase

Una máquina de estados **pura y única** en `lib/chartInteractionMachine.js` (sin React, sin DOM, sin imports de lightweight-charts), consumida por un hook adaptador `app/useChartInteraction.js` que posee **el único juego de listeners pointer en fase de captura** y ejecuta los efectos; el arbitraje del comportamiento nativo se hace **exclusivamente vía `applyOptions` síncrono** al entrar/salir de cada estado, y `useChartDrawings.js` queda reducido a dominio de drawings (store, primitiva, conversión pantalla→dominio) sin listeners DOM propios.

---

## 2. Estados

Seis estados explícitos. `toolActive` e `inProgress` desaparecen como banderas independientes: pasan a ser **derivados** del estado de la máquina (`toolActive ⇔ state ∈ {armed, drawing}`, `inProgress ⇔ state === drawing`), con lo que la clase entera de bugs "banderas incoherentes" deja de poder existir.

| Estado | Significado | Dueño del gesto | Nativo (`handleScroll`/`handleScale`) |
|---|---|---|---|
| `idle` | Sin gesto. Selección de línea posible. | — | **ON** (baseline: `pressedMouseMove:true, horzTouchDrag:true, pinch:true`; wheel siempre false) |
| `armed` | Lápiz activo, p1 aún no colocado. | custom (modal) | **OFF** (todo false, pinch incluido) |
| `drawing` | p1 colocado, esperando p2 (click-click, no drag). | custom (modal) | **OFF** |
| `editing` | Arrastrando un handle de una línea existente. | custom | **OFF** |
| `panning` | La librería ejecuta su drag-to-scroll. | **nativo** | ON |
| `pinching` | La librería ejecuta su pinch táctil de 2 dedos. | **nativo** | ON |

Notas:

- `panning` se entra en el `pointerdown` aunque el usuario no llegue a mover: significa "este press pertenece al nativo", no "hubo desplazamiento". Un click sin movimiento entra y sale de `panning` sin efectos visibles — es correcto y simplifica los guards.
- `armed` y `drawing` son **modales**: mientras el lápiz está activo, el pan y el pinch nativos están deshabilitados por completo. Trade-off asumido: no se puede pan-ear a mitad de dibujo para colocar p2 fuera de pantalla. Es el patrón de TradingView y elimina de raíz la clase de ambigüedad "¿este drag es pan o es dibujo?". La alternativa (pan permitido mientras armed, dibujo solo por click) reintroduce heurísticas de umbral de movimiento que son exactamente la fragilidad que este ADR viene a matar. Si en el futuro hace falta, se añade como transición nueva, no como heurística.
- Hoy `captureHandleScroll()` deshabilita `handleScroll` pero **no** `handleScale.pinch` — durante un drag de handle un segundo dedo puede disparar un pinch nativo. La máquina cierra ese hueco: OFF significa scroll **y** scale (pinch) a false.

### Contexto de la máquina (datos que viajan con el estado)

```
{
  activePointers: Map<pointerId, {pointerType, isPrimary}>,  // bookkeeping propio
  capturedPointerId: number | null,       // solo en editing
  drag: { drawingId, handle, originalPoint } | null,  // solo en editing
  pendingP1: { time, price } | null,      // solo en drawing
  selectedId: string | null
}
```

---

## 3. Tabla de transiciones

Convenciones: `hit` es el resultado de `primitive.pickAt(x,y)` calculado por el **adaptador** (la máquina es pura y no puede hacer hit-test; recibe el evento ya clasificado: `handle | body | empty`). "Swallow" = `preventDefault()` + no procesar. Los efectos `nativeOff`/`nativeOn` son `applyOptions` **síncrono dentro del mismo handler de captura** (H2/H3).

### Desde `idle`

| Evento + guard | → Estado | Efectos |
|---|---|---|
| `ARM` (botón lápiz) | `armed` | `nativeOff`; `touchAction:'none'` en contenedor; deseleccionar; cursor crosshair |
| `pointerdown` · hit=**handle** | `editing` | **1º** `nativeOff` (síncrono, antes de que la librería vea su mousedown/touchstart); `setPointerCapture(pointerId)` sobre el contenedor; guardar `drag` con `originalPoint` (copia del punto actual); seleccionar la línea; `preventDefault` |
| `pointerdown` · hit=**body** | `panning` | Seleccionar la línea. **No** suprimir nada: el nativo puede iniciar pan desde el cuerpo de una línea (v1 no tiene "mover línea entera"; cuando exista, será una transición nueva aquí) |
| `pointerdown` · hit=**empty** | `panning` | Deseleccionar (comportamiento actual, se conserva). No suprimir nada |
| `wheel` | `idle` | Fuera de la máquina — ver §6. Único estado donde el zoom por wheel/trackpad se aplica |

### Desde `panning` (dueño: nativo — la máquina solo observa)

| Evento + guard | → Estado | Efectos |
|---|---|---|
| `pointermove` | `panning` | Ninguno. La librería gestiona el scroll |
| `pointerdown` · pointerType=touch (2º dedo) | `pinching` | **Ninguno.** No suprimir, no cancelar: la librería detecta ella misma `touches.length===2` y promueve el pan a pinch (es su comportamiento interno, línea ~8406). La máquina solo actualiza su bookkeeping para reflejarlo |
| `pointerdown` · pointerType≠touch (2º puntero no táctil, caso raro) | `panning` | Ignorar |
| `pointerup`/`pointercancel` · último puntero | `idle` | Ninguno (nativo ya estaba ON) |

**Respuesta explícita a la pregunta 3 (pan + segundo dedo):** se **promueve a pinching**, no se cancela ni se ignora — porque es lo que la librería ya hace internamente y pelearse con ella requeriría suprimir touchstart, lo que rompería su bookkeeping interno de touches. La máquina espeja, no arbitra, en territorio nativo.

### Desde `pinching` (dueño: nativo)

| Evento + guard | → Estado | Efectos |
|---|---|---|
| `pointerup`/`pointercancel` · quedan ≥1 touch | `panning` | Ninguno (la librería degrada a scroll de 1 dedo sola) |
| `pointerup`/`pointercancel` · quedan 0 | `idle` | Ninguno |
| `pointerdown` (3º dedo) | `panning` | Ninguno — la librería aborta el pinch con `touches.length !== 2`; la máquina espeja |

### Desde `armed`

| Evento + guard | → Estado | Efectos |
|---|---|---|
| `pointerdown` · `isPrimary` (cualquier hit — el lápiz es modal, ignora líneas existentes) | `drawing` | `screenToDomain` → guardar `pendingP1`; `setPendingOverlay({p1, cursor})`; `preventDefault` |
| `pointerdown` · `!isPrimary` (2º dedo) | `armed` | **Swallow.** Sin pinch en modo modal — determinista; el usuario sale con Escape o el botón si quiere hacer zoom |
| `DISARM` (botón) o `Escape` | `idle` | `nativeOn`; restaurar `touchAction`; limpiar overlay |

### Desde `drawing`

| Evento + guard | → Estado | Efectos |
|---|---|---|
| `pointermove` (hover, sin botón — es click-click) | `drawing` | Actualizar `setPendingOverlay` con cursor (lógica actual de `onPointerMove`) |
| `pointerdown` · `isPrimary` · dominio ≠ p1 | `idle` | Commit: `storeAdd(createTrendline(p1,p2))`; limpiar overlay; `nativeOn`; restaurar `touchAction` (el lápiz se apaga tras completar, comportamiento actual) |
| `pointerdown` · `isPrimary` · dominio == p1 (mismo punto exacto) | `armed` | Descartar, limpiar overlay, seguir armado (comportamiento actual de `finishDrawAt`) |
| `pointerdown` · `!isPrimary` | `drawing` | Swallow |
| `Escape` | `idle` | Cancelar: limpiar overlay + `pendingP1`; `nativeOn`; restaurar `touchAction` (= `cancelDraw` actual, que también apaga el lápiz) |
| `DETACH` (recreación del chart / cambio de símbolo) | `idle` | Cancelar dibujo en curso. Sin `applyOptions` (el chart viejo muere); el chart nuevo nace con el baseline de `idle` |

### Desde `editing`

| Evento + guard | → Estado | Efectos |
|---|---|---|
| `pointermove` · `pointerId === capturedPointerId` | `editing` | `screenToDomain` → `storeUpdate` del handle (actualización en vivo, como hoy) |
| `pointermove` · otro pointerId | `editing` | Ignorar |
| `pointerup` · `capturedPointerId` | `idle` | Commit (el store ya tiene la última posición); `releasePointerCapture`; `nativeOn`; limpiar `drag` |
| `pointercancel` / `lostpointercapture` | `idle` | **REVERT**: `storeUpdate` restaurando `drag.originalPoint`. ⚠️ Cambio respecto a hoy: `onPointerUp` actual trata cancel como commit y `originalPoint` (que ya se guarda en `dragStateRef`, línea 335) no se usa nunca. Un pointercancel (p.ej. el SO roba el gesto) debe deshacer, no confirmar a medias |
| `pointerdown` (2º puntero, cualquier tipo) | `editing` | **Swallow.** No promover a pinch a mitad de edición: abortar una acción de precisión del usuario por una señal ambigua es peor que ignorar el dedo extra. El nativo ya está OFF (pinch incluido), así que la librería tampoco lo verá |
| `Escape` | `idle` | Revert a `originalPoint` + fin (mejora recomendada, coste trivial; hoy Escape solo cancela dibujo) |

**Respuesta explícita a la pregunta 3 (editing/armed + segundo dedo):** en territorio custom el segundo puntero se **ignora y se traga** siempre. Solo en territorio nativo (`panning`) se promueve a `pinching`. La regla mnemotécnica para M3: *el nativo espeja, el custom traga*.

---

## 4. Quién bloquea qué, y con qué mecanismo (pregunta 2)

Jerarquía de mecanismos, del canónico al accesorio:

1. **`chart.applyOptions({handleScroll, handleScale})` síncrono** — el único bloqueo fiable para mouse Y touch (H2). Se aplica en las transiciones de entrada/salida de estados custom (`idle→editing`, `idle→armed`, `→idle`). El par `captureHandleScroll`/`restoreHandleScroll` actual se elimina y se reemplaza por este efecto, con dos correcciones: (a) apaga también `handleScale.pinch` y `axisDoubleClickReset`, (b) el "restore" no guarda/restaura un backup — restaura **siempre el baseline nombrado** (ver abajo), eliminando el estado `handleScrollBackupRef` y su copia divergente del baseline en `useChartDrawings.js:236-243`.
2. **`preventDefault()` sobre `pointerdown`** en estados/entradas custom — suprime selección de texto y los mouse-compat del táctil (H4). Necesario pero no suficiente; nunca es el mecanismo primario.
3. **`touch-action` inline en el contenedor** — `'none'` al entrar en `armed`/`editing`, restaurar al salir. Evita que el navegador haga scroll de página / zoom de viewport con gestos que ahora son custom. En `idle` NO se toca: con `vertTouchDrag:false`, el swipe vertical sobre el chart hace scroll de página y eso es comportamiento deseado actual.
4. **`stopPropagation` de pointer events** — solo higiene interna (evitar que otros listeners pointer propios de la app reaccionen). **Prohibido usarlo como mecanismo de arbitraje contra la librería** (H1). M3: no añadir listeners de captura sobre `mousedown`/`touchstart` para "reforzar" — un solo mecanismo (applyOptions) con un solo punto de verdad; dos mecanismos solapados es cómo se llega a los bugs de interleaving que motivan este ADR.

**Baseline nativo nombrado** — extraer a constante compartida (p.ej. en `lib/chartInteractionMachine.js`):

```js
export const NATIVE_GESTURES_ON = {
  handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  handleScale:  { axisPressedMouseMove: false, axisDoubleClickReset: true, mouseWheel: false, pinch: true },
};
export const NATIVE_GESTURES_OFF = {
  handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
  handleScale:  { axisPressedMouseMove: false, axisDoubleClickReset: false, mouseWheel: false, pinch: false },
};
```

`createChart` en `UniversalPriceChart.jsx` consume `NATIVE_GESTURES_ON` (hoy ese literal está duplicado en dos archivos con riesgo de deriva). `mouseWheel:false` queda fijado en ambos — intencional, no se toca.

---

## 5. Dónde vive el estado (pregunta 4) — y por qué

**`lib/chartInteractionMachine.js` (nuevo, ~150 líneas):** máquina pura. API:

```js
createChartInteractionMachine() → {
  getState(),                        // 'idle' | 'armed' | 'drawing' | 'editing' | 'panning' | 'pinching'
  send(event) → Effect[],            // transición síncrona; devuelve efectos a ejecutar
  subscribe(fn),                     // notificación de cambio de estado (para UI React)
}
```

Eventos de entrada (ya clasificados por el adaptador): `{type:'pointerdown', pointerId, pointerType, isPrimary, hit, domain}`, `pointermove`, `pointerup`, `pointercancel`, `ARM`, `DISARM`, `ESCAPE`, `DETACH`. Efectos de salida (uniones discriminadas): `nativeOff`, `nativeOn`, `capturePointer`, `releasePointer`, `preventDefault`, `select(id)`, `deselect`, `beginOverlay`, `updateOverlay`, `clearOverlay`, `commitDraw(p1,p2)`, `beginHandleDrag(...)`, `updateHandleDrag(domain)`, `revertHandleDrag`, `setTouchAction(v)`.

Sin React, sin DOM, sin lightweight-charts: testeable en Node con tests de tabla (secuencia de eventos → secuencia de estados+efectos). Esto es lo que hace la decisión no-desechable.

**`app/useChartInteraction.js` (nuevo, ~120 líneas):** adaptador. Posee los **únicos** listeners `pointerdown/move/up/cancel` en captura sobre el contenedor (se mudan desde `useChartDrawings.js:384-425`, que los pierde). Responsabilidades: clasificar el evento (llamar `primitive.pickAt` y `screenToDomain`, ambos inyectados), llamar `machine.send()`, y ejecutar los efectos — `applyOptions` contra el chart, `setPointerCapture` contra el contenedor, y despachar los efectos de dominio a callbacks que `useChartDrawings` registra.

**`app/useChartDrawings.js` (adelgaza):** conserva store, primitiva, `screenToDomain`, overlay, teclado y `toolbarProps`; pierde sus listeners DOM, `toolActive`/`inProgress` como estado propio (los deriva de `machine.subscribe`) y el par capture/restoreHandleScroll. El botón del lápiz pasa a emitir `ARM`/`DISARM`.

**Por qué NO dentro de `useChartDrawings`:** la máquina necesita conocer `panning`/`pinching`, que no son conceptos de drawings. Meterla ahí acopla el árbitro a uno de los arbitrados — exactamente la frontera que P1 quiere cortar. **Por qué NO en `UniversalPriceChart.jsx`:** es el monolito frágil de 1118 líneas que P1 va a desmontar; añadirle responsabilidades profundiza el problema.

**Compatibilidad con P1 (data model / viewport state / interaction mode):** la máquina pura ES la frontera "interaction mode" ya extraída. Cuando se extraiga el chart controller, el controller absorbe el cableado del adaptador (`useChartInteraction` se disuelve en él) y `lib/chartInteractionMachine.js` se mueve intacto — cero rediseño. El efecto `nativeOn/nativeOff` es además el único punto de contacto entre interaction mode y el chart, lo que deja la frontera viewport-state limpia para P1.

---

## 6. El handler de wheel/trackpad — relación con la máquina

`onWheelCaptured` (`UniversalPriceChart.jsx:805`) **no entra en la máquina** — wheel no es un gesto pointer, no tiene ciclo de vida down/move/up, y ya tiene su propio arbitraje correcto vía `stopImmediatePropagation` sobre la cadena `wheel`. Un solo cambio: consulta `machine.getState()` y **solo aplica zoom en `idle`**; en cualquier otro estado sigue tragando el evento (preventDefault + stopImmediatePropagation) pero sin zoomear. Razón: un pinch de trackpad a mitad de un `editing` re-escala las coordenadas bajo el drag y corrompe la posición del handle. En P1, este handler pertenece a la frontera viewport-state, no a interaction mode.

---

## 7. Casos borde con regla fijada (para que M3 no decida nada)

1. **`pointercancel` en `editing` → revert, no commit** (§3). `originalPoint` ya se captura hoy; solo falta usarlo.
2. **Recreación del chart a mitad de gesto** (cambio de símbolo/rango/intervalo dispara el effect destructor de `UniversalPriceChart`): el `detach` emite `DETACH` → la máquina fuerza `idle` y descarta gesto en curso. El chart nuevo nace con `NATIVE_GESTURES_ON` (baseline de `idle`).
3. **Hit-test táctil de handles:** `pickAt` usa tolerancia ~8px (`trendlinePrimitive.js:291`), insuficiente para dedo. El adaptador pasa `pointerType` y `pickAt` acepta tolerancia opcional: 8px mouse/pen, 16px touch. Cambio de 3 líneas, entra en alcance porque sin él `idle→editing` es prácticamente inalcanzable en táctil.
4. **`isPrimary` como filtro de entrada:** en estados custom solo el puntero primario genera transiciones; los no-primarios se tragan. En estados nativos no se filtra (la librería gestiona los suyos).
5. **Teclado:** el listener de `keydown` sigue en `useChartDrawings` pero traduce a eventos de máquina: `Escape` → `send({type:'ESCAPE'})`; Delete/Backspace sigue igual (borrar selección solo es legal en `idle`, guard trivial).
6. **E2E:** exponer `window.__chartInteractionState = machine` (solo dev, junto a `window.__trendlinePrimitive`) para que los scripts de `scripts/e2e/` puedan asertar estados.

## 8. Qué NO cambia

- `mouseWheel:false` en scroll y scale — intencional, fijado en ambos presets del baseline.
- La lógica de `screenToDomain`, el store de `lib/chartDrawings.js`, la primitiva de render y su `pendingOverlay`.
- El pipeline de zoom por botones / `zoomedLogicalRange` / `manualWindow` (viewport state — territorio P1).
- Comportamiento UX visible actual: click-click para dibujar, click en cuerpo selecciona, click en vacío deselecciona, el lápiz se apaga al completar una línea.

## 9. Orden de implementación sugerido para M3

1. `lib/chartInteractionMachine.js` + tests de tabla en Node (secuencias de §3, incluidos los 3 casos multi-pointer y el revert de pointercancel).
2. `app/useChartInteraction.js` (listeners + clasificación + ejecutor de efectos), con `NATIVE_GESTURES_ON/OFF` exportados desde la máquina y consumidos también por `createChart`.
3. Adelgazar `useChartDrawings.js`: quitar listeners DOM y capture/restoreHandleScroll; derivar `toolActive`/`inProgress` de la máquina; registrar callbacks de dominio.
4. Gating del wheel handler por `machine.getState() === 'idle'`.
5. Tolerancia táctil en `pickAt` + `window.__chartInteractionState`.
6. Verificación E2E: los scripts existentes de `scripts/e2e/` (trendlines + zoom/pan) deben pasar sin cambios de aserciones salvo el nuevo revert-on-cancel.
