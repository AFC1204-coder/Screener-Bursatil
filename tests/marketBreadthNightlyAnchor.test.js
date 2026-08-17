// La amplitud del universo se mide sobre el nocturno ESTADOUNIDENSE.
//
// Filtraba por preset ("materialized-cache"), y ese preset lo escriben todos
// los crones: el europeo de las 23:00 y el japonés de las 22:42 también. A
// partir de esa hora, "el último escaneo nocturno" era un escaneo de 1 o 24
// filas y la amplitud del universo se calculaba sobre él — la misma raíz que
// dejaba el arranque de la pantalla principal enseñando una acción italiana.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = [];
let scansResponse = [];
let nightlyRows = [];

vi.mock("@/lib/supabaseServer", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    supabaseConfig: () => ({ configured: true, ownerId: "personal", url: "https://x.test", key: "k", missing: [] }),
    supabaseRequest: async (path, options) => {
      calls.push({ path, query: options?.query });
      if (path === "scans") return scansResponse;
      // Sin engine_version, la serie de participación se declara no disponible
      // y el test se queda con la población, que es lo que se está fijando.
      if (path === "rs_weekly_items") return [];
      return [];
    },
    supabaseRequestAll: async (path) => {
      calls.push({ path });
      return path === "scan_results" ? nightlyRows : [];
    },
    supabaseCount: async () => 0,
  };
});

const { readMarketBreadth } = await import("@/lib/marketBreadth");

const scan = (localId, id, createdAt, rowCount) => ({
  id,
  local_id: localId,
  created_at: createdAt,
  row_count: rowCount,
  preset: "materialized-cache",
  settings: { progress: { status: "partial" } },
});

const breadthRow = (symbol) => ({
  symbol,
  country: "US",
  stage: "stage2",
  priceAboveSlowMa: true,
  extSma50: 4,
  sma200Slope: 1,
  distance52w: -5,
  upDownVolRatio: 1.1,
  lastDate: "2026-08-15",
});

beforeEach(() => {
  calls.length = 0;
  scansResponse = [];
  nightlyRows = [];
});

describe("readMarketBreadth · población anclada al nocturno estadounidense", () => {
  it("pide el escaneo por prefijo de local_id, no solo por preset", async () => {
    scansResponse = [scan("materialized:US:2026-08-16:o0:l5609", "us-16", "2026-08-16T03:57:58.557Z", 3313)];
    nightlyRows = [breadthRow("AAA"), breadthRow("BBB")];

    await readMarketBreadth({ refresh: true });

    const query = decodeURIComponent(String(calls.find((call) => call.path === "scans")?.query || ""));
    expect(query).toContain("local_id=like.materialized:US:*");
    expect(query).toContain("deleted_at=is.null");
  });

  it("mide sobre las filas de ESE escaneo", async () => {
    scansResponse = [scan("materialized:US:2026-08-16:o0:l5609", "us-16b", "2026-08-16T03:57:58.557Z", 3313)];
    nightlyRows = [breadthRow("AAA"), breadthRow("BBB"), breadthRow("CCC")];

    const payload = await readMarketBreadth({ refresh: true });

    expect(payload.scan.id).toBe("us-16b");
    expect(payload.population).toBe(3);
    const rowsCall = calls.find((call) => call.path === "scan_results");
    expect(rowsCall).toBeTruthy();
  });

  it("sin nocturno estadounidense declara la ausencia con su motivo, no mide otro mercado", async () => {
    // El cron italiano existe y es el más reciente, pero no casa con el `like`:
    // PostgREST no lo devuelve, y aquí eso es exactamente "no hay nocturno".
    scansResponse = [];

    const payload = await readMarketBreadth({ refresh: true });

    expect(payload.configured).toBe(true);
    expect(payload.error).toContain("escaneo nocturno de Estados Unidos");
    expect(payload.nightly).toMatchObject({ found: false, reason: "no-nightly-scan" });
    expect(calls.filter((call) => call.path === "scan_results")).toHaveLength(0);
  });

  it("un nocturno que no terminó bien no se mide", async () => {
    scansResponse = [{ ...scan("materialized:US:2026-08-16:o0:l5609", "us-fail", "2026-08-16T03:57:58.557Z", 3313), settings: { progress: { status: "failed" } } }];

    const payload = await readMarketBreadth({ refresh: true });

    expect(payload.nightly).toMatchObject({ found: false, reason: "nightly-not-publishable" });
    expect(calls.filter((call) => call.path === "scan_results")).toHaveLength(0);
  });
});
