import { readFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_METHODOLOGY_MATRIX_PATH = "docs/methodology/latest-validation-matrix.md";

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstMatchNumber(text = "", pattern) {
  const match = text.match(pattern);
  return match ? num(match[1]) : null;
}

function parseCounts(markdown = "") {
  const cases = firstMatchNumber(markdown, /Cases:\s*(\d+)/i);
  const passed = firstMatchNumber(markdown, /Passed:\s*(\d+)/i);
  const failed = firstMatchNumber(markdown, /Failed:\s*(\d+)/i);
  return {
    cases,
    passed,
    failed,
  };
}

function parseCalibration(markdown = "") {
  const line = markdown.split("\n").find((item) => item.startsWith("Calibration:")) || "";
  const buckets = { block: 0, observe: 0, watch: 0, plan: 0 };
  for (const match of line.matchAll(/\b(block|observe|watch|plan)\s+(\d+)/gi)) {
    buckets[match[1].toLowerCase()] = num(match[2]) ?? 0;
  }
  return {
    checked: firstMatchNumber(line, /checked\s+(\d+)/i),
    mismatches: firstMatchNumber(line, /mismatches\s+(\d+)/i),
    buckets,
    guardrailsOk: /Calibration guardrails:\s*OK/i.test(markdown),
  };
}

function parseRows(markdown = "") {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(OK|FAIL)\s*\|/.test(line))
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      return {
        result: parts[0] || "",
        symbol: parts[1] || "",
        theme: parts[2] || "",
        verdict: parts[3] || "",
        calibration: parts[4] || "",
        claimBlock: parts[5] || "",
        confidence: parts[6] || "",
        planValid: parts[7] || "",
        evidence: parts[8] || "",
        failedChecks: parts[9] || "",
      };
    });
}

function statusFor({ totals = {}, calibration = {} } = {}) {
  if ((totals.failed ?? 0) > 0) return "fail";
  if (!calibration.guardrailsOk) return "warn";
  if ((calibration.mismatches ?? 0) > 0) return "warn";
  if ((calibration.buckets?.plan ?? 0) > 0) return "warn";
  return "pass";
}

function labelFor(status) {
  if (status === "pass") return "Guardrails OK";
  if (status === "fail") return "Regresion detectada";
  return "Revisar calibracion";
}

function detailFor(status, totals = {}, calibration = {}) {
  if (status === "pass") {
    return `${totals.passed ?? "-"} de ${totals.cases ?? "-"} casos pasan; ${calibration.mismatches ?? "-"} desajustes y ${calibration.buckets?.plan ?? "-"} planes automáticos.`;
  }
  if ((totals.failed ?? 0) > 0) return `${totals.failed} casos fallan en la matriz metodológica.`;
  if (!calibration.guardrailsOk) return "Los guardrails agregados de calibracion no estan en OK.";
  if ((calibration.mismatches ?? 0) > 0) return `${calibration.mismatches} casos no caen en el bucket esperado.`;
  if ((calibration.buckets?.plan ?? 0) > 0) return "Hay casos marcados como plan antes de que esa señal este habilitada con confianza.";
  return "La matriz metodológica necesita revisión.";
}

export function parseMethodologyValidationMatrix(markdown = "", options = {}) {
  const totals = parseCounts(markdown);
  const calibration = parseCalibration(markdown);
  const rows = parseRows(markdown);
  const failedRows = rows.filter((row) => row.result === "FAIL");
  const status = statusFor({ totals, calibration });
  return {
    ok: status === "pass",
    configured: true,
    status,
    label: labelFor(status),
    detail: detailFor(status, totals, calibration),
    sourcePath: options.sourcePath || DEFAULT_METHODOLOGY_MATRIX_PATH,
    parsedAt: new Date().toISOString(),
    datasetVersion: firstMatchNumber(markdown, /Dataset version:\s*(\d+)/i),
    baseUrl: markdown.match(/Base URL:\s*([^\n]+)/i)?.[1]?.trim() || "",
    totals,
    calibration,
    rows: rows.length,
    failedRows: failedRows.slice(0, 8).map((row) => ({
      symbol: row.symbol,
      verdict: row.verdict,
      calibration: row.calibration,
      failedChecks: row.failedChecks,
    })),
    note: "Valida la coherencia de VCP, vigilancia y bloqueo de Plan válido; no genera recomendaciones de entrada.",
  };
}

export async function readMethodologyHealth(options = {}) {
  const sourcePath = options.sourcePath || DEFAULT_METHODOLOGY_MATRIX_PATH;
  const absolutePath = path.resolve(options.cwd || process.cwd(), sourcePath);
  try {
    const markdown = await readFile(absolutePath, "utf8");
    return parseMethodologyValidationMatrix(markdown, { sourcePath });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        ok: false,
        configured: false,
        status: "missing",
        label: "Matriz no disponible",
        detail: `No se encontro ${sourcePath}. Ejecuta la auditoría metodológica para publicar el estado.`,
        sourcePath,
        parsedAt: new Date().toISOString(),
        totals: { cases: null, passed: null, failed: null },
        calibration: {
          checked: null,
          mismatches: null,
          buckets: { block: 0, observe: 0, watch: 0, plan: 0 },
          guardrailsOk: false,
        },
        failedRows: [],
        note: "Sin matriz no se debe mostrar la metodología como validada.",
      };
    }
    throw error;
  }
}
