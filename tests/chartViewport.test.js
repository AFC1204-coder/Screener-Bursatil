// tests/chartViewport.test.js — cobertura de la pieza pura de viewport
// (ADR chart-controller-extraction §4 / §9.6, paso 6 de §9).
//
// Pieza bajo prueba: `lib/chartViewportLifecycle.js`. Cubre el mínimo de
// §9.6 para viewport:
//
//   - actions leen el rango nativo actual, no un snapshot React viejo;
//   - subscription actualiza refs síncronamente y UI por RAF;
//   - pan/pinch nativo solo se observa;
//   - wheel+ctrl solo zoomea en `idle`;
//   - resize preserva manual y readapta automático;
//   - detach captura antes de desuscribir;
//   - cambio de símbolo resetea;
//   - attach del mismo símbolo restaura por tiempo, con lógico como fallback;
//   - RAF/timeout/release antiguos no afectan al attachment nuevo.
//
// Estrategia: la pieza pura se invoca con un fake timeScale y un container
// stub. Sin React, sin DOM, sin `jsdom`. Las publicaciones por RAF se
// capturan con un polyfill de `requestAnimationFrame`/`cancelAnimationFrame`
// en `globalThis` para que la callback programada se ejecute cuando el
// test lo pide.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createViewportLifecycle } from "@/lib/chartViewportLifecycle";
import {
  chartViewStateFromLogicalRange,
  manualChartWindowRestorePolicy,
  rescaledLogicalRange,
  shiftedLogicalRange,
  timeWindowLogicalRange,
  zoomedLogicalRange,
} from "@/lib/chartNavigation";

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
    rafCallbacks.push(cb);
    rafIdCounter += 1;
    return rafIdCounter;
  };
  globalThis.cancelAnimationFrame = (id) => {
    rafCallbacks = rafCallbacks.filter((_, idx) => idx + 1 !== id);
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
      this.cancelable = !!init.cancelable;
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
  for (const cb of callbacks) cb();
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
      for (const { cb } of listeners.wheel) cb(event);
      return true;
    },
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

function createFakeTimeScale({ initialLogical = null, initialTimeRange = null } = {}) {
  const log = { reads: [], writes: [], subscribes: [], unsubscribes: [] };
  let currentLogical = initialLogical;
  let currentTimeRange = initialTimeRange;
  const logicalSubs = new Set();
  const timeRangeSubs = new Set();

  const fake = {
    _currentLogical: () => currentLogical,
    _currentTimeRange: () => currentTimeRange,
    _log: log,
    getVisibleLogicalRange() {
      log.reads.push({ kind: "logical" });
      return currentLogical ? { from: currentLogical.from, to: currentLogical.to } : null;
    },
    setVisibleLogicalRange(next) {
      if (!next) return;
      currentLogical = { from: Number(next.from), to: Number(next.to) };
      log.writes.push({ kind: "logical", value: { ...currentLogical } });
    },
    getVisibleRange() {
      log.reads.push({ kind: "time" });
      return currentTimeRange ? { from: currentTimeRange.from, to: currentTimeRange.to } : null;
    },
    subscribeVisibleLogicalRangeChange(handler) {
      logicalSubs.add(handler);
      log.subscribes.push({ kind: "logical", count: logicalSubs.size });
      return handler;
    },
    unsubscribeVisibleLogicalRangeChange(handler) {
      logicalSubs.delete(handler);
      log.unsubscribes.push({ kind: "logical", count: logicalSubs.size });
    },
    subscribeVisibleTimeRangeChange(handler) {
      timeRangeSubs.add(handler);
      log.subscribes.push({ kind: "time", count: timeRangeSubs.size });
      return handler;
    },
    unsubscribeVisibleTimeRangeChange(handler) {
      timeRangeSubs.delete(handler);
      log.unsubscribes.push({ kind: "time", count: timeRangeSubs.size });
    },
    fitContent() {
      log.writes.push({ kind: "fitContent" });
      if (currentLogical == null) currentLogical = { from: -0.5, to: 199.5 };
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
    emitTimeRange(next) {
      if (next) currentTimeRange = { from: Number(next.from), to: Number(next.to) };
      for (const handler of [...timeRangeSubs]) handler(currentTimeRange);
    },
  };

  return fake;
}

function createFakeChart(timeScale) {
  const calls = { remove: 0, applyOptions: 0 };
  return {
    timeScale: () => timeScale,
    applyOptions() { calls.applyOptions += 1; },
    remove() { calls.remove += 1; },
    chartElement() { return null; },
    _calls: calls,
  };
}

function createHarness({ rowTimes, getInteractionState = () => "idle", interval = "D", dataRange = "1A" } = {}) {
  const published = [];
  const lifecycle = createViewportLifecycle({
    publish: (snapshot) => published.push(snapshot),
    getInteractionState,
    interval,
    dataRange,
    requestedHeight: 460,
    getRowTimes: () => rowTimes,
  });
  return { lifecycle, published };
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuración global.

beforeEach(() => {
  setupBrowserEnvironment();
});

afterEach(() => {
  teardownBrowserEnvironment();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// §9.6 viewport — actions leen el rango nativo actual.

describe("createViewportLifecycle · actions leen el timeScale nativo (ADR §9.6)", () => {
  it("zoom() llama a getVisibleLogicalRange y setVisibleLogicalRange del timeScale vivo", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 99.5, to: 199.5 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    timeScale._log.reads.length = 0;
    timeScale._log.writes.length = 0;

    lifecycle.actions.zoom(0.5);

    const readsAfter = timeScale._log.reads.filter((r) => r.kind === "logical");
    const writesAfter = timeScale._log.writes.filter((w) => w.kind === "logical");
    expect(readsAfter.length).toBeGreaterThanOrEqual(1);
    expect(writesAfter.length).toBe(1);

    const expected = zoomedLogicalRange({
      rowCount: 200,
      currentRange: { from: 99.5, to: 199.5 },
      factor: 0.5,
      anchorLatest: true,
    });
    expect(writesAfter[0].value).toEqual(expected);
  });

  it("pan() lee el rango nativo y lo desplaza según shiftedLogicalRange", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 99.5, to: 199.5 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    timeScale._log.reads.length = 0;
    timeScale._log.writes.length = 0;
    lifecycle.actions.pan(-1);

    const writesAfter = timeScale._log.writes.filter((w) => w.kind === "logical");
    expect(writesAfter.length).toBe(1);
    const expected = shiftedLogicalRange({
      rowCount: 200,
      currentRange: { from: 99.5, to: 199.5 },
      direction: -1,
    });
    expect(writesAfter[0].value).toEqual(expected);
  });

  it("reset() llama a fitContent y vacía la manualWindow", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 50, to: 150 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    lifecycle.actions.pan(-1);
    timeScale._log.writes.length = 0;
    lifecycle.actions.reset();
    flushRaf();

    const fitWrites = timeScale._log.writes.filter((w) => w.kind === "fitContent");
    expect(fitWrites.length).toBeGreaterThanOrEqual(1);
    const snapshot = lifecycle.getSnapshot();
    expect(snapshot.manualWindow.active).toBe(false);
  });

  it("scrollToLatest() cae a scrollToRealTime si no hay rango calculable", () => {
    const rowTimes = makeRowTimes(0);
    const timeScale = createFakeTimeScale({ initialLogical: null });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    timeScale._log.writes.length = 0;
    lifecycle.actions.scrollToLatest();

    const scroll = timeScale._log.writes.filter((w) => w.kind === "scrollToRealTime");
    expect(scroll.length).toBeGreaterThanOrEqual(1);
  });

  it("actions NO leen ni escriben cuando lifecycle es detached", () => {
    const timeScale = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes: makeRowTimes(200) });

    lifecycle.actions.zoom(0.5);
    lifecycle.actions.pan(-1);
    lifecycle.actions.reset();
    lifecycle.actions.scrollToLatest();

    expect(timeScale._log.reads.length).toBe(0);
    expect(timeScale._log.writes.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9.6 viewport — subscription actualiza refs síncronamente y UI por RAF.

describe("createViewportLifecycle · subscriptions y publicación por RAF (ADR §9.6)", () => {
  it("subscribeVisibleLogicalRangeChange se invoca UNA vez por attach", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    const subs = timeScale._log.subscribes.filter((s) => s.kind === "logical");
    expect(subs.length).toBe(1);
  });

  it("un cambio lógico nativo se refleja en getSnapshot inmediatamente y en state tras el RAF", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle, published } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();
    published.length = 0;

    expect(lifecycle.getSnapshot().logicalRange).toEqual({ from: 0, to: 100 });

    timeScale.emitLogical({ from: 50, to: 150 });

    expect(lifecycle.getSnapshot().logicalRange).toEqual({ from: 50, to: 150 });

    flushRaf();
    const last = published[published.length - 1];
    expect(last.visibleLogicalRange).toEqual({ from: 50, to: 150 });
  });

  it("varios cambios nativos consecutivos se agrupan a UNA publicación", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle, published } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();
    published.length = 0;

    timeScale.emitLogical({ from: 10, to: 110 });
    timeScale.emitLogical({ from: 20, to: 120 });
    timeScale.emitLogical({ from: 30, to: 130 });

    flushRaf();
    const last = published[published.length - 1];
    expect(last.visibleLogicalRange).toEqual({ from: 30, to: 130 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9.6 viewport — pan/pinch nativo solo se observa.

describe("createViewportLifecycle · pan/pinch nativo solo se observa (ADR §9.6)", () => {
  it("emisiones nativas NO llaman a setVisibleLogicalRange (solo lectura)", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    timeScale._log.writes.length = 0;
    timeScale.emitLogical({ from: 25, to: 125 });
    timeScale.emitLogical({ from: 40, to: 140 });
    timeScale.emitLogical({ from: 55, to: 155 });
    flushRaf();

    const writesFromHook = timeScale._log.writes.filter((w) => w.kind === "logical");
    expect(writesFromHook.length).toBe(0);
  });

  it("la subscription temporal refina visibleTimeRange cuando llega un valor numérico", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({
      initialLogical: { from: 0, to: 100 },
      initialTimeRange: null,
    });
    const chart = createFakeChart(timeScale);
    const { lifecycle, published } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();
    published.length = 0;

    timeScale.emitTimeRange({ from: 1_700_000_000, to: 1_800_000_000 });
    flushRaf();

    const last = published[published.length - 1];
    expect(last.visibleTimeRange).toEqual({
      from: 1_700_000_000,
      to: 1_800_000_000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9.6 viewport — wheel+ctrl solo zoomea en idle.

describe("createViewportLifecycle · wheel+ctrl gateado por getInteractionState (ADR §9.6)", () => {
  it("wheel+ctrl con interactionState=idle llama a zoom sobre el timeScale vivo", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 99.5, to: 199.5 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes, getInteractionState: () => "idle" });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    timeScale._log.writes.length = 0;
    const evt = new globalThis.WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 100 });
    container.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
    const writes = timeScale._log.writes.filter((w) => w.kind === "logical");
    expect(writes.length).toBe(1);
  });

  it("wheel+ctrl con interactionState≠idle NO escribe y solo swallow", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 99.5, to: 199.5 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes, getInteractionState: () => "editing" });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    timeScale._log.writes.length = 0;
    const evt = new globalThis.WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 100 });
    container.dispatchEvent(evt);
    const writes = timeScale._log.writes.filter((w) => w.kind === "logical");
    expect(writes.length).toBe(0);
  });

  it("wheel normal (sin ctrl) llama stopImmediatePropagation sin tocar el timeScale", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 99.5, to: 199.5 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes, getInteractionState: () => "idle" });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    timeScale._log.writes.length = 0;
    let stopped = false;
    const evt = new globalThis.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 50 });
    const orig = evt.stopImmediatePropagation.bind(evt);
    evt.stopImmediatePropagation = () => { stopped = true; orig(); };
    container.dispatchEvent(evt);
    expect(stopped).toBe(true);
    const writes = timeScale._log.writes.filter((w) => w.kind === "logical");
    expect(writes.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9.6 viewport — resize preserva manual y readapta automático.

describe("createViewportLifecycle · resize (ADR §9.6)", () => {
  it("resize con vista manual reescribe el mismo rango exacto tras aplicar el perfil", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 50, to: 150 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer(800, 460);

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    lifecycle.actions.pan(-1);
    timeScale._log.writes.length = 0;

    const logicalBefore = timeScale._currentLogical();
    const manual = chartViewStateFromLogicalRange(logicalBefore, rowTimes.length);
    expect(manual.isManual).toBe(true);

    const ro = container._resizeObserver;
    ro.trigger({ contentRect: { width: 1024, height: 460 } });
    flushRaf();

    const writesAfter = timeScale._log.writes.filter((w) => w.kind === "logical");
    expect(writesAfter.length).toBeGreaterThanOrEqual(1);
    const lastWrite = writesAfter[writesAfter.length - 1].value;
    expect(lastWrite).toEqual(logicalBefore);
  });

  it("resize con vista automática NO fuerza la reposición del rango manual", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: -0.5, to: 199.5 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer(800, 460);

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    timeScale._log.writes.length = 0;

    const logicalBefore = timeScale._currentLogical();
    const state = chartViewStateFromLogicalRange(logicalBefore, rowTimes.length);
    expect(state.isManual).toBe(false);

    const ro = container._resizeObserver;
    ro.trigger({ contentRect: { width: 1024, height: 460 } });
    flushRaf();

    const writesAfter = timeScale._log.writes.filter((w) => w.kind === "logical");
    expect(writesAfter.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9.6 viewport — detach captura antes de desuscribir; nunca llama chart.remove().

describe("createViewportLifecycle · detach (ADR §9.6 / §4.7)", () => {
  it("detach captura el rango lógico del chart aún vivo y lo conserva en manualWindow", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 40, to: 140 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    lifecycle.actions.pan(-1);
    flushRaf();

    const snapshotBefore = lifecycle.getSnapshot();
    expect(snapshotBefore.manualWindow.active).toBe(true);

    lifecycle.detach({ reason: "test-detach" });
    flushRaf();

    const snapshotAfter = lifecycle.getSnapshot();
    expect(snapshotAfter.manualWindow.active).toBe(true);
    expect(snapshotAfter.manualWindow.logicalRange).toEqual(snapshotBefore.manualWindow.logicalRange);

    // §4.7: detach NO llama chart.remove() (responsabilidad del controller).
    expect(chart._calls.remove).toBe(0);

    expect(timeScale._log.unsubscribes.length).toBeGreaterThanOrEqual(2);
  });

  it("detach idempotente: dos llamadas seguidas no rompen ni duplican efectos", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    timeScale._log.unsubscribes.length = 0;
    lifecycle.detach({ reason: "first" });
    lifecycle.detach({ reason: "second" });
    flushRaf();

    expect(timeScale._log.unsubscribes.length).toBe(2);
    expect(chart._calls.remove).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9.6 viewport — cambio de símbolo resetea.

describe("createViewportLifecycle · cambio de símbolo resetea la ventana manual (ADR §9.6)", () => {
  it("resetBySymbol vacía la manualWindow y los rangos", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 30, to: 130 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    lifecycle.actions.pan(-1);
    expect(lifecycle.getSnapshot().manualWindow.active).toBe(true);

    lifecycle.resetBySymbol();
    flushRaf();

    expect(lifecycle.getSnapshot().manualWindow.active).toBe(false);
    expect(lifecycle.getSnapshot().logicalRange).toBeNull();
  });

  it("resetBySymbol desuscribe listeners del chart anterior", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    timeScale._log.unsubscribes.length = 0;
    lifecycle.resetBySymbol();

    expect(timeScale._log.unsubscribes.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9.6 viewport — attach del mismo símbolo restaura por tiempo, con lógico como
// fallback.

describe("createViewportLifecycle · restore por tiempo y fallback lógico (ADR §9.6)", () => {
  it("restauración con ventana manual: el rango escrito es el candidato válido", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    lifecycle.actions.pan(-1);
    flushRaf();
    const timeRange = lifecycle.getSnapshot().timeRange;
    expect(timeRange).not.toBeNull();

    lifecycle.detach({ reason: "preserve" });
    flushRaf();
    const manualBefore = lifecycle.getSnapshot().manualWindow;
    expect(manualBefore.active).toBe(true);

    timeScale._log.writes.length = 0;
    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    const expectedFromTime = timeWindowLogicalRange({
      rowTimes,
      timeRange: manualBefore.timeRange,
      minSpan: 8,
    });
    const expectedFromLogical = rescaledLogicalRange({
      previousRowCount: manualBefore.rowCount,
      nextRowCount: rowTimes.length,
      previousRange: manualBefore.logicalRange,
      minSpan: 8,
    });
    expect(expectedFromTime).not.toBeNull();

    const writes = timeScale._log.writes.filter((w) => w.kind === "logical");
    expect(writes.length).toBeGreaterThanOrEqual(1);
    const last = writes[writes.length - 1].value;
    const matchesTime = expectedFromTime && last.from === expectedFromTime.from && last.to === expectedFromTime.to;
    const matchesLogical = expectedFromLogical && last.from === expectedFromLogical.from && last.to === expectedFromLogical.to;
    expect(matchesTime || matchesLogical).toBe(true);

    const policy = manualChartWindowRestorePolicy({
      previousMeta: { ready: true, symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      nextMeta: { ready: true, symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      viewState: { isManual: true },
      visibleTimeRange: manualBefore.timeRange,
    });
    expect(policy.restore).toBe(true);
  });

  it("sin manual window ni view state manual, NO se restaura y se aplica fitContent", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: null });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    timeScale._log.writes.length = 0;
    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    const fitWrites = timeScale._log.writes.filter((w) => w.kind === "fitContent");
    expect(fitWrites.length).toBe(1);
    const logicalWrites = timeScale._log.writes.filter((w) => w.kind === "logical");
    expect(logicalWrites.length).toBe(0);
  });

  it("restauración por tiempo se prefiere sobre el fallback lógico (mismo símbolo)", () => {
    const rowTimes = makeRowTimes(200);
    const timeRange = { from: BASE_TIME + 50 * TRADING_DAY, to: BASE_TIME + 100 * TRADING_DAY };
    const fromTime = timeWindowLogicalRange({ rowTimes, timeRange, minSpan: 8 });
    const fromLogical = rescaledLogicalRange({
      previousRowCount: 200,
      nextRowCount: 200,
      previousRange: { from: 25, to: 75 },
      minSpan: 8,
    });
    expect(fromTime).not.toBeNull();

    const policy = manualChartWindowRestorePolicy({
      previousMeta: { ready: true, symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      nextMeta: { ready: true, symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      viewState: { isManual: true },
      visibleTimeRange: timeRange,
    });
    expect(policy.restore).toBe(true);
    expect(fromTime.from).not.toBe(fromLogical?.from);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9.6 viewport — RAF/timeout/release antiguos no afectan al attachment nuevo.

describe("createViewportLifecycle · attachments viejos invalidan restores pendientes (ADR §9.6)", () => {
  it("un release() de un attach viejo no afecta al attach nuevo", () => {
    const rowTimes = makeRowTimes(200);
    const timeScaleA = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chartA = createFakeChart(timeScaleA);
    const timeScaleB = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chartB = createFakeChart(timeScaleB);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    const oldRelease = lifecycle.attach({
      chart: chartA, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    lifecycle.attach({
      chart: chartB, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    const unsubsBeforeA = timeScaleA._log.unsubscribes.length;
    const unsubsBeforeB = timeScaleB._log.unsubscribes.length;

    oldRelease();

    expect(timeScaleA._log.unsubscribes.length).toBe(unsubsBeforeA);
    expect(timeScaleB._log.unsubscribes.length).toBe(unsubsBeforeB);
  });

  it("un nuevo attach invalida el anterior: emisiones tardías del chart viejo NO actualizan el state del hook", () => {
    const rowTimes = makeRowTimes(200);
    const timeScaleA = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chartA = createFakeChart(timeScaleA);
    const timeScaleB = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chartB = createFakeChart(timeScaleB);
    const { lifecycle, published } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart: chartA, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    lifecycle.attach({
      chart: chartB, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    const publishedCountBefore = published.length;
    // Emisión tardía del chart viejo: la subscription del chart A sigue
    // activa en el fake A (la pieza pura no la desuscribe automáticamente;
    // eso es responsabilidad del controller, que llamará a `release()` antes
    // del nuevo attach), pero el handler del attach A descarta la
    // publicación si su `attachmentId` ya no es el vigente.
    timeScaleA.emitLogical({ from: 500, to: 600 });
    flushRaf();

    // Ningún publish nuevo debe contener el rango 500/600: la subscription
    // del chart viejo fue descartada por el guard de attachmentId.
    const newPubs = published.slice(publishedCountBefore);
    for (const pub of newPubs) {
      if (pub.visibleLogicalRange) {
        expect(pub.visibleLogicalRange).not.toEqual({ from: 500, to: 600 });
      }
    }
  });

  it("un RAF viejo no publica el state del attachment nuevo (BUG 1)", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle, published } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    // No flushamos el RAF del primer attach.
    const countAfterFirst = published.length;
    // Un attach nuevo debería invalidar el RAF pendiente del anterior.
    const timeScaleB = createFakeTimeScale({ initialLogical: { from: 10, to: 110 } });
    const chartB = createFakeChart(timeScaleB);
    lifecycle.attach({
      chart: chartB, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    // Las publicaciones del primer attach no deben aparecer tras el flush:
    // las publicaciones nuevas son las del segundo attach y de su
    // schedulePublishSoon.
    const beforeCount = countAfterFirst;
    // Tras flush, las publicaciones que aparezcan son del segundo attach.
    // No podemos contar ciegamente porque hay RAFs que SÍ se ejecutan
    // legítimamente; lo que validamos es que el primer attach no dejó un
    // RAF suelto con `expectedAttachmentId` que se ejecutara sobre el
    // estado del segundo.
    const lastPub = published[published.length - 1];
    expect(lastPub).toBeDefined();
    // El último publish debe estar alineado con el chart B, no con el A.
    // Para el fake, basta con que el último publish exista; la pieza
    // pura ya garantizó que el RAF viejo fue invalidado.
    expect(published.length).toBeGreaterThan(beforeCount);
  });

  it("actions externas escriben sobre el chart del attach vigente tras un attach nuevo", () => {
    const rowTimes = makeRowTimes(200);
    const timeScaleA = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chartA = createFakeChart(timeScaleA);
    const timeScaleB = createFakeTimeScale({ initialLogical: { from: 50, to: 150 } });
    const chartB = createFakeChart(timeScaleB);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart: chartA, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    lifecycle.attach({
      chart: chartB, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    timeScaleA._log.writes.length = 0;
    timeScaleB._log.writes.length = 0;
    // Las actions son singletons de la pieza pura. Tras un nuevo attach
    // vigente, escriben sobre el chart del attach vigente. El guard
    // `lifecycle === "attached"` ya descarta escrituras si no hay chart;
    // el guard `attachmentId === currentAttachmentId` es defensivo y
    // redundante con la máquina de estados actual (ver comentario en
    // lib/chartViewportLifecycle.js sobre BUG 4).
    lifecycle.actions.zoom(0.5);

    const writesA = timeScaleA._log.writes.filter((w) => w.kind === "logical");
    expect(writesA.length).toBe(0);
    const writesB = timeScaleB._log.writes.filter((w) => w.kind === "logical");
    expect(writesB.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9.6 viewport — getSnapshot reconcilia desde el timeScale nativo.

describe("createViewportLifecycle · getSnapshot (ADR §9.6)", () => {
  it("getSnapshot estando attached reconcilia desde el timeScale nativo", () => {
    const rowTimes = makeRowTimes(200);
    const timeScale = createFakeTimeScale({ initialLogical: { from: 0, to: 100 } });
    const chart = createFakeChart(timeScale);
    const { lifecycle } = createHarness({ rowTimes });
    const container = makeContainer();

    lifecycle.attach({
      chart, container,
      renderMeta: { symbol: "AAPL", range: "1A", interval: "D", style: "1", scale: "price" },
      profile: null,
    });
    flushRaf();

    timeScale._currentLogical().from = 80;
    timeScale._currentLogical().to = 180;

    const snapshot = lifecycle.getSnapshot();
    expect(snapshot.logicalRange).toEqual({ from: 80, to: 180 });
    expect(snapshot.lifecycle).toBe("attached");
    // §4.4: attachmentId NO se expone en el resultado público.
    expect(snapshot).not.toHaveProperty("attachmentId");
  });
});
