import { describe, expect, it } from "vitest";
import {
  alertDate,
  daysUntil,
  filterIpoRadarDueItems,
  isDue,
} from "@/lib/ipoRadarAlerts";

const NOW = new Date("2026-08-29T10:00:00.000Z");

describe("ipoRadarAlerts", () => {
  it("calcula días hasta la fecha de alerta", () => {
    expect(daysUntil("2026-09-05", NOW)).toBe(7);
    expect(alertDate({ expectedTradeDate: "2026-09-01", expectedPricingDate: "2026-08-20" })).toBe("2026-09-01");
  });

  it("marca due dentro de 14 días y excluye listed/passed", () => {
    expect(isDue({ status: "watch", expectedTradeDate: "2026-09-10" }, 14, NOW)).toBe(true);
    expect(isDue({ status: "listed", expectedTradeDate: "2026-09-10" }, 14, NOW)).toBe(false);
    expect(isDue({ status: "passed", expectedTradeDate: "2026-09-10" }, 14, NOW)).toBe(false);
    expect(isDue({ status: "watch", expectedTradeDate: "2026-10-15" }, 14, NOW)).toBe(false);
  });

  it("filtra pendientes no avisados", () => {
    const items = [
      { id: "a", status: "watch", expectedTradeDate: "2026-09-02" },
      { id: "b", status: "watch", expectedTradeDate: "2026-09-03", alertAcknowledgedAt: "2026-08-28" },
      { id: "c", status: "watch", expectedTradeDate: "2026-10-01" },
    ];
    expect(filterIpoRadarDueItems(items, { now: NOW }).map((item) => item.id)).toEqual(["a"]);
  });
});
