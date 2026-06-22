import { providerStatus } from "@/lib/dataProviders";
import { marketCacheStats } from "@/lib/marketData";

export async function GET() {
  return Response.json({
    priority: "free-first",
    cache: marketCacheStats(),
    providers: providerStatus(),
    implementedNow: ["openfigi", "stooq-chart", "alpha-vantage", "sec-edgar", "asic-short", "universe-engine-cache", "shadow-universe-store", "curated-core-universes", "hkex-securities-list", "twse-isin-list", "jquants", "esma-firds", "fca-firds"],
    nextRecommended: ["esef-filings", "sfc-hk-short"],
    premiumLater: ["eodhd", "twelve-data", "marketstack", "finnhub"],
  });
}
