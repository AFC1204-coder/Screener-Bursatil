import { fetchAsicShortInterest, fetchLatestAsicShortReport } from "@/lib/asicShort";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  try {
    if (!symbol) {
      const report = await fetchLatestAsicShortReport();
      return Response.json({
        provider: report.source,
        reportDate: report.reportDate,
        lagDays: report.lagDays,
        count: report.rows.length,
        sourceUrl: report.sourceUrl,
        coverage: "Australia (.AX)",
        methodology: "ASIC aggregated short positions as a percentage of total product in issue.",
      });
    }
    const shortInterest = await fetchAsicShortInterest(symbol);
    if (!shortInterest) {
      return Response.json({
        symbol,
        available: false,
        provider: "ASIC short position reports",
        note: "Solo cubre simbolos .AX presentes en el ultimo reporte agregado de ASIC.",
      });
    }
    return Response.json({
      ...shortInterest,
      available: true,
      shortPercentOfFloat: shortInterest.shortPercentOfIssued,
      providerNote: "Proxy para filtros: ASIC mide porcentaje del total emitido, no porcentaje exacto de free float.",
    });
  } catch (err) {
    return Response.json({ error: err.message || "Short interest provider unavailable" }, { status: 502 });
  }
}
