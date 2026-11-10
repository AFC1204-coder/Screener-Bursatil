import { describe, expect, it } from "vitest";
import { parseArgs } from "@/scripts/rs-intl-bars.mjs";

describe("rs-intl-bars parseArgs", () => {
  it("stale-days por defecto 0: un símbolo con la barra de ayer no se salta", () => {
    expect(parseArgs([]).staleDays).toBe(0);
  });

  it("--stale-days explícito se respeta", () => {
    expect(parseArgs(["--stale-days=1"]).staleDays).toBe(1);
  });
});
