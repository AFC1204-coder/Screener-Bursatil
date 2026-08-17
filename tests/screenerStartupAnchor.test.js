// El arranque de la pantalla principal pide UN escaneo concreto: el último
// nocturno estadounidense. No "el más reciente".
//
// Medido en producción el 16 de agosto de 2026 (los tres son del mismo día):
//
//   materialized:IT-ES:2026-08-16   1 fila      23:00
//   materialized:JP:2026-08-16      24 filas    22:42
//   materialized:US:2026-08-16      3313 filas  03:57
//
// El cron europeo corre DESPUÉS del nocturno, así que "el más reciente"
// significaba abrir el screener y ver una acción italiana. Y sin botón de
// ejecutar, "Reset sesión" volvía a cargar exactamente lo mismo.
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseRequest = vi.fn();

vi.mock("@/lib/supabaseServer", () => ({
  supabaseRequest,
  supabaseRpc: vi.fn(async () => []),
  supabaseConfig: () => ({ url: "https://example.supabase.co", key: "k", ownerId: "personal", configured: true, missing: [] }),
  requirePersistenceAuth: () => null,
  disabledPayload: () => ({ configured: false, skipped: true, missing: [], message: "Supabase no configurado" }),
  finiteOrNull: (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
  textOrNull: (value) => {
    const text = String(value || "").trim();
    return text || null;
  },
  toTimestamp: (value) => (value ? new Date(value).toISOString() : new Date().toISOString()),
}));

const { GET } = await import("@/app/api/scans/route");
const { clearScansApiCache } = await import("@/lib/scansApiCache");
const { NIGHTLY_US_ANCHOR } = await import("@/lib/scanLocalId");

function scanRow(localId, rowCount, createdAt, status = "partial") {
  return {
    id: `id-${localId}`,
    local_id: localId,
    name: `Materialized scan ${localId}`,
    preset: "materialized-cache",
    settings: { progress: { status } },
    market_score: null,
    market_regime: null,
    row_count: rowCount,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null,
  };
}

const NIGHTLY_US = scanRow("materialized:US:2026-08-16:o0:l5609", 3313, "2026-08-16T03:57:58.557Z");
const CRON_IT_ES = scanRow("materialized:IT-ES:2026-08-16:o0:l12", 1, "2026-08-16T23:00:26.053Z");

// El backend responde como PostgREST: si la consulta trae el `like` del
// nocturno, el cron italiano no está entre las filas.
function configureBackend(scans) {
  supabaseRequest.mockImplementation(async (path, options) => {
    if (path !== "scans") return [];
    const query = decodeURIComponent(String(options?.query || ""));
    const filtered = query.includes("local_id=like.materialized:US:")
      ? scans.filter((scan) => scan.local_id.startsWith("materialized:US:"))
      : scans;
    return filtered.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 1);
  });
}

const anchoredRequest = () => new Request(`https://statsedge.test/api/scans?includeRows=1&limit=1&rowsLimit=500&anchor=${NIGHTLY_US_ANCHOR}`);

describe("GET /api/scans?anchor=nightly-us · el arranque se ancla al nocturno estadounidense", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
    clearScansApiCache();
  });

  it("con el cron europeo por delante, sigue devolviendo el nocturno estadounidense", async () => {
    configureBackend([CRON_IT_ES, NIGHTLY_US]);

    const payload = await (await GET(anchoredRequest())).json();

    expect(payload.scans).toHaveLength(1);
    expect(payload.scans[0].id).toBe("materialized:US:2026-08-16:o0:l5609");
    expect(payload.scans[0].rowsAvailable).toBe(3313);
    expect(payload.nightly).toMatchObject({ found: true, localId: "materialized:US:2026-08-16:o0:l5609" });
  });

  it("pide el prefijo materialized:US: y descarta los borrados", async () => {
    configureBackend([NIGHTLY_US]);

    await GET(anchoredRequest());

    const query = decodeURIComponent(supabaseRequest.mock.calls.find((call) => call[0] === "scans")[1].query);
    expect(query).toContain("local_id=like.materialized:US:*");
    expect(query).toContain("deleted_at=is.null");
    expect(query).toContain("order=created_at.desc");
    expect(query).toContain("limit=1");
  });

  it("sin nocturno devuelve la ausencia con su motivo, no el escaneo de otro mercado", async () => {
    configureBackend([CRON_IT_ES]);

    const payload = await (await GET(anchoredRequest())).json();

    expect(payload.ok).toBe(true);
    expect(payload.scans).toEqual([]);
    expect(payload.nightly).toMatchObject({ found: false, reason: "no-nightly-scan" });
  });

  it("un nocturno que no terminó bien tampoco publica, y se dice cuál era", async () => {
    configureBackend([scanRow("materialized:US:2026-08-16:o0:l5609", 3313, "2026-08-16T03:57:58.557Z", "failed")]);

    const payload = await (await GET(anchoredRequest())).json();

    expect(payload.scans).toEqual([]);
    expect(payload.nightly).toMatchObject({ found: false, reason: "nightly-not-publishable" });
    expect(payload.nightly.rejectedScan).toMatchObject({ status: "failed" });
  });

  it("la caché de 2 minutos no mezcla la respuesta anclada con la sin anclar", async () => {
    configureBackend([CRON_IT_ES, NIGHTLY_US]);

    const anchored = await (await GET(anchoredRequest())).json();
    const plain = await (await GET(new Request("https://statsedge.test/api/scans?includeRows=1&limit=1&rowsLimit=500"))).json();

    expect(anchored.scans[0].id).toBe("materialized:US:2026-08-16:o0:l5609");
    // La sin anclar sigue devolviendo el más reciente a secas: si compartieran
    // clave de caché, la primera respuesta contaminaría a la segunda (o al revés,
    // que es lo que rompería el arranque de nuevo).
    expect(plain.scans[0].id).toBe("materialized:IT-ES:2026-08-16:o0:l12");
  });
});
