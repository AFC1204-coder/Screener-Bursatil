import { describe, expect, it } from "vitest";
import {
  STARTUP_CACHE_MAX_AGE_MS,
  createMemoryStore,
  identityOf,
  isCacheablePayload,
  probeUrlFor,
  resolveStartupScan,
  saveStartupScan,
} from "../lib/startupScanCache.js";

const URL_CORE = "/api/scans?includeRows=1&limit=1&rowsLimit=6000&anchor=nightly-us&hydrateRs=0";

function payload({ id = "materialized:US:2026-11-08:t040125", updatedAt = "2026-11-08T04:01:25.732Z", rows = 3, available = rows } = {}) {
  return {
    ok: true,
    configured: true,
    scans: [{ id, updatedAt, rowsAvailable: available, rowsReturned: rows, rows: Array.from({ length: rows }, (_, i) => ({ symbol: `S${i}`, rsRating: 50 + i })) }],
  };
}

function probeOf(data) {
  const scan = data.scans[0];
  return { ok: true, configured: true, data: { ok: true, configured: true, scans: [{ id: scan.id, updatedAt: scan.updatedAt, rowsAvailable: scan.rowsAvailable, rowsReturned: 0 }] } };
}

function harness({ stored, store = createMemoryStore(), fresh = payload(), probe, now = () => 1_000_000 } = {}) {
  const calls = { full: 0, probe: 0, events: [] };
  const deps = {
    url: URL_CORE,
    store,
    now,
    defer: (fn) => fn(),
    onEvent: (e) => calls.events.push(e),
    fetchFull: async () => { calls.full += 1; return { ok: true, configured: true, message: "", data: fresh }; },
    fetchProbe: async () => { calls.probe += 1; return probe ? probe() : probeOf(fresh); },
  };
  return { deps, calls, store, stored };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("startupScanCache: funciones puras", () => {
  it("probeUrlFor quita las filas y conserva ancla y mercados", () => {
    const probe = probeUrlFor("/api/scans?includeRows=1&limit=1&rowsLimit=6000&anchor=markets&hydrateRs=0&markets=HK");
    expect(probe).toContain("includeRows=0");
    expect(probe).not.toContain("rowsLimit");
    expect(probe).toContain("anchor=markets");
    expect(probe).toContain("markets=HK");
    expect(probe).toContain("limit=1");
  });

  it("identityOf es igual para la sonda y para el payload completo", () => {
    const full = payload();
    expect(identityOf(full)).toBe(identityOf(probeOf(full).data));
    expect(identityOf({})).toBeNull();
    expect(identityOf({ scans: [] })).toBeNull();
  });

  it("isCacheablePayload rechaza errores, vacíos y no configurados", () => {
    expect(isCacheablePayload(payload())).toBe(true);
    expect(isCacheablePayload(payload({ rows: 0 }))).toBe(false);
    expect(isCacheablePayload({ ...payload(), configured: false })).toBe(false);
    expect(isCacheablePayload({ ...payload(), error: "x" })).toBe(false);
    expect(isCacheablePayload(null)).toBe(false);
  });
});

describe("startupScanCache: resolveStartupScan", () => {
  it("primera apertura: descarga y guarda; la segunda sirve de caché sin descargar", async () => {
    const h = harness();
    const first = await resolveStartupScan(h.deps);
    await settle();
    expect(first.fromCache).toBeUndefined();
    expect(h.calls.full).toBe(1);
    expect(h.calls.probe).toBe(0);

    const second = await resolveStartupScan(h.deps);
    expect(second.fromCache).toBe(true);
    expect(h.calls.full).toBe(1);
    expect(h.calls.probe).toBe(1);
    expect(second.data).toEqual(h.deps.store ? payload() : null);
    expect(second).toMatchObject({ ok: true, configured: true, message: "" });
  });

  it("escaneo nuevo en el servidor (identidad distinta): descarga y reemplaza", async () => {
    const store = createMemoryStore();
    const old = harness({ store, fresh: payload({ id: "materialized:US:2026-11-07:t040000" }) });
    await resolveStartupScan(old.deps);
    await settle();

    const next = harness({ store, fresh: payload({ id: "materialized:US:2026-11-08:t040125" }) });
    const result = await resolveStartupScan(next.deps);
    await settle();
    expect(result.fromCache).toBeUndefined();
    expect(result.data.scans[0].id).toBe("materialized:US:2026-11-08:t040125");
    expect(next.calls.events.at(-1)).toMatchObject({ type: "miss", reason: "identidad-distinta" });

    const again = await resolveStartupScan(next.deps);
    expect(again.fromCache).toBe(true);
    expect(again.data.scans[0].id).toBe("materialized:US:2026-11-08:t040125");
  });

  it("mismo id pero updatedAt o nº de filas distintos: no sirve la copia", async () => {
    for (const variant of [{ updatedAt: "2026-11-08T05:00:00.000Z" }, { rows: 3, available: 5 }]) {
      const store = createMemoryStore();
      await resolveStartupScan(harness({ store }).deps);
      await settle();
      const h = harness({ store, fresh: payload(variant) });
      const result = await resolveStartupScan(h.deps);
      expect(result.fromCache).toBeUndefined();
      expect(h.calls.full).toBe(1);
    }
  });

  it("copia más antigua que el máximo: no se usa ni se sondea", async () => {
    const store = createMemoryStore();
    let clock = 1_000_000;
    const h = harness({ store, now: () => clock });
    await resolveStartupScan(h.deps);
    await settle();
    clock += STARTUP_CACHE_MAX_AGE_MS + 1;
    const result = await resolveStartupScan(h.deps);
    expect(result.fromCache).toBeUndefined();
    expect(h.calls.probe).toBe(0);
    expect(h.calls.events.at(-1)).toMatchObject({ reason: "caducada" });
  });

  it("si la sonda falla, descarga como siempre (nunca sirve sin validar)", async () => {
    const store = createMemoryStore();
    await resolveStartupScan(harness({ store }).deps);
    await settle();
    const h = harness({ store, probe: () => ({ ok: false, message: "HTTP 502", data: null }) });
    const result = await resolveStartupScan(h.deps);
    expect(result.fromCache).toBeUndefined();
    expect(h.calls.full).toBe(1);
    expect(h.calls.events.at(-1)).toMatchObject({ reason: "sonda-fallo" });

    const thrower = harness({ store, probe: () => { throw new Error("red"); } });
    expect((await resolveStartupScan(thrower.deps)).fromCache).toBeUndefined();
  });

  it("copia corrupta o con identidad alterada: se borra y se descarga", async () => {
    const store = createMemoryStore();
    await resolveStartupScan(harness({ store }).deps);
    await settle();
    await store.put({ key: URL_CORE + "#text", text: "{no es json" });
    const h = harness({ store });
    const result = await resolveStartupScan(h.deps);
    await settle();
    expect(result.fromCache).toBeUndefined();
    expect(h.calls.events.at(-1)).toMatchObject({ reason: "corrupta" });
    // y la descarga volvió a dejar una copia sana
    expect((await resolveStartupScan(harness({ store }).deps)).fromCache).toBe(true);
  });

  it("sin almacén (IndexedDB no disponible): descarga directa", async () => {
    const h = harness({ store: null });
    const result = await resolveStartupScan(h.deps);
    expect(result.ok).toBe(true);
    expect(h.calls.full).toBe(1);
    expect(h.calls.probe).toBe(0);
  });

  it("un arranque fallido o vacío no se guarda", async () => {
    const store = createMemoryStore();
    const h = harness({ store, fresh: payload({ rows: 0 }) });
    await resolveStartupScan(h.deps);
    await settle();
    expect(await store.keys()).toEqual([]);
  });

  it("un almacén que falla al leer no rompe el arranque", async () => {
    const broken = { get: async () => { throw new Error("idb"); }, put: async () => false, remove: async () => false, keys: async () => [] };
    const h = harness({ store: broken });
    const result = await resolveStartupScan(h.deps);
    expect(result.ok).toBe(true);
    expect(h.calls.full).toBe(1);
  });
});

describe("startupScanCache: guardado", () => {
  it("poda las entradas más antiguas por encima del máximo", async () => {
    const store = createMemoryStore();
    let t = 1;
    for (const market of ["A", "B", "C", "D", "E", "F"]) {
      await saveStartupScan(store, `/api/scans?markets=${market}`, payload({ id: `scan-${market}` }), { now: () => t++, maxEntries: 4 });
    }
    const metas = (await store.keys()).filter((k) => k.endsWith("#meta"));
    expect(metas).toHaveLength(4);
    expect(metas.some((k) => k.endsWith("=A#meta"))).toBe(false);
    expect(metas.some((k) => k.endsWith("=F#meta"))).toBe(true);
    expect((await store.keys()).filter((k) => k.endsWith("#text"))).toHaveLength(4);
  });

  it("si falla escribir la meta, no deja el texto huérfano", async () => {
    const base = createMemoryStore();
    const store = { ...base, put: async (record) => (record.key.endsWith("#meta") ? false : base.put(record)) };
    expect(await saveStartupScan(store, URL_CORE, payload())).toBe(false);
    expect(await base.keys()).toEqual([]);
  });
});
