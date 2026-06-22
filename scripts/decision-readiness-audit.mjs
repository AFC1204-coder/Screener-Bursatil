import { readFile } from "node:fs/promises";
import { auditDecisionPayload, compactErrorMessage } from "@/lib/decisionAudit";

const baseUrl = process.env.DECISION_AUDIT_BASE_URL || "http://127.0.0.1:3000";
const limit = Number(process.env.DECISION_AUDIT_LIMIT || 1);
const rowsLimit = Number(process.env.DECISION_AUDIT_ROWS_LIMIT || 2000);
const token = process.env.STATSEDGE_ACCESS_TOKEN || process.env.STATSEDGE_API_TOKEN || process.env.STATSEDGE_ADMIN_TOKEN || "";
const auditFile = process.env.DECISION_AUDIT_FILE || "";
const fallbackFile = process.env.DECISION_AUDIT_FALLBACK_FILE || "";

async function readJsonFile(file) {
  const raw = await readFile(file, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`No se pudo parsear ${file}: ${compactErrorMessage(error.message)}`);
  }
}

async function fetchScans() {
  const url = new URL("/api/scans", baseUrl);
  url.searchParams.set("includeRows", "1");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("rowsLimit", String(rowsLimit));
  url.searchParams.set("projection", "decision");
  const response = await fetch(url, {
    headers: token ? { "x-statsedge-token": token } : {},
    signal: AbortSignal.timeout(Number(process.env.DECISION_AUDIT_TIMEOUT_MS || 90000)),
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { error: compactErrorMessage(raw) || "Respuesta no JSON del endpoint de scans." };
  }
  if (!response.ok || data.ok === false) {
    throw new Error(compactErrorMessage(data.error || data.message) || `HTTP ${response.status}`);
  }
  return data;
}

async function loadAuditPayload() {
  if (auditFile) {
    return {
      payload: await readJsonFile(auditFile),
      meta: { source: "file", file: auditFile },
    };
  }
  try {
    return {
      payload: await fetchScans(),
      meta: { source: "api", baseUrl },
    };
  } catch (error) {
    if (!fallbackFile) throw error;
    return {
      payload: await readJsonFile(fallbackFile),
      meta: { source: "file-fallback", file: fallbackFile, baseUrl, fallbackReason: compactErrorMessage(error.message) },
    };
  }
}

const { payload, meta } = await loadAuditPayload();
console.log(JSON.stringify(auditDecisionPayload(payload, meta), null, 2));
