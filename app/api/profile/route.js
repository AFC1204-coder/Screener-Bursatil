import { fetchYahooProfile } from "@/lib/yahoo";
import { fetchAsicShortInterest, mergeAsicShortInterest } from "@/lib/asicShort";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) return Response.json({ error: "Missing symbol" }, { status: 400 });
  try {
    const profile = await fetchYahooProfile(symbol);
    const asicShort = await fetchAsicShortInterest(symbol).catch(() => null);
    return Response.json(mergeAsicShortInterest(profile, asicShort));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
