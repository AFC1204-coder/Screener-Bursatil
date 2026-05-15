import { fetchYahooChart } from "@/lib/yahoo";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) return Response.json({ error: "Missing symbol" }, { status: 400 });
  try {
    return Response.json(await fetchYahooChart(symbol));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
