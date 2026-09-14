import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));
const vmSource = readFileSync(join(root, "../app/components/screener/useResultViewModel.js"), "utf8");

describe("useResultViewModel · view audit defer (REACT-COMMIT-PERF-1)", () => {
  it("diferir agregados de auditoría con useDeferredValue", () => {
    expect(vmSource).toMatch(/const deferredAuditRows = useDeferredValue\(viewFilteredRows\)/);
    expect(vmSource).toMatch(/const viewAuditBundle = useMemo\(\(\) => \{/);
    expect(vmSource).toMatch(/rows: deferredAuditRows/);
    expect(vmSource).toMatch(/performance\.measure\("screener:viewAudit"/);
  });

  it("mantiene sort/tabla en viewFilteredRows síncrono", () => {
    const filteredBlock = vmSource.match(/const filtered = useMemo\([\s\S]*?\), \[viewFilteredRows/);
    expect(filteredBlock).toBeTruthy();
    expect(vmSource.indexOf("const deferredAuditRows")).toBeLessThan(vmSource.indexOf("const filtered = useMemo"));
  });

  it("no recalcula memos de auditoría sueltos sobre viewFilteredRows", () => {
    expect(vmSource).not.toMatch(/buildScreenerScoreAuditSummary\(viewFilteredRows\)/);
    expect(vmSource).not.toMatch(/auditDecisionScan\(\{[\s\S]*rows: viewFilteredRows/);
  });
});
