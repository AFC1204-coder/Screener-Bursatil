import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  compressedJsonResponse,
  JSON_GZIP_MIN_BYTES,
  requestAcceptsGzip,
} from "@/lib/compressedJsonResponse";

function requestWith(acceptEncoding) {
  const headers = {};
  if (acceptEncoding !== undefined) headers["Accept-Encoding"] = acceptEncoding;
  return new Request("https://statsedge.test/api/scans", { headers });
}

describe("compressedJsonResponse", () => {
  it("deja el JSON en claro sin Accept-Encoding gzip", async () => {
    const payload = { ok: true, rows: Array.from({ length: 80 }, (_, i) => ({ i, symbol: `S${i}` })) };
    const res = await compressedJsonResponse(requestWith(undefined), payload);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.json()).toEqual(payload);
  });

  it("no gzippea por debajo del umbral aunque el cliente acepte gzip", async () => {
    const payload = { ok: true };
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(JSON_GZIP_MIN_BYTES);
    const res = await compressedJsonResponse(requestWith("gzip, deflate, br"), payload);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.json()).toEqual(payload);
  });

  it("gzippea el JSON y el cuerpo descomprimido es idéntico al lógico", async () => {
    const payload = {
      ok: true,
      projection: "compact",
      rows: Array.from({ length: 120 }, (_, i) => ({
        symbol: `SYM${i}`,
        metrics: { rsGlobalPct: i, chartPreview: Array.from({ length: 8 }, (__, j) => j + i) },
      })),
    };
    const json = JSON.stringify(payload);
    expect(Buffer.byteLength(json)).toBeGreaterThan(JSON_GZIP_MIN_BYTES);

    const res = await compressedJsonResponse(requestWith("gzip, deflate, br"), payload);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("vary")).toMatch(/Accept-Encoding/i);
    const wire = Buffer.from(await res.arrayBuffer());
    expect(Number(res.headers.get("content-length"))).toBe(wire.length);
    expect(wire.length).toBeLessThan(Buffer.byteLength(json));
    expect(wire.subarray(0, 2).toString("hex")).toBe("1f8b");
    expect(JSON.parse(gunzipSync(wire).toString("utf8"))).toEqual(payload);
  });

  it("requestAcceptsGzip reconoce el token gzip y rechaza identity", () => {
    expect(requestAcceptsGzip(requestWith("gzip, deflate, br"))).toBe(true);
    expect(requestAcceptsGzip(requestWith("br, deflate"))).toBe(false);
    expect(requestAcceptsGzip(requestWith(undefined))).toBe(false);
  });
});
