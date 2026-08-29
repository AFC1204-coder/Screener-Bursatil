// tests/chartViewport.test.js — contrato de ventana del viewport
// (docs/analisis-grafico-2026-08-14.md, Parte C.1 — la inversión).
//
// Pieza bajo prueba: `lib/chartViewportLifecycle.js`. El contrato:
//
//   - attach dibuja el rango declarado ENTERO (`fitContent`) — la ventana es
//     función pura de (settings, datos), no de un perfil de barras objetivo;
//   - la desviación manual (gesto o acción) es estado explícito: una ventana
//     temporal que se re-aplica tal cual en el siguiente attach y se limpia
//     con `clearManual()` (cambio de símbolo/rango/intervalo) o `reset()`;
//   - UNA instancia: botones, rueda y raíl operan sobre el mismo attachment
//     que gobierna el chart;
//   - liberar (release/detach/attach nuevo) retira TODOS los listeners:
//     suscripción del timeScale, wheel y ResizeObserver;
//   - la publicación (RAF único) nunca se auto-bloquea y el snapshot incluye
//     `view` — el raíl se alimenta de él.
//
// Estrategia: la pieza pura se invoca con un fake timeScale y un container
// stub. Sin React, sin DOM. Las publicaciones por RAF se capturan con un
// polyfill de requestAnimationFrame/cancelAnimationFrame en globalThis.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createViewportLifecycle } from "@/lib/chartViewportLifecycle";

// ─────────────────────────────────────────────────────────────────────────────
// Polyfills Node: requestAnimationFrame/cancelAnimationFrame, ResizeObserver,
// WheelEvent.

let rafCallbacks = [];
let rafIdCounter = 0;
let originalRaf;
let originalCaf;
let originalResizeObserver;
let originalWheelEvent;

function setupBrowserEnvironment() {
  rafCallbacks = [];
  rafIdCounter = 0;
  originalRaf = globalThis.requestAnimationFrame;
  originalCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => {
    rafIdCounter += 1;
    rafCallbacks.push({ id: rafIdCounter, cb });
    return rafIdCounter;
  };
  globalThis.cancelAnimationFrame = (id) => {
    rafCallbacks = rafCallbacks.filter((entry) => entry.id !== id);
  };

  originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(cb) { this.cb = cb; }
    observe(target) {
      this.target = target;
      if (target) target._resizeObserver = this;
    }
    disconnect() { this.target = null; }
    trigger(entry) { this.cb([entry]); }
  };

  originalWheelEvent = globalThis.WheelEvent;
  globalThis.WheelEvent = class WheelEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = !!init.bubbles;
      this.cancelable = init.cancelable !== false;
      this.ctrlKey = !!init.ctrlKey;
      this.deltaY = Number(init.deltaY || 0);
      this.defaultPrevented = false;
    }
    preventDefault() { this.defaultPrevented = true; }
    stopImmediatePropagation() { this._stopped = true; }
  };
}

function teardownBrowserEnvironment() {
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCaf;
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.WheelEvent = originalWheelEvent;
}

function flushRaf() {
  const callbacks = rafCallbacks;
  rafCallbacks = [];
  for (const entry of callbacks) entry.cb();
}

function makeContainer(width = 800, height = 460) {
  const listeners = { wheel: [] };
  const container = {
    clientWidth: width,
    clientHeight: height,
    addEventListener(type, cb, options) {
      if (type === "wheel") listeners.wheel.push({ cb, options });
    },
    removeEventListener(type, cb) {
      if (type === "wheel") listeners.wheel = listeners.wheel.filter((l) => l.cb !== cb);
    },
    dispatchEvent(event) {
      for (const { cb } of [...listeners.wheel]) cb(event);
      return true;
    },
    _listeners: listeners,
    _resizeObserver: null,
  };
  return container;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures.

const TRADING_DAY = 86400;
const BASE_TIME = Math.floor(Date.UTC(2024, 0, 1) / 1000);

function makeRowTimes(count, { start = BASE_TIME, step = TRADING_DAY } = {}) {
  return Array.from({ length: count }, (_, i) => start + i * step);
}

function createFakeTimeScale({ rowCount = 200, initialLogical = null } = {}) {
  const log = { reads: [], writes: [], subscribes: [], unsubscribes: [] };
  let currentLogical = initialLogical;
  const logicalSubs = new Set();

  const fake = {
    _currentLogical: () => currentLogical,
    _log: log,
    _subCount: () => logicalSubs.size,
    getVisibleLogicalRange() {
      log.reads.push({ kind: "logical" });
      return currentLogical ? { from: currentLogical.from, to: currentLogical.to } : null;
    },
    setVisibleLogicalRange(next) {
      if (!next) return;
      currentLogical = { from: Number(next.from), to: Number(next.to) };
      log.writes.push({ kind: "logical", value: { ...currentLogical } });
    },
    subscribeVisibleLogicalRangeChange(handler) {
      logicalSubs.add(handler);
      log.subscribes.push({ kind: "logical", count: logicalSubs.size });
    },
    unsubscribeVisibleLogicalRangeChange(handler) {
      logicalSubs.delete(handler);
      log.unsubscribes.push({ kind: "logical", count: logicalSubs.size });
    },
    fitContent() {
      currentLogical = { from: -0.5, to: rowCount - 0.5 };
      log.writes.push({ kind: "fitContent", value: { ...currentLogical } });
    },
    scrollToRealTime() {
      log.writes.push({ kind: "scrollToRealTime" });
    },
    applyOptions() {
      log.writes.push({ kind: "applyOptions" });
    },
    emitLogical(next) {
      if (next) currentLogical = { from: Number(next.from), to: Number(next.to) };
      for (const handler of [...logicalSubs]) handler(currentLogical);
    },
  };

  return fake;
}

function createFakeChart(timeScale) {
  const calls = { remove: 0, applyOptions: 0, options: [] };
  return {
    timeScale: () => timeScale,
    applyOptions(opts) { calls.applyOptions += 1; calls.options.push(opts); },
    remove() { calls.remove += 1; },
    chartElement() { return null; },
    _calls: calls,
  };
}

function createHarness({
  rowTimes = makeRowTimes(200),
  getInteractionState = () => "idle",
  interval = "D",
  dataRange = "1A",
} = {}) {
  const published = [];
  let currentRowTimes = rowTimes;
  const lifecycle = createViewportLifecycle({
    publish: (snapshot) => published.push(snapshot),
    getInteractionState,
    getConfig: () => ({ interval, dataRange }),
    getRequestedHeight: () => 460,
    getRowTimes: () => currentRowTimes,
  });
  return {
    lifecycle,
    published,
    setRowTimes(next) { currentRowTimes = next; },
  };
}

function attachFresh(harness, { rowCount = 200, width = 800 } = {}) {
  const timeScale = createFakeTimeScale({ rowCount });
  const chart = createFakeChart(timeScale);
  const container = makeContainer(width);
  const release = harness.lifecycle.attach({ chart, container });
  return { timeScale, chart, container, release };
}

beforeEach(() => {
  setupBrowserEnvironment();
});

afterEach(() => {
  teardownBrowserEnvironment();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Contrato: la ventana inicial es el rango declarado entero (fallo 1).

describe("viewport · attach dibuja el rango declarado entero", () => {
  it("attach hace fitContent: la ventana visible cubre TODAS las filas", () => {
    const harness = createHarness({ rowTimes: makeRowTimes(243) });
    const { timeScale } = attachFresh(harness, { rowCount: 243 });

    const fits = timeScale._log.writes.filter((w) => w.kind === "fitContent");
    expect(fits.length).toBeGreaterThanOrEqual(1);
    expect(timeScale._currentLogical()).toEqual({ from: -0.5, to: 242.5 });

    flushRaf();
    const snapshot = harness.published.at(-1);
    expect(snapshot.view.visibleBars).toBe(243);
    expect(snapshot.view.key).toBe("latest");
    expect(snapshot.manual).toBe(false);
  });

  it("el snapshot publicado incluye `view` y la etiqueta de ventana (el raíl se puebla)", () => {
    const harness = createHarness();
    attachFresh(harness);
    flushRaf();

    const snapshot = harness.published.at(-1);
    expect(snapshot.lifecycle).toBe("attached");
    expect(snapshot.view).toBeTruthy();
    expect(snapshot.view.key).toBe("latest");
    expect(typeof snapshot.view.visibleBars).toBe("number");
    expect(snapshot.visibleWindowLabel).not.toBe("Sin ventana");
    expect(snapshot.visibleTimeRange).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acciones: misma instancia que gobierna el chart (fallo 2).

describe("viewport · acciones sobre la instancia única", () => {
  it("zoom acerca la ventana y la clasifica como desviación manual", () => {
    const harness = createHarness();
    const { timeScale } = attachFresh(harness);

    harness.lifecycle.actions.zoom(0.5);

    const last = timeScale._log.writes.at(-1);
    expect(last.kind).toBe("logical");
    expect(last.value.to - last.value.from).toBeCloseTo(100, 5);

    flushRaf();
    const snapshot = harness.published.at(-1);
    expect(snapshot.view.isManual).toBe(true);
    expect(snapshot.manual).toBe(true);
  });

  it("pan desplaza la ventana hacia el historial", () => {
    const harness = createHarness();
    const { timeScale } = attachFresh(harness);
    harness.lifecycle.actions.zoom(0.5);
    const before = timeScale._currentLogical();

    harness.lifecycle.actions.pan(-1);

    const after = timeScale._currentLogical();
    expect(after.from).toBeLessThan(before.from);
    expect(after.to - after.from).toBeCloseTo(before.to - before.from, 5);
  });

  it("pan hacia historial desde fit completo acerca y desplaza (no no-op)", () => {
    const harness = createHarness();
    const { timeScale } = attachFresh(harness);
    const before = timeScale._currentLogical();
    expect(before.from).toBeCloseTo(-0.5, 5);

    harness.lifecycle.actions.pan(-1);

    const after = timeScale._currentLogical();
    expect(after.to - after.from).toBeLessThan(before.to - before.from);
    expect(after.from).toBeGreaterThanOrEqual(-0.5);
    flushRaf();
    expect(harness.published.at(-1).manual).toBe(true);
  });

  it("reset limpia la desviación manual y vuelve al rango entero", () => {
    const harness = createHarness();
    const { timeScale } = attachFresh(harness);
    harness.lifecycle.actions.zoom(0.5);
    flushRaf();
    expect(harness.published.at(-1).manual).toBe(true);

    harness.lifecycle.actions.reset();

    expect(timeScale._currentLogical()).toEqual({ from: -0.5, to: 199.5 });
    flushRaf();
    const snapshot = harness.published.at(-1);
    expect(snapshot.manual).toBe(false);
    expect(snapshot.view.key).toBe("latest");
  });

  it("las acciones son no-op cuando no hay attachment (detached)", () => {
    const harness = createHarness();
    expect(() => {
      harness.lifecycle.actions.zoom(0.5);
      harness.lifecycle.actions.pan(-1);
      harness.lifecycle.actions.reset();
      harness.lifecycle.actions.scrollToLatest();
    }).not.toThrow();
    expect(harness.published.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gestos nativos (arrastre/pinch de la librería) → manual derivado.

describe("viewport · gestos nativos", () => {
  it("un cambio de rango por gesto se clasifica y publica como manual", () => {
    const harness = createHarness();
    const { timeScale } = attachFresh(harness);
    flushRaf();

    timeScale.emitLogical({ from: 50, to: 120 });
    flushRaf();

    const snapshot = harness.published.at(-1);
    expect(snapshot.view.isManual).toBe(true);
    expect(snapshot.manual).toBe(true);
    expect(snapshot.visibleLogicalRange).toEqual({ from: 50, to: 120 });
  });

  it("pan nativo con whitespace izquierdo persiste tras resize (no fitContent)", () => {
    const harness = createHarness();
    const { timeScale, container } = attachFresh(harness);
    flushRaf();

    // Simula arrastre horizontal con fixLeftEdge:false: whitespace a la izquierda
    // pero el último dato sigue en el borde derecho.
    timeScale.emitLogical({ from: -30, to: 199.5 });
    flushRaf();
    expect(harness.published.at(-1).manual).toBe(true);

    const manual = timeScale._currentLogical();
    const fitsBefore = timeScale._log.writes.filter((w) => w.kind === "fitContent").length;

    container._resizeObserver.trigger({ contentRect: { width: 1200, height: 600 } });

    const fitsAfter = timeScale._log.writes.filter((w) => w.kind === "fitContent").length;
    expect(fitsAfter).toBe(fitsBefore);
    const applied = timeScale._currentLogical();
    expect(applied.from).toBeCloseTo(manual.from, 0);
    expect(applied.to).toBeCloseTo(manual.to, 0);
    flushRaf();
    expect(harness.published.at(-1).manual).toBe(true);
  });

  it("los estados intermedios de una aplicación diferida NO se convierten en desviación manual", () => {
    // lightweight-charts aplica fitContent en su propio animation frame: un
    // chart recién creado emite primero su ventana de espaciado por defecto
    // (~180 barras ancladas a la derecha). Ese estado intermedio no es un
    // gesto del usuario: si se derivara como manual, el ResizeObserver lo
    // re-aplicaría y el fit no llegaría nunca (visto en vivo: "Zoom 196" en
    // una carga limpia).
    const harness = createHarness();
    const timeScale = createFakeTimeScale({ rowCount: 200 });
    // Simula la aplicación diferida: fitContent NO cambia el rango al
    // instante; el chart emite primero un estado intermedio.
    timeScale.fitContent = () => { timeScale._log.writes.push({ kind: "fitContent" }); };
    const chart = createFakeChart(timeScale);
    const container = makeContainer(800);
    harness.lifecycle.attach({ chart, container });

    // Emisión intermedia (ventana por defecto de la librería, parcial).
    timeScale.emitLogical({ from: 45.3, to: 199 });
    flushRaf();
    expect(harness.published.at(-1).manual).toBe(false);

    // La aplicación real del fit llega después: consume el objetivo.
    timeScale.emitLogical({ from: -0.5, to: 199.5 });
    flushRaf();
    expect(harness.published.at(-1).manual).toBe(false);
    expect(harness.published.at(-1).view.key).toBe("latest");

    // Un gesto POSTERIOR (sin objetivo pendiente) sí es desviación manual.
    timeScale.emitLogical({ from: 60, to: 140 });
    flushRaf();
    expect(harness.published.at(-1).manual).toBe(true);
  });

  it("varias emisiones consecutivas se agrupan en UNA publicación por RAF", () => {
    const harness = createHarness();
    const { timeScale } = attachFresh(harness);
    flushRaf();
    const before = harness.published.length;

    timeScale.emitLogical({ from: 50, to: 120 });
    timeScale.emitLogical({ from: 48, to: 118 });
    timeScale.emitLogical({ from: 46, to: 116 });
    flushRaf();

    expect(harness.published.length).toBe(before + 1);
    expect(harness.published.at(-1).visibleLogicalRange).toEqual({ from: 46, to: 116 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Persistencia de la desviación manual entre re-attaches (el contrato).

describe("viewport · la desviación manual es estado explícito", () => {
  it("un re-attach re-aplica la ventana manual mapeada por tiempo (no la pierde, no la inventa)", () => {
    const harness = createHarness();
    const first = attachFresh(harness);
    harness.lifecycle.actions.zoom(0.5); // ventana manual: últimas ~100 filas
    const manualBefore = first.timeScale._currentLogical();

    harness.lifecycle.detach();
    const second = attachFresh(harness);

    const logicalWrites = second.timeScale._log.writes.filter((w) => w.kind === "logical");
    expect(logicalWrites.length).toBeGreaterThanOrEqual(1);
    const applied = second.timeScale._currentLogical();
    expect(applied.from).toBeCloseTo(manualBefore.from, 0);
    expect(applied.to).toBeCloseTo(manualBefore.to, 0);

    flushRaf();
    expect(harness.published.at(-1).manual).toBe(true);
  });

  it("clearManual() antes del re-attach → el nuevo attach dibuja el rango entero", () => {
    const harness = createHarness();
    attachFresh(harness);
    harness.lifecycle.actions.zoom(0.5);
    harness.lifecycle.detach();

    harness.lifecycle.clearManual();
    const second = attachFresh(harness);

    expect(second.timeScale._currentLogical()).toEqual({ from: -0.5, to: 199.5 });
    flushRaf();
    expect(harness.published.at(-1).manual).toBe(false);
  });

  it("una ventana manual sin solape con los datos nuevos se descarta y se ajusta el rango entero", () => {
    const harness = createHarness();
    attachFresh(harness);
    harness.lifecycle.actions.zoom(0.5);
    harness.lifecycle.detach();

    // Datos nuevos MUY posteriores: la ventana manual guardada no solapa.
    harness.setRowTimes(makeRowTimes(100, { start: BASE_TIME + 5000 * TRADING_DAY }));
    const second = attachFresh(harness, { rowCount: 100 });

    expect(second.timeScale._currentLogical()).toEqual({ from: -0.5, to: 99.5 });
    flushRaf();
    expect(harness.published.at(-1).manual).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Liberación de listeners (fallo 3).

describe("viewport · liberación de listeners", () => {
  it("detach desuscribe el timeScale, quita el wheel y desconecta el ResizeObserver", () => {
    const harness = createHarness();
    const { timeScale, container } = attachFresh(harness);
    expect(timeScale._subCount()).toBe(1);
    expect(container._listeners.wheel.length).toBe(1);
    expect(container._resizeObserver?.target).toBe(container);

    harness.lifecycle.detach();

    expect(timeScale._subCount()).toBe(0);
    expect(container._listeners.wheel.length).toBe(0);
    expect(container._resizeObserver.target).toBe(null);
  });

  it("un attach nuevo libera automáticamente al anterior (nada se acumula)", () => {
    const harness = createHarness();
    const first = attachFresh(harness);
    const second = attachFresh(harness);

    expect(first.timeScale._subCount()).toBe(0);
    expect(first.container._listeners.wheel.length).toBe(0);
    expect(second.timeScale._subCount()).toBe(1);
    expect(second.container._listeners.wheel.length).toBe(1);
  });

  it("el release() devuelto por un attach viejo es no-op tras un attach nuevo", () => {
    const harness = createHarness();
    const first = attachFresh(harness);
    const second = attachFresh(harness);

    first.release();

    expect(second.timeScale._subCount()).toBe(1);
    expect(second.container._listeners.wheel.length).toBe(1);
    expect(harness.lifecycle._state.lifecycle).toBe("attached");
  });

  it("montaje/desmontaje repetido (StrictMode) no deja nada colgando", () => {
    const harness = createHarness();
    const first = attachFresh(harness);
    first.release();
    const second = attachFresh(harness);
    harness.lifecycle.unmount();

    expect(first.timeScale._subCount()).toBe(0);
    expect(second.timeScale._subCount()).toBe(0);
    expect(first.container._listeners.wheel.length).toBe(0);
    expect(second.container._listeners.wheel.length).toBe(0);
    expect(rafCallbacks.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Publicación (fallo 5).

describe("viewport · el canal de publicación no se auto-bloquea", () => {
  it("cada tanda de cambios publica tras su RAF, indefinidamente", () => {
    const harness = createHarness();
    const { timeScale } = attachFresh(harness);
    flushRaf();
    const base = harness.published.length;

    timeScale.emitLogical({ from: 10, to: 110 });
    flushRaf();
    expect(harness.published.length).toBe(base + 1);

    timeScale.emitLogical({ from: 20, to: 120 });
    flushRaf();
    expect(harness.published.length).toBe(base + 2);

    timeScale.emitLogical({ from: 30, to: 130 });
    flushRaf();
    expect(harness.published.length).toBe(base + 3);
  });

  it("unmount cancela la publicación pendiente", () => {
    const harness = createHarness();
    const { timeScale } = attachFresh(harness);
    flushRaf();
    const base = harness.published.length;

    timeScale.emitLogical({ from: 10, to: 110 });
    harness.lifecycle.unmount();
    flushRaf();

    expect(harness.published.length).toBe(base);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wheel.

describe("viewport · rueda", () => {
  it("ctrl+rueda con interacción idle zoomea sobre el timeScale vivo", () => {
    const harness = createHarness();
    const { timeScale, container } = attachFresh(harness);
    const before = timeScale._currentLogical();

    const event = new WheelEvent("wheel", { ctrlKey: true, deltaY: -200, cancelable: true });
    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    const after = timeScale._currentLogical();
    expect(after.to - after.from).toBeLessThan(before.to - before.from);
  });

  it("ctrl+rueda con interacción ≠ idle no escribe", () => {
    const harness = createHarness({ getInteractionState: () => "drawing" });
    const { timeScale, container } = attachFresh(harness);
    const before = timeScale._currentLogical();

    const event = new WheelEvent("wheel", { ctrlKey: true, deltaY: -200, cancelable: true });
    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(timeScale._currentLogical()).toEqual(before);
  });

  it("la rueda sin ctrl no toca el timeScale ni intercepta el evento (el scroll de página es del navegador)", () => {
    const harness = createHarness();
    const { timeScale, container } = attachFresh(harness);
    const before = timeScale._currentLogical();

    const event = new WheelEvent("wheel", { ctrlKey: false, deltaY: 120, cancelable: true });
    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(event._stopped).toBeUndefined();
    expect(timeScale._currentLogical()).toEqual(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Resize.

describe("viewport · resize re-aplica la ventana contractual", () => {
  it("sin desviación manual, un resize vuelve a ajustar el rango entero", () => {
    const harness = createHarness();
    const { timeScale, chart, container } = attachFresh(harness);
    const fitsBefore = timeScale._log.writes.filter((w) => w.kind === "fitContent").length;

    container._resizeObserver.trigger({ contentRect: { width: 1200, height: 600 } });

    const fitsAfter = timeScale._log.writes.filter((w) => w.kind === "fitContent").length;
    expect(fitsAfter).toBe(fitsBefore + 1);
    expect(chart._calls.options.some((o) => o && o.width === 1200)).toBe(true);
  });

  it("con desviación manual, un resize re-aplica la MISMA ventana manual", () => {
    const harness = createHarness();
    const { timeScale, container } = attachFresh(harness);
    harness.lifecycle.actions.zoom(0.5);
    const manual = timeScale._currentLogical();
    const fitsBefore = timeScale._log.writes.filter((w) => w.kind === "fitContent").length;

    container._resizeObserver.trigger({ contentRect: { width: 1200, height: 600 } });

    const fitsAfter = timeScale._log.writes.filter((w) => w.kind === "fitContent").length;
    expect(fitsAfter).toBe(fitsBefore);
    const applied = timeScale._currentLogical();
    expect(applied.from).toBeCloseTo(manual.from, 0);
    expect(applied.to).toBeCloseTo(manual.to, 0);
    flushRaf();
    expect(harness.published.at(-1).manual).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSnapshot.

describe("viewport · getSnapshot", () => {
  it("es solo lectura: no reconcilia ni pisa el estado desde el timeScale", () => {
    const harness = createHarness();
    const { timeScale } = attachFresh(harness);
    harness.lifecycle.actions.zoom(0.5);
    const afterZoom = harness.lifecycle.getSnapshot();
    expect(afterZoom.manual).toBe(true);

    // Cambio nativo sin pasar por derive: getSnapshot no debe absorberlo.
    timeScale.setVisibleLogicalRange({ from: 40, to: 140 });
    const snapshot = harness.lifecycle.getSnapshot();

    expect(snapshot.visibleLogicalRange).toEqual(afterZoom.visibleLogicalRange);
    expect(snapshot.manual).toBe(true);
    expect(snapshot.lifecycle).toBe("attached");
  });
});
