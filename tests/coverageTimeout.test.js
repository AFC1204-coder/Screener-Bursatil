import { describe, expect, it, vi } from "vitest";
import { runCoverageWithTimeout } from "@/app/api/coverage/route";

describe("coverage route timeout cancellation", () => {
  it("aborta y espera a que el trabajo termine antes de devolver el fallback", async () => {
    let active = 0;
    let aborted = false;
    let backgroundMutation = false;
    const build = vi.fn(({ signal }) => new Promise((_resolve, reject) => {
      active += 1;
      const lateTimer = setTimeout(() => {
        backgroundMutation = true;
      }, 40);
      signal.addEventListener("abort", () => {
        aborted = true;
        clearTimeout(lateTimer);
        active -= 1;
        reject(signal.reason);
      }, { once: true });
    }));

    await expect(runCoverageWithTimeout(build, {}, 10)).rejects.toThrow("Coverage report timeout");
    expect(build).toHaveBeenCalledTimes(1);
    expect(aborted).toBe(true);
    expect(active).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(backgroundMutation).toBe(false);
    expect(active).toBe(0);
  });
});
