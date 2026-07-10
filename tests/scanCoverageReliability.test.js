import { describe, expect, it } from "vitest";
import { settleScanCoverageDependency } from "@/app/api/scan-coverage/route";

describe("scan coverage secondary dependency reporting", () => {
  it("mantiene el fallback pero conserva evidencia explícita del fallo", async () => {
    const result = await settleScanCoverageDependency(
      "leaderboards",
      Promise.reject(new Error("leaderboard_snapshots timeout")),
      [],
    );
    console.log(`[SCAN-COVERAGE-SECONDARY] area=${result.area} fallback=${JSON.stringify(result.value)} failure=${result.failure.message}`);
    expect(result).toEqual({
      area: "leaderboards",
      value: [],
      failure: { area: "leaderboards", message: "leaderboard_snapshots timeout" },
    });
  });
});
