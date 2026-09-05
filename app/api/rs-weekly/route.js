import { readCountryRsSeriesForSymbol } from "@/lib/countryRsHydrate";
import { readGlobalRsSeriesForSymbol } from "@/lib/globalRs";
import { readThemeRsSeriesForSymbol } from "@/lib/themeRsHydrate";
import { rankableThemeForProfile } from "@/lib/themeRsAssign";

function numberParam(searchParams, key, fallback, min, max) {
  const raw = searchParams.get(key);
  const n = raw === null || raw === "" ? fallback : Number(raw);
  const value = Number.isFinite(n) ? n : fallback;
  return Math.min(Math.max(value, min), max);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) return Response.json({ ok: false, error: "Missing symbol" }, { status: 400 });
  const limit = numberParam(searchParams, "limit", 180, 1, 260);
  const sector = searchParams.get("sector") || "";
  const industry = searchParams.get("industry") || "";
  const themeHint = searchParams.get("theme") || "";
  const { themeKey } = rankableThemeForProfile(sector, industry, themeHint);

  try {
    const [global, country, theme] = await Promise.all([
      readGlobalRsSeriesForSymbol(symbol, { limit }),
      readCountryRsSeriesForSymbol(symbol, { limit }),
      themeKey
        ? readThemeRsSeriesForSymbol(symbol, { themeKey, limit })
        : Promise.resolve({ configured: true, series: [], latest: null, themeKey: "" }),
    ]);

    return Response.json({
      ok: true,
      configured: global.configured,
      symbol: global.symbol || symbol.trim().toUpperCase(),
      // Compat: clientes que solo leen `series` / `latest` (p. ej. búsqueda screener).
      series: global.series,
      latest: global.latest,
      global: { series: global.series, latest: global.latest },
      country: { series: country.series, latest: country.latest },
      theme: {
        series: theme.series,
        latest: theme.latest,
        themeKey: theme.themeKey || themeKey || "",
      },
    });
  } catch (error) {
    return Response.json({
      ok: true,
      configured: false,
      series: [],
      latest: null,
      global: { series: [], latest: null },
      country: { series: [], latest: null },
      theme: { series: [], latest: null, themeKey: themeKey || "" },
      error: error.message || "Weekly RS unavailable",
    });
  }
}
