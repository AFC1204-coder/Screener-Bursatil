// lib/chartInteractionMachine.js — Máquina de estados pura para arbitrar la
// interacción del chart (pan / drawing / editing / pinch).
//
// Esta máquina es la frontera "interaction mode" del chart. Es PURO: no
// importa React, ni DOM, ni lightweight-charts. Las dependencias que tiene son
// sólo de tipos, no en runtime. Esto permite testearla en Node con tests de
// tabla (secuencias de eventos → secuencias de estados+efectos) sin montar
// ningún DOM ni un chart real.
//
// Decisiones y contrato (ver docs/adr-chart-interaction-state-machine.md):
// - 6 estados: idle | armed | drawing | editing | panning | pinching.
// - toolActive ⇔ state ∈ {armed, drawing}; inProgress ⇔ state === drawing.
//   Se derivan, no son estado propio de la máquina.
// - El arbitraje contra la librería se hace exclusivamente vía
//   applyOptions({handleScroll, handleScale}) síncrono, ejecutado por el
//   adaptador. La máquina NO sabe nada del chart: emite efectos
//   `nativeOff`/`nativeOn` que el adaptador traduce a applyOptions.
// - `pointercancel` en editing REVIERTE al `originalPoint` (no commitea).
//   Esto es un cambio respecto al comportamiento previo, deliberado (ver
//   §7.1 del ADR).
//
// API pública:
//   const machine = createChartInteractionMachine();
//   machine.getState()                   // 'idle' | 'armed' | ...
//   machine.send(event) -> Effect[]      // transición síncrona; devuelve efectos
//   machine.subscribe(fn) -> unsubscribe // notificación de cambios de estado
//
// NATIVE_GESTURES_ON / NATIVE_GESTURES_OFF son el "baseline nombrado" (ADR §4)
// consumido tanto por la máquina (vía `nativeOn`/`nativeOff`) como por
// `createChart` en UniversalPriceChart. Un solo literal para evitar deriva.

"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Baseline nativo nombrado (ADR §4).
// mouseWheel:false queda fijado en ambos presets — intencional, no se toca.
// ─────────────────────────────────────────────────────────────────────────────

export const NATIVE_GESTURES_ON = {
  handleScroll: {
    mouseWheel: false,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: false,
  },
  handleScale: {
    axisPressedMouseMove: false,
    axisDoubleClickReset: true,
    mouseWheel: false,
    pinch: true,
  },
};

export const NATIVE_GESTURES_OFF = {
  handleScroll: {
    mouseWheel: false,
    pressedMouseMove: false,
    horzTouchDrag: false,
    vertTouchDrag: false,
  },
  handleScale: {
    axisPressedMouseMove: false,
    axisDoubleClickReset: false,
    mouseWheel: false,
    pinch: false,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del documento (en JSDoc para hints en IDE; sin TS por consistencia).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'idle'|'armed'|'drawing'|'editing'|'panning'|'pinching'} State
 *
 * @typedef {'handle'|'body'|'empty'} Hit
 *
 * @typedef PointerEvent
 * @property {'pointerdown'|'pointermove'|'pointerup'|'pointercancel'} type
 * @property {number} pointerId
 * @property {'mouse'|'pen'|'touch'} pointerType
 * @property {boolean} isPrimary
 * @property {Hit} [hit]
 * @property {{time:number,price:number}} [domain]
 *
 * @typedef ArmEvent
 * @property {'ARM'} type
 *
 * @typedef DisarmEvent
 * @property {'DISARM'} type
 *
 * @typedef EscapeEvent
 * @property {'ESCAPE'} type
 *
 * @typedef DetachEvent
 * @property {'DETACH'} type
 *
 * @typedef Effect
 * @property {'nativeOff'|'nativeOn'|'capturePointer'|'releasePointer'|'preventDefault'
 *   |'select'|'deselect'|'beginOverlay'|'updateOverlay'|'clearOverlay'
 *   |'commitDraw'|'beginHandleDrag'|'updateHandleDrag'|'revertHandleDrag'
 *   |'setTouchAction'} type
 * @property {*} [payload]
 */

// ─────────────────────────────────────────────────────────────────────────────
// Estado inicial.
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_STATE = "idle";

function initialContext() {
  return {
    activePointers: new Map(),
    capturedPointerId: null,
    drag: null,
    pendingP1: null,
    selectedId: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de "tipos de puntero activos".
//
// `pointerType=touch` se considera "táctil" en el sentido del ADR §3 — los
// pinch son exclusivos del táctil. Otros tipos (mouse, pen) sólo cuentan como
// "extra pointer" para efectos de bookkeeping pero no promueven a pinching.
// ─────────────────────────────────────────────────────────────────────────────

function activeTouchCount(ctx) {
  let n = 0;
  for (const meta of ctx.activePointers.values()) {
    if (meta.pointerType === "touch") n += 1;
  }
  return n;
}

function totalActiveCount(ctx) {
  return ctx.activePointers.size;
}

function lastPointerIsTheOnlyOne(ctx, pointerId) {
  return totalActiveCount(ctx) === 1 && ctx.activePointers.has(pointerId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementación de la máquina.
//
// Tabla de transiciones: ver ADR §3. Mantener sincronizada con ese documento.
// Esta función es la única fuente de verdad sobre qué evento en qué estado
// produce qué efecto y a qué estado transita.
// ─────────────────────────────────────────────────────────────────────────────

function transition(state, context, event) {
  // El evento DETACH tiene prioridad absoluta: cualquier estado a idle.
  if (event && event.type === "DETACH") {
    const next = { ...context };
    next.activePointers = new Map();
    next.capturedPointerId = null;
    next.drag = null;
    next.pendingP1 = null;
    return { state: "idle", context: next, effects: [] };
  }

  switch (state) {
    case "idle": {
      if (event.type === "ARM") {
        return {
          state: "armed",
          context: { ...context, selectedId: null },
          effects: [
            { type: "nativeOff" },
            { type: "setTouchAction", payload: "none" },
            { type: "deselect" },
          ],
        };
      }
      if (event.type === "pointerdown") {
        const hit = event.hit || "empty";
        if (hit === "handle") {
          // Capturamos el handle. El adaptador debe aportar drag.originalPoint
          // mediante un `beginHandleDrag` con el punto actual — la máquina
          // asume que `event.originalPoint` viene ya resuelto por el adaptador
          // (que es el único con acceso al store). Si no viene, fallback a
          // null y revert se convierte en no-op (defensivo, no debería
          // ocurrir porque hit=handle requiere que el adaptador lo haya
          // resuelto para clasificar).
          const originalPoint = event.originalPoint || null;
          const drawingId = event.drawingId;
          const handle = event.handle; // 'p1' | 'p2'
          return {
            state: "editing",
            context: {
              ...context,
              capturedPointerId: event.pointerId,
              drag: originalPoint
                ? { drawingId, handle, originalPoint: { ...originalPoint } }
                : null,
              selectedId: drawingId || context.selectedId,
              activePointers: registerPointer(
                context.activePointers,
                event,
              ),
            },
            effects: [
              { type: "nativeOff" },
              { type: "capturePointer", payload: { pointerId: event.pointerId } },
              { type: "select", payload: { id: drawingId } },
              { type: "preventDefault" },
            ].concat(
              originalPoint
                ? [{ type: "beginHandleDrag", payload: { drawingId, handle, originalPoint } }]
                : [],
            ),
          };
        }
        if (hit === "body") {
          // Panning nativo; la librería gestiona el scroll.
          return {
            state: "panning",
            context: {
              ...context,
              selectedId: event.drawingId || context.selectedId,
              activePointers: registerPointer(context.activePointers, event),
            },
            effects: event.drawingId
              ? [{ type: "select", payload: { id: event.drawingId } }]
              : [],
          };
        }
        // hit === 'empty'
        return {
          state: "panning",
          context: {
            ...context,
            selectedId: null,
            activePointers: registerPointer(context.activePointers, event),
          },
          effects: [{ type: "deselect" }],
        };
      }
      // wheel no entra en la máquina (ADR §6). Cualquier otro evento se ignora.
      return noChange(state, context);
    }

    case "panning": {
      if (event.type === "pointermove") {
        // La librería gestiona el scroll; la máquina sólo actualiza bookkeeping.
        return {
          state: "panning",
          context: {
            ...context,
            activePointers: registerPointer(context.activePointers, event),
          },
          effects: [],
        };
      }
      if (event.type === "pointerdown") {
        // Segundo puntero: si es touch, promover a pinch. La librería detecta
        // ella misma touches.length===2 y promueve pan→pinch; la máquina
        // espeja (ADR §3, "panning 2º touch → pinching").
        const nextActive = registerPointer(context.activePointers, event);
        if (event.pointerType === "touch" && activeTouchCount({ ...context, activePointers: nextActive }) >= 2) {
          return { state: "pinching", context: { ...context, activePointers: nextActive }, effects: [] };
        }
        // 2º puntero no táctil: ignorar (quedarse en panning).
        return { state: "panning", context: { ...context, activePointers: nextActive }, effects: [] };
      }
      if (event.type === "pointerup" || event.type === "pointercancel") {
        const nextActive = deregisterPointer(context.activePointers, event.pointerId);
        if (totalActiveCount({ ...context, activePointers: nextActive }) === 0) {
          return { state: "idle", context: { ...context, activePointers: nextActive }, effects: [] };
        }
        return { state: "panning", context: { ...context, activePointers: nextActive }, effects: [] };
      }
      return noChange(state, context);
    }

    case "pinching": {
      if (event.type === "pointerup" || event.type === "pointercancel") {
        const nextActive = deregisterPointer(context.activePointers, event.pointerId);
        if (activeTouchCount({ ...context, activePointers: nextActive }) >= 1) {
          // Queda ≥1 touch → degradar a pan de 1 dedo (la librería lo hace sola).
          return { state: "panning", context: { ...context, activePointers: nextActive }, effects: [] };
        }
        return { state: "idle", context: { ...context, activePointers: nextActive }, effects: [] };
      }
      if (event.type === "pointerdown") {
        // 3º dedo (o más): la librería aborta el pinch con touches.length !== 2;
        // la máquina espeja y cae a panning.
        const nextActive = registerPointer(context.activePointers, event);
        return { state: "panning", context: { ...context, activePointers: nextActive }, effects: [] };
      }
      // pointermove u otros: bookkeeping.
      if (event.type === "pointermove") {
        return {
          state: "pinching",
          context: { ...context, activePointers: registerPointer(context.activePointers, event) },
          effects: [],
        };
      }
      return noChange(state, context);
    }

    case "armed": {
      if (event.type === "DISARM" || event.type === "ESCAPE") {
        return {
          state: "idle",
          context: { ...context, pendingP1: null },
          effects: [
            { type: "nativeOn" },
            { type: "setTouchAction", payload: "" },
            { type: "clearOverlay" },
          ],
        };
      }
      if (event.type === "pointerdown") {
        if (!event.isPrimary) {
          // 2º dedo en modo modal: swallow. No pinch, determinista.
          // No emitimos preventDefault para no romper el touchstart interno
          // de la librería; el efecto `swallow` es semántico (el adaptador
          // decidirá si aplica stopPropagation a mousedown/touchstart, pero
          // ya sabemos por H1 que no bloquea nada de la librería — la
          // defensa real la da nativeOff que ya emitimos al entrar en armed).
          return { state: "armed", context, effects: [{ type: "swallow" }] };
        }
        // isPrimary, cualquier hit — el lápiz es modal.
        if (!event.domain) {
          // No hay proyección a dominio (p.ej. click fuera del área de datos);
          // el adaptador decide si traga o no. Aquí swallow + idle suave.
          return { state: "armed", context, effects: [{ type: "swallow" }] };
        }
        return {
          state: "drawing",
          context: {
            ...context,
            pendingP1: { time: event.domain.time, price: event.domain.price },
            activePointers: registerPointer(context.activePointers, event),
          },
          effects: [
            { type: "preventDefault" },
            {
              type: "beginOverlay",
              payload: {
                p1: { x: event.domain.x, y: event.domain.y },
                cursor: { x: event.domain.x, y: event.domain.y },
              },
            },
          ],
        };
      }
      return noChange(state, context);
    }

    case "drawing": {
      if (event.type === "pointermove") {
        // Hover con botón pulsado: actualizar cursor en el overlay.
        if (!event.domain) {
          return { state: "drawing", context, effects: [] };
        }
        // El adaptador calcula la posición p1 en píxeles y la adjunta como
        // event.p1Pixel (proyectando p1 desde pendingP1 via screenToDomain
        // inverso del propio adaptador). Aquí sólo propagamos.
        const p1Pixel = event.p1Pixel || null;
        return {
          state: "drawing",
          context,
          effects: [
            {
              type: "updateOverlay",
              payload: {
                p1: p1Pixel,
                cursor: { x: event.domain.x, y: event.domain.y },
              },
            },
          ],
        };
      }
      if (event.type === "pointerdown") {
        if (!event.isPrimary) {
          return { state: "drawing", context, effects: [{ type: "swallow" }] };
        }
        if (!event.domain) {
          return { state: "drawing", context, effects: [{ type: "swallow" }] };
        }
        const p1 = context.pendingP1;
        if (
          p1
          && p1.time === event.domain.time
          && p1.price === event.domain.price
        ) {
          // Mismo punto exacto: descartar, seguir armado.
          return {
            state: "armed",
            context: { ...context, pendingP1: null, activePointers: registerPointer(context.activePointers, event) },
            effects: [{ type: "clearOverlay" }],
          };
        }
        // Commit. El lápiz se apaga al completar (comportamiento actual).
        return {
          state: "idle",
          context: {
            ...context,
            pendingP1: null,
            activePointers: new Map(),
            capturedPointerId: null,
            drag: null,
          },
          effects: [
            { type: "preventDefault" },
            { type: "commitDraw", payload: { p1, p2: { time: event.domain.time, price: event.domain.price } } },
            { type: "clearOverlay" },
            { type: "nativeOn" },
            { type: "setTouchAction", payload: "" },
          ],
        };
      }
      if (event.type === "ESCAPE") {
        return {
          state: "idle",
          context: { ...context, pendingP1: null },
          effects: [
            { type: "nativeOn" },
            { type: "setTouchAction", payload: "" },
            { type: "clearOverlay" },
          ],
        };
      }
      return noChange(state, context);
    }

    case "editing": {
      if (event.type === "pointermove") {
        if (event.pointerId !== context.capturedPointerId) {
          return { state: "editing", context, effects: [] };
        }
        if (!event.domain) {
          return { state: "editing", context, effects: [] };
        }
        if (!context.drag) {
          return { state: "editing", context, effects: [] };
        }
        return {
          state: "editing",
          context,
          effects: [
            {
              type: "updateHandleDrag",
              payload: {
                drawingId: context.drag.drawingId,
                handle: context.drag.handle,
                domain: { time: event.domain.time, price: event.domain.price },
              },
            },
          ],
        };
      }
      if (event.type === "pointerup") {
        if (event.pointerId !== context.capturedPointerId) {
          return { state: "editing", context, effects: [] };
        }
        return {
          state: "idle",
          context: {
            ...context,
            capturedPointerId: null,
            drag: null,
            activePointers: deregisterPointer(context.activePointers, event.pointerId),
          },
          effects: [
            { type: "releasePointer", payload: { pointerId: event.pointerId } },
            { type: "nativeOn" },
          ],
        };
      }
      if (event.type === "pointercancel" || event.type === "lostpointercapture") {
        // ⚠️ REVERT (no commit). Cambio deliberado respecto a v1: hoy
        // pointercancel commitea a medias; aquí deshacemos el drag al
        // originalPoint. Si por algún motivo no se guardó originalPoint, el
        // revert se convierte en no-op (defensivo).
        if (!context.drag) {
          return {
            state: "idle",
            context: {
              ...context,
              capturedPointerId: null,
              activePointers: deregisterPointer(context.activePointers, event.pointerId),
            },
            effects: [
              { type: "releasePointer", payload: { pointerId: event.pointerId } },
              { type: "nativeOn" },
            ],
          };
        }
        return {
          state: "idle",
          context: {
            ...context,
            capturedPointerId: null,
            drag: null,
            activePointers: deregisterPointer(context.activePointers, event.pointerId),
          },
          effects: [
            { type: "revertHandleDrag", payload: { drawingId: context.drag.drawingId, handle: context.drag.handle, originalPoint: context.drag.originalPoint } },
            { type: "releasePointer", payload: { pointerId: event.pointerId } },
            { type: "nativeOn" },
          ],
        };
      }
      if (event.type === "pointerdown") {
        // 2º puntero en editing: swallow (no promovemos a pinch a mitad de
        // edición; ver ADR §3 desde `editing`).
        return { state: "editing", context, effects: [{ type: "swallow" }] };
      }
      if (event.type === "ESCAPE") {
        if (!context.drag) {
          return {
            state: "idle",
            context: { ...context, capturedPointerId: null, activePointers: new Map() },
            effects: [{ type: "nativeOn" }],
          };
        }
        return {
          state: "idle",
          context: {
            ...context,
            capturedPointerId: null,
            drag: null,
            activePointers: new Map(),
          },
          effects: [
            { type: "revertHandleDrag", payload: { drawingId: context.drag.drawingId, handle: context.drag.handle, originalPoint: context.drag.originalPoint } },
            { type: "nativeOn" },
          ],
        };
      }
      return noChange(state, context);
    }

    default:
      return noChange(state, context);
  }
}

function noChange(state, context) {
  return { state, context, effects: [] };
}

function registerPointer(activePointers, event) {
  if (!Number.isFinite(event.pointerId)) return activePointers;
  const next = new Map(activePointers);
  next.set(event.pointerId, {
    pointerType: event.pointerType,
    isPrimary: !!event.isPrimary,
  });
  return next;
}

function deregisterPointer(activePointers, pointerId) {
  if (!Number.isFinite(pointerId)) return activePointers;
  if (!activePointers.has(pointerId)) return activePointers;
  const next = new Map(activePointers);
  next.delete(pointerId);
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública.
// ─────────────────────────────────────────────────────────────────────────────

export function createChartInteractionMachine() {
  let state = INITIAL_STATE;
  let context = initialContext();
  const subscribers = new Set();

  function notify(prev, next) {
    if (prev === next) return;
    for (const fn of subscribers) {
      try {
        fn(next, prev);
      } catch {
        // los suscriptores nunca rompen la máquina
      }
    }
  }

  return {
    getState() {
      return state;
    },
    getContext() {
      // Devolvemos una copia superficial para evitar mutaciones externas del
      // contexto (los Maps internos aún son la referencia viva, pero los
      // efectos que el adaptador aplica via `select`/etc. pasan por el
      // snapshot de transiciones — esto es sólo para inspección en tests/dev).
      return { ...context, activePointers: new Map(context.activePointers) };
    },
    send(event) {
      const prev = state;
      const result = transition(state, context, event);
      state = result.state;
      context = result.context;
      notify(prev, state);
      // Devolvemos SIEMPRE un array nuevo para que el adaptador pueda
      // iterar sin miedo a mutaciones internas.
      return result.effects.slice();
    },
    subscribe(fn) {
      if (typeof fn !== "function") return () => {};
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    // Utilidad para tests: fuerza el estado inicial sin emitir efectos.
    // No se exporta al consumidor; existe para tests y para inicialización.
    __reset() {
      state = INITIAL_STATE;
      context = initialContext();
      // Avisamos explícitamente a suscriptores (notify requiere prev !== next;
      // aquí prev === state previo antes del reset, así que si ya era idle no
      // se notifica — comportamiento intencional).
      const prev = state;
      state = INITIAL_STATE;
      context = initialContext();
      if (prev !== state) notify(prev, state);
    },
  };
}

// Utilidades exportadas para tests (no parte del contrato de runtime).
export const __test__ = {
  transition,
  initialContext,
  registerPointer,
  deregisterPointer,
  activeTouchCount,
  totalActiveCount,
};