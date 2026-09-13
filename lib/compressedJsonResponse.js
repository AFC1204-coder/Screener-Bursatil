import { promisify } from "node:util";
import { gzip as gzipCb } from "node:zlib";

const gzipAsync = promisify(gzipCb);

// Next `compress: true` gzippea HTML y JSON chico en `next start`, pero el GET
// de mesa (~35 MB, stream chunked de Response.json) sale en claro. Este helper
// negocea gzip sobre el JSON ya materializado. No cambia el contrato lógico:
// el cliente (fetch del navegador) descomprime solo.
export const JSON_GZIP_MIN_BYTES = 1024;
export const JSON_GZIP_LEVEL = 6;

export function requestAcceptsGzip(request) {
  const header = request?.headers?.get?.("accept-encoding") || "";
  return /(^|,)\s*gzip\b/i.test(header);
}

export async function compressedJsonResponse(request, payload, init = {}) {
  const json = JSON.stringify(payload);
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const jsonBytes = Buffer.byteLength(json);
  if (!requestAcceptsGzip(request) || jsonBytes < JSON_GZIP_MIN_BYTES) {
    return new Response(json, { ...init, headers });
  }
  const body = await gzipAsync(json, { level: JSON_GZIP_LEVEL });
  headers.set("Content-Encoding", "gzip");
  if (!headers.has("Vary")) headers.set("Vary", "Accept-Encoding");
  else {
    const vary = headers.get("Vary") || "";
    if (!/accept-encoding/i.test(vary)) headers.set("Vary", `${vary}, Accept-Encoding`);
  }
  headers.set("Content-Length", String(body.length));
  return new Response(body, { ...init, headers });
}
