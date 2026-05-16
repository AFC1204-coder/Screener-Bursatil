import { providerStatus } from "@/lib/dataProviders";

export async function GET() {
  return Response.json({
    priority: "free-first",
    providers: providerStatus(),
    nextRecommended: "finnhub",
  });
}
