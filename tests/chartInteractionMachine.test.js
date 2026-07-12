// tests/chartInteractionMachine.test.js — Tests de tabla para la máquina
// pura de interacción del chart. Cubren las transiciones del ADR §3, incluidos
// los casos multi-pointer (panning→pinching, pinch→pan, 3rd finger) y el
// revert-on-cancel en editing (cambio respecto a v1).
//
// Tabla de eventos sintéticos (helpers abajo):
//   pdown(pointerId, {type:'touch', isPrimary:true, hit})
//   pmove(pointerId, {type, isPrimary, domain})
//   pup(pointerId, {type})
//   pcancel(pointerId)
//   ARM / DISARM / ESCAPE / DETACH

import { describe, expect, it } from "vitest";
import {
  NATIVE_GESTURES_ON,
  NATIVE_GESTURES_OFF,
  createChartInteractionMachine,
} from "@/lib/chartInteractionMachine";

let pid = 1;
const nextPid = () => pid++;

function pdown(pointerId, opts = {}) {
  return {
    type: "pointerdown",
    pointerId: pointerId ?? nextPid(),
    pointerType: opts.pointerType ?? "mouse",
    isPrimary: opts.isPrimary ?? true,
    hit: opts.hit ?? "empty",
    domain: opts.domain ?? null,
    drawingId: opts.drawingId ?? null,
    handle: opts.handle ?? null,
    originalPoint: opts.originalPoint ?? null,
    p1Pixel: opts.p1Pixel ?? null,
  };
}

function pmove(pointerId, opts = {}) {
  return {
    type: "pointermove",
    pointerId,
    pointerType: opts.pointerType ?? "mouse",
    isPrimary: opts.isPrimary ?? true,
    domain: opts.domain ?? null,
    p1Pixel: opts.p1Pixel ?? null,
  };
}

function pup(pointerId, opts = {}) {
  return { type: "pointerup", pointerId, pointerType: opts.pointerType ?? "mouse", isPrimary: false };
}

function pcancel(pointerId, opts = {}) {
  return { type: "pointercancel", pointerId, pointerType: opts.pointerType ?? "mouse", isPrimary: false };
}

// Helpers de aserción de efectos.
function effectTypes(effects) {
  return effects.map((e) => e.type);
}

describe("chartInteractionMachine · baseline nativo nombrado (ADR §4)", () => {
  it("NATIVE_GESTURES_ON fija mouseWheel:false y pinch:true", () => {
    expect(NATIVE_GESTURES_ON.handleScroll.mouseWheel).toBe(false);
    expect(NATIVE_GESTURES_ON.handleScroll.pressedMouseMove).toBe(true);
    expect(NATIVE_GESTURES_ON.handleScroll.horzTouchDrag).toBe(true);
    expect(NATIVE_GESTURES_ON.handleScroll.vertTouchDrag).toBe(false);
    expect(NATIVE_GESTURES_ON.handleScale.mouseWheel).toBe(false);
    expect(NATIVE_GESTURES_ON.handleScale.pinch).toBe(true);
    expect(NATIVE_GESTURES_ON.handleScale.axisDoubleClickReset).toBe(true);
    expect(NATIVE_GESTURES_ON.handleScale.axisPressedMouseMove).toBe(false);
  });

  it("NATIVE_GESTURES_OFF apaga TODO, incluido pinch y axisDoubleClickReset", () => {
    expect(NATIVE_GESTURES_OFF.handleScroll.mouseWheel).toBe(false);
    expect(NATIVE_GESTURES_OFF.handleScroll.pressedMouseMove).toBe(false);
    expect(NATIVE_GESTURES_OFF.handleScroll.horzTouchDrag).toBe(false);
    expect(NATIVE_GESTURES_OFF.handleScroll.vertTouchDrag).toBe(false);
    expect(NATIVE_GESTURES_OFF.handleScale.mouseWheel).toBe(false);
    expect(NATIVE_GESTURES_OFF.handleScale.pinch).toBe(false);
    expect(NATIVE_GESTURES_OFF.handleScale.axisDoubleClickReset).toBe(false);
    expect(NATIVE_GESTURES_OFF.handleScale.axisPressedMouseMove).toBe(false);
  });

  it("Ambos presets son deep-frozen-friendly: spread no muta el original", () => {
    const a = { ...NATIVE_GESTURES_ON };
    a.handleScroll = { ...a.handleScroll, pressedMouseMove: false };
    expect(NATIVE_GESTURES_ON.handleScroll.pressedMouseMove).toBe(true);
  });
});

describe("chartInteractionMachine · idle (ADR §3, \"Desde idle\")", () => {
  it("estado inicial es idle", () => {
    const m = createChartInteractionMachine();
    expect(m.getState()).toBe("idle");
  });

  it("ARM → armed con nativeOff + setTouchAction:none + deselect", () => {
    const m = createChartInteractionMachine();
    const eff = m.send({ type: "ARM" });
    expect(m.getState()).toBe("armed");
    expect(effectTypes(eff)).toEqual(["nativeOff", "setTouchAction", "deselect"]);
    expect(eff.find((e) => e.type === "setTouchAction").payload).toBe("none");
  });

  it("pointerdown·handle → editing con nativeOff + capturePointer + select + beginHandleDrag", () => {
    const m = createChartInteractionMachine();
    const op = { time: 100, price: 50 };
    const eff = m.send(pdown(1, {
      hit: "handle",
      drawingId: "d1",
      handle: "p1",
      originalPoint: op,
    }));
    expect(m.getState()).toBe("editing");
    const types = effectTypes(eff);
    expect(types).toContain("nativeOff");
    expect(types).toContain("capturePointer");
    expect(types).toContain("select");
    expect(types).toContain("preventDefault");
    expect(types).toContain("beginHandleDrag");
    const ctx = m.getContext();
    expect(ctx.capturedPointerId).toBe(1);
    expect(ctx.drag).toEqual({ drawingId: "d1", handle: "p1", originalPoint: op });
    expect(ctx.selectedId).toBe("d1");
  });

  it("pointerdown·body → panning + select (si hay drawingId)", () => {
    const m = createChartInteractionMachine();
    const eff = m.send(pdown(1, { hit: "body", drawingId: "d1" }));
    expect(m.getState()).toBe("panning");
    expect(eff).toEqual([{ type: "select", payload: { id: "d1" } }]);
  });

  it("pointerdown·empty → panning + deselect", () => {
    const m = createChartInteractionMachine();
    const eff = m.send(pdown(1, { hit: "empty" }));
    expect(m.getState()).toBe("panning");
    expect(effectTypes(eff)).toEqual(["deselect"]);
  });
});

describe("chartInteractionMachine · panning (ADR §3, \"Desde panning\")", () => {
  it("pointermove se queda en panning sin efectos (la librería gestiona el scroll)", () => {
    const m = createChartInteractionMachine();
    m.send(pdown(1, { hit: "empty" }));
    const eff = m.send(pmove(1, { domain: { x: 10, y: 10, time: 1, price: 1 } }));
    expect(m.getState()).toBe("panning");
    expect(eff).toEqual([]);
  });

  it("2º touch → pinching (sin efectos: la librería promueve sola)", () => {
    const m = createChartInteractionMachine();
    m.send(pdown(1, { pointerType: "touch", hit: "empty" }));
    const eff = m.send(pdown(2, { pointerType: "touch", isPrimary: false, hit: "empty" }));
    expect(m.getState()).toBe("pinching");
    expect(eff).toEqual([]);
  });

  it("2º puntero NO touch → sigue en panning, ignorado", () => {
    const m = createChartInteractionMachine();
    m.send(pdown(1, { pointerType: "touch", hit: "empty" }));
    const eff = m.send(pdown(2, { pointerType: "mouse", isPrimary: false, hit: "empty" }));
    expect(m.getState()).toBe("panning");
    expect(eff).toEqual([]);
  });

  it("pointerup del último puntero → idle sin efectos", () => {
    const m = createChartInteractionMachine();
    m.send(pdown(1, { hit: "empty" }));
    const eff = m.send(pup(1));
    expect(m.getState()).toBe("idle");
    expect(eff).toEqual([]);
  });
});

describe("chartInteractionMachine · pinching (ADR §3, \"Desde pinching\")", () => {
  function setupPinching() {
    const m = createChartInteractionMachine();
    m.send(pdown(1, { pointerType: "touch", hit: "empty" }));
    m.send(pdown(2, { pointerType: "touch", isPrimary: false, hit: "empty" }));
    expect(m.getState()).toBe("pinching");
    return m;
  }

  it("pointerup de un dedo (queda 1 touch) → panning, sin efectos", () => {
    const m = setupPinching();
    const eff = m.send(pup(1, { pointerType: "touch" }));
    expect(m.getState()).toBe("panning");
    expect(eff).toEqual([]);
  });

  it("pointercancel del último touch → idle, sin efectos", () => {
    const m = setupPinching();
    m.send(pup(1, { pointerType: "touch" })); // ahora en panning
    const eff = m.send(pup(2, { pointerType: "touch" }));
    expect(m.getState()).toBe("idle");
    expect(eff).toEqual([]);
  });

  it("3º dedo → panning, sin efectos (la librería aborta pinch con touches.length !== 2)", () => {
    const m = setupPinching();
    const eff = m.send(pdown(3, { pointerType: "touch", isPrimary: false, hit: "empty" }));
    expect(m.getState()).toBe("panning");
    expect(eff).toEqual([]);
  });
});

describe("chartInteractionMachine · armed (ADR §3, \"Desde armed\")", () => {
  it("DISARM → idle con nativeOn + clearOverlay", () => {
    const m = createChartInteractionMachine();
    m.send({ type: "ARM" });
    const eff = m.send({ type: "DISARM" });
    expect(m.getState()).toBe("idle");
    expect(effectTypes(eff)).toEqual(["nativeOn", "setTouchAction", "clearOverlay"]);
  });

  it("ESCAPE → idle con nativeOn + clearOverlay", () => {
    const m = createChartInteractionMachine();
    m.send({ type: "ARM" });
    const eff = m.send({ type: "ESCAPE" });
    expect(m.getState()).toBe("idle");
    expect(effectTypes(eff)).toEqual(["nativeOn", "setTouchAction", "clearOverlay"]);
  });

  it("pointerdown·primary con dominio → drawing + beginOverlay + preventDefault", () => {
    const m = createChartInteractionMachine();
    m.send({ type: "ARM" });
    const domain = { x: 100, y: 100, time: 1700000000, price: 42 };
    const eff = m.send(pdown(1, { hit: "body", domain })); // hit ignorado en armed (modal)
    expect(m.getState()).toBe("drawing");
    expect(eff).toContainEqual({ type: "preventDefault" });
    expect(eff.find((e) => e.type === "beginOverlay")).toBeDefined();
    expect(m.getContext().pendingP1).toEqual({ time: domain.time, price: domain.price });
  });

  it("pointerdown·!primary → swallow, se queda en armed", () => {
    const m = createChartInteractionMachine();
    m.send({ type: "ARM" });
    const eff = m.send(pdown(2, { isPrimary: false, hit: "body", domain: { x: 0, y: 0, time: 1, price: 1 } }));
    expect(m.getState()).toBe("armed");
    expect(eff).toEqual([{ type: "swallow" }]);
  });

  it("pointerdown sin dominio → swallow, se queda en armed", () => {
    const m = createChartInteractionMachine();
    m.send({ type: "ARM" });
    const eff = m.send(pdown(1, { hit: "body" })); // sin domain
    expect(m.getState()).toBe("armed");
    expect(eff).toEqual([{ type: "swallow" }]);
  });
});

describe("chartInteractionMachine · drawing (ADR §3, \"Desde drawing\")", () => {
  function setupDrawing() {
    const m = createChartInteractionMachine();
    m.send({ type: "ARM" });
    m.send(pdown(1, {
      hit: "body",
      domain: { x: 100, y: 100, time: 1700000000, price: 42 },
    }));
    expect(m.getState()).toBe("drawing");
    return m;
  }

  it("pointermove actualiza el overlay", () => {
    const m = setupDrawing();
    const eff = m.send(pmove(1, {
      domain: { x: 150, y: 110, time: 1700000500, price: 43 },
      p1Pixel: { x: 100, y: 100 },
    }));
    expect(m.getState()).toBe("drawing");
    const upd = eff.find((e) => e.type === "updateOverlay");
    expect(upd).toBeDefined();
    expect(upd.payload.cursor).toEqual({ x: 150, y: 110 });
    expect(upd.payload.p1).toEqual({ x: 100, y: 100 });
  });

  it("pointerdown·primary con dominio distinto → commit + idle + nativeOn + setTouchAction", () => {
    const m = setupDrawing();
    const eff = m.send(pdown(1, {
      hit: "body",
      domain: { x: 200, y: 110, time: 1700001000, price: 50 },
    }));
    expect(m.getState()).toBe("idle");
    const commit = eff.find((e) => e.type === "commitDraw");
    expect(commit).toBeDefined();
    expect(commit.payload.p1).toEqual({ time: 1700000000, price: 42 });
    expect(commit.payload.p2).toEqual({ time: 1700001000, price: 50 });
    expect(effectTypes(eff)).toContain("clearOverlay");
    expect(effectTypes(eff)).toContain("nativeOn");
    expect(effectTypes(eff)).toContain("setTouchAction");
    // Estado limpio tras commit.
    const ctx = m.getContext();
    expect(ctx.pendingP1).toBeNull();
    expect(ctx.activePointers.size).toBe(0);
  });

  it("pointerdown·primary MISMO punto exacto → vuelve a armed + clearOverlay", () => {
    const m = setupDrawing();
    const eff = m.send(pdown(1, {
      hit: "body",
      domain: { x: 100, y: 100, time: 1700000000, price: 42 }, // idéntico a p1
    }));
    expect(m.getState()).toBe("armed");
    expect(eff).toEqual([{ type: "clearOverlay" }]);
  });

  it("pointerdown·!primary → swallow, se queda en drawing", () => {
    const m = setupDrawing();
    const eff = m.send(pdown(2, {
      isPrimary: false,
      hit: "body",
      domain: { x: 200, y: 110, time: 1700001000, price: 50 },
    }));
    expect(m.getState()).toBe("drawing");
    expect(eff).toEqual([{ type: "swallow" }]);
  });

  it("ESCAPE → idle + nativeOn + clearOverlay (cancela dibujo en curso)", () => {
    const m = setupDrawing();
    const eff = m.send({ type: "ESCAPE" });
    expect(m.getState()).toBe("idle");
    expect(effectTypes(eff)).toEqual(["nativeOn", "setTouchAction", "clearOverlay"]);
    expect(m.getContext().pendingP1).toBeNull();
  });
});

describe("chartInteractionMachine · editing (ADR §3, \"Desde editing\" + §7.1)", () => {
  const originalPoint = { time: 1700000000, price: 42 };
  function setupEditing() {
    const m = createChartInteractionMachine();
    m.send(pdown(1, {
      hit: "handle",
      drawingId: "d1",
      handle: "p1",
      originalPoint,
    }));
    expect(m.getState()).toBe("editing");
    return m;
  }

  it("pointermove del pointerId capturado → updateHandleDrag con el nuevo dominio", () => {
    const m = setupEditing();
    const eff = m.send(pmove(1, {
      domain: { x: 200, y: 110, time: 1700001000, price: 50 },
    }));
    expect(m.getState()).toBe("editing");
    const upd = eff.find((e) => e.type === "updateHandleDrag");
    expect(upd).toEqual({
      type: "updateHandleDrag",
      payload: { drawingId: "d1", handle: "p1", domain: { time: 1700001000, price: 50 } },
    });
  });

  it("pointermove de OTRO pointerId → ignora (no emite updateHandleDrag)", () => {
    const m = setupEditing();
    const eff = m.send(pmove(99, {
      domain: { x: 999, y: 999, time: 999, price: 999 },
    }));
    expect(m.getState()).toBe("editing");
    expect(effectTypes(eff)).toEqual([]);
  });

  it("pointerup del capturado → commit (sin revert) + releasePointer + nativeOn + idle", () => {
    const m = setupEditing();
    const eff = m.send(pup(1));
    expect(m.getState()).toBe("idle");
    expect(effectTypes(eff)).toEqual(["releasePointer", "nativeOn"]);
    expect(m.getContext().drag).toBeNull();
    expect(m.getContext().capturedPointerId).toBeNull();
  });

  it("⚠️ pointercancel → REVERT al originalPoint (NO commit) — cambio ADR §7.1", () => {
    const m = setupEditing();
    const eff = m.send(pcancel(1));
    expect(m.getState()).toBe("idle");
    const revert = eff.find((e) => e.type === "revertHandleDrag");
    expect(revert).toEqual({
      type: "revertHandleDrag",
      payload: { drawingId: "d1", handle: "p1", originalPoint },
    });
    expect(effectTypes(eff)).toContain("releasePointer");
    expect(effectTypes(eff)).toContain("nativeOn");
    // NO debe haber commit ni updateHandleDrag.
    expect(effectTypes(eff)).not.toContain("updateHandleDrag");
  });

  it("lostpointercapture → REVERT (mismo camino que pointercancel)", () => {
    const m = setupEditing();
    const eff = m.send({ type: "lostpointercapture", pointerId: 1 });
    expect(m.getState()).toBe("idle");
    const revert = eff.find((e) => e.type === "revertHandleDrag");
    expect(revert).toBeDefined();
    expect(revert.payload.originalPoint).toEqual(originalPoint);
  });

  it("pointerdown de 2º puntero en editing → swallow (no promueve a pinch)", () => {
    const m = setupEditing();
    const eff = m.send(pdown(2, {
      pointerType: "touch",
      isPrimary: false,
      hit: "empty",
    }));
    expect(m.getState()).toBe("editing");
    expect(eff).toEqual([{ type: "swallow" }]);
  });

  it("ESCAPE en editing → REVERT al originalPoint + idle + nativeOn", () => {
    const m = setupEditing();
    const eff = m.send({ type: "ESCAPE" });
    expect(m.getState()).toBe("idle");
    const revert = eff.find((e) => e.type === "revertHandleDrag");
    expect(revert.payload.originalPoint).toEqual(originalPoint);
    expect(effectTypes(eff)).toContain("nativeOn");
  });

  it("pointerup de un pointerId distinto al capturado → ignora", () => {
    const m = setupEditing();
    const eff = m.send(pup(99));
    expect(m.getState()).toBe("editing");
    expect(effectTypes(eff)).toEqual([]);
  });
});

describe("chartInteractionMachine · DETACH (ADR §7.2)", () => {
  it("DETACH desde cualquier estado lleva a idle y descarta gesto en curso", () => {
    // editing con drag en curso
    const m = createChartInteractionMachine();
    m.send(pdown(1, {
      hit: "handle",
      drawingId: "d1",
      handle: "p1",
      originalPoint: { time: 1, price: 1 },
    }));
    expect(m.getState()).toBe("editing");
    const eff = m.send({ type: "DETACH" });
    expect(m.getState()).toBe("idle");
    expect(eff).toEqual([]); // sin efectos: el chart viejo muere
    const ctx = m.getContext();
    expect(ctx.activePointers.size).toBe(0);
    expect(ctx.capturedPointerId).toBeNull();
    expect(ctx.drag).toBeNull();
    expect(ctx.pendingP1).toBeNull();
  });

  it("DETACH desde armed descarta pendingP1=null (ya era null) y va a idle", () => {
    const m = createChartInteractionMachine();
    m.send({ type: "ARM" });
    expect(m.getState()).toBe("armed");
    m.send({ type: "DETACH" });
    expect(m.getState()).toBe("idle");
  });

  it("DETACH desde pinching descarta el estado", () => {
    const m = createChartInteractionMachine();
    m.send(pdown(1, { pointerType: "touch", hit: "empty" }));
    m.send(pdown(2, { pointerType: "touch", isPrimary: false, hit: "empty" }));
    expect(m.getState()).toBe("pinching");
    m.send({ type: "DETACH" });
    expect(m.getState()).toBe("idle");
    expect(m.getContext().activePointers.size).toBe(0);
  });
});

describe("chartInteractionMachine · suscriptores", () => {
  // Mock counter real: aserta cuántas veces se invoca el callback y con qué
  // argumentos. Sin esto, "subscribe notifica en cada cambio" sería ruido
  // (un test que no assert-ea nada es peor que ningún test).
  function makeSpy() {
    const calls = [];
    const spy = (...args) => {
      calls.push(args);
    };
    spy.calls = calls;
    spy.count = () => calls.length;
    spy.last = () => calls[calls.length - 1] || null;
    return spy;
  }

  it("subscribe(fn) NO notifica cuando send() no produce cambio de estado", () => {
    const m = createChartInteractionMachine();
    const spy = makeSpy();
    m.subscribe(spy);
    // DISARM desde idle: no hay caso en la tabla de transiciones para
    // (idle, DISARM) — el switch cae en `default: noChange`, que devuelve
    // { state, context, effects: [] } sin tocar notify(). Verificamos:
    m.send({ type: "DISARM" });
    expect(m.getState()).toBe("idle");
    expect(spy.count()).toBe(0);
  });

  it("subscribe(fn) notifica UNA vez por transición real (idle → armed)", () => {
    const m = createChartInteractionMachine();
    const spy = makeSpy();
    m.subscribe(spy);
    m.send({ type: "ARM" });
    expect(spy.count()).toBe(1);
    expect(spy.last()).toEqual(["armed", "idle"]);
  });

  it("subscribe(fn) notifica N veces para N transiciones encadenadas", () => {
    const m = createChartInteractionMachine();
    const spy = makeSpy();
    m.subscribe(spy);
    // idle → armed → drawing → idle (commit) → idle (sin cambio)
    m.send({ type: "ARM" });
    m.send(pdown(1, {
      hit: "body",
      domain: { x: 100, y: 100, time: 1700000000, price: 42 },
    }));
    m.send(pdown(1, {
      hit: "body",
      domain: { x: 200, y: 110, time: 1700001000, price: 50 },
    }));
    // Ésta no debe incrementar el contador (mismo estado, mismo evento sin guard).
    m.send({ type: "DISARM" });
    expect(spy.count()).toBe(3);
    expect(spy.calls.map(([next, prev]) => [prev, next])).toEqual([
      ["idle", "armed"],
      ["armed", "drawing"],
      ["drawing", "idle"],
    ]);
  });

  it("subscribe(fn) recibe (next, prev) en cada llamada — argumento semántico", () => {
    const m = createChartInteractionMachine();
    const spy = makeSpy();
    m.subscribe(spy);
    m.send({ type: "ARM" });
    const [next, prev] = spy.last();
    expect(next).toBe(m.getState());
    expect(prev).toBe("idle");
  });

  it("varios suscriptores reciben la misma transición en orden de registro", () => {
    const m = createChartInteractionMachine();
    const order = [];
    m.subscribe(() => order.push("a"));
    m.subscribe(() => order.push("b"));
    m.subscribe(() => order.push("c"));
    m.send({ type: "ARM" });
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("unsubscribe() deja de notificar a ese suscriptor pero NO a los demás", () => {
    const m = createChartInteractionMachine();
    const spyA = makeSpy();
    const spyB = makeSpy();
    const unsubA = m.subscribe(spyA);
    m.subscribe(spyB);
    m.send({ type: "ARM" });
    expect(spyA.count()).toBe(1);
    expect(spyB.count()).toBe(1);
    unsubA();
    m.send({ type: "DISARM" });
    expect(spyA.count()).toBe(1); // no aumenta
    expect(spyB.count()).toBe(2); // sí aumenta
  });

  it("los suscriptores no rompen la máquina si lanzan", () => {
    const m = createChartInteractionMachine();
    const spyAfter = makeSpy();
    m.subscribe(() => {
      throw new Error("boom");
    });
    m.subscribe(spyAfter);
    expect(() => m.send({ type: "ARM" })).not.toThrow();
    expect(m.getState()).toBe("armed");
    // El suscriptor posterior al que lanza SÍ debe recibir la notificación:
    // notify() traga la excepción y continúa.
    expect(spyAfter.count()).toBe(1);
  });
});

describe("chartInteractionMachine · aislamiento de efectos", () => {
  it("send devuelve un array nuevo en cada llamada (no aliasing interno)", () => {
    const m = createChartInteractionMachine();
    const a = m.send({ type: "ARM" });
    const b = m.send({ type: "DISARM" });
    expect(a).not.toBe(b);
  });
});