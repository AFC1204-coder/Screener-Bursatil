// Tests de lib/scanStatus.js: la decisión de estado terminal que comparten el
// polling del cliente, /api/scan y /api/scan/cancel.
import { describe, expect, it } from "vitest";
import { isTerminalScanStatus, TERMINAL_SCAN_STATUSES } from "@/lib/scanStatus";

describe("isTerminalScanStatus", () => {
  it("done, error y cancelled son terminales", () => {
    expect(isTerminalScanStatus("done")).toBe(true);
    expect(isTerminalScanStatus("error")).toBe(true);
    expect(isTerminalScanStatus("cancelled")).toBe(true);
  });
  it("es tolerante a mayúsculas y espacios", () => {
    expect(isTerminalScanStatus("DONE")).toBe(true);
    expect(isTerminalScanStatus(" Cancelled ")).toBe(true);
  });
  it("running y estados desconocidos no son terminales", () => {
    expect(isTerminalScanStatus("running")).toBe(false);
    expect(isTerminalScanStatus("unknown")).toBe(false);
    expect(isTerminalScanStatus("")).toBe(false);
    expect(isTerminalScanStatus(null)).toBe(false);
    expect(isTerminalScanStatus(undefined)).toBe(false);
  });
  it("la lista exportada cubre exactamente los tres estados terminales", () => {
    expect(TERMINAL_SCAN_STATUSES).toEqual(["done", "error", "cancelled"]);
  });
});
