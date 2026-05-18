import { providerStatus } from "@/lib/dataProviders";

export async function GET() {
  return Response.json({
    priority: "free-first",
    providers: providerStatus(),
    implementedNow: ["openfigi", "stooq-chart", "alpha-vantage", "sec-edgar", "asic-short", "universe-engine-cache", "jquants"],
    nextRecommended: ["esef-filings", "sfc-hk-short"],
    premiumLater: ["eodhd", "twelve-data", "marketstack", "finnhub"],
  });
}
