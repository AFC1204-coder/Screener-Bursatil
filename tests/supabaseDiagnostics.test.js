import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseServer", () => ({
  disabledPayload: vi.fn(() => ({ configured: false, skipped: true })),
  supabaseConfig: vi.fn(() => ({ configured: true, ownerId: "owner-test", missing: [] })),
  supabaseRequest: vi.fn(),
}));

import { checkSupabaseSchema, REQUIRED_SUPABASE_FUNCTIONS, REQUIRED_SUPABASE_TABLES } from "@/lib/supabaseDiagnostics";
import { supabaseRequest } from "@/lib/supabaseServer";

function openApiWithout(missingName = "") {
  return {
    paths: Object.fromEntries(
      REQUIRED_SUPABASE_FUNCTIONS
        .filter((fn) => fn.name !== missingName)
        .map((fn) => [`/rpc/${fn.name}`, { post: {} }]),
    ),
  };
}

describe("Supabase deployed-contract diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseRequest.mockImplementation(async (path) => path === "" ? openApiWithout() : []);
  });

  it("comprueba por OpenAPI todas las RPC usadas por coverage, scan y mantenimiento sin invocarlas", async () => {
    const result = await checkSupabaseSchema();
    expect(result.ok).toBe(true);
    expect(result.functions).toHaveLength(REQUIRED_SUPABASE_FUNCTIONS.length);
    expect(result.functions.map((fn) => fn.name)).toEqual(expect.arrayContaining([
      "finalize_scan_results",
      "coverage_scan_summary",
      "scan_coverage_breakdown",
      "scan_finalize_inputs",
      "purge_daily_bars_backstop",
    ]));
    expect(supabaseRequest).toHaveBeenCalledTimes(REQUIRED_SUPABASE_TABLES.length + 1);
  });

  it("marca schemaReady=false si falta una RPC crítica aunque todas las tablas existan", async () => {
    supabaseRequest.mockImplementation(async (path) => path === "" ? openApiWithout("coverage_scan_summary") : []);
    const result = await checkSupabaseSchema();
    console.log(`[SCHEMA-GUARD] schemaReady=${result.schemaReady} missingFunctions=${result.missingFunctions.join(",")}`);
    expect(result.schemaReady).toBe(false);
    expect(result.missingFunctions).toContain("coverage_scan_summary");
  });
});
