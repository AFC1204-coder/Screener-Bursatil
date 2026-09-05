// lib/chartRsRowProps.js — mapeo fila screener/brief → props RS del chart.

const EMPTY_SERIES = [];

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Series semanales ya hidratadas en la fila (p. ej. company-brief en /review). */
export function rowHasChartRsSeries(row = null) {
  if (!row) return false;
  return (
    (Array.isArray(row.globalRsSeries) && row.globalRsSeries.length > 0)
    || (Array.isArray(row.countryRsSeries) && row.countryRsSeries.length > 0)
    || (Array.isArray(row.themeRsSeries) && row.themeRsSeries.length > 0)
  );
}

/** Props RS para UniversalPriceChart derivadas de una fila o de /api/rs-weekly. */
export function chartRsPropsFromRow(row = null, fetched = null) {
  const global = (Array.isArray(row?.globalRsSeries) && row.globalRsSeries.length > 0)
    ? row.globalRsSeries
    : (fetched?.globalRsSeries ?? EMPTY_SERIES);
  const country = (Array.isArray(row?.countryRsSeries) && row.countryRsSeries.length > 0)
    ? row.countryRsSeries
    : (fetched?.countryRsSeries ?? EMPTY_SERIES);
  const theme = (Array.isArray(row?.themeRsSeries) && row.themeRsSeries.length > 0)
    ? row.themeRsSeries
    : (fetched?.themeRsSeries ?? EMPTY_SERIES);

  const countryScore = finiteOrNull(
    row?.weeklyCountryRsRating
    ?? row?.countryRsRating
    ?? fetched?.countryRsRating,
  );
  const themeScore = finiteOrNull(
    row?.weeklyThemeRsRating
    ?? row?.themeRsRating
    ?? fetched?.themeRsRating,
  );

  return {
    rsRatingSeries: global,
    rsCountrySeries: country,
    rsThemeSeries: theme,
    rsCountryMainScore: countryScore,
    rsThemeMainScore: themeScore,
  };
}

export function rsWeeklyChartQuery(symbol = "", row = null, limit = 180) {
  const params = new URLSearchParams({
    symbol: String(symbol || "").trim(),
    limit: String(limit),
  });
  if (row?.sector) params.set("sector", row.sector);
  if (row?.industry) params.set("industry", row.industry);
  if (row?.theme) params.set("theme", row.theme);
  return `/api/rs-weekly?${params.toString()}`;
}

/** Normaliza la respuesta ampliada de /api/rs-weekly para el chart. */
export function chartRsPropsFromWeeklyResponse(payload = null) {
  if (!payload) return null;
  const globalBlock = payload.global || {};
  const countryBlock = payload.country || {};
  const themeBlock = payload.theme || {};
  const globalSeries = globalBlock.series || payload.series || EMPTY_SERIES;
  if (!Array.isArray(globalSeries) || !globalSeries.length) return null;
  return {
    globalRsSeries: globalSeries,
    countryRsSeries: countryBlock.series || EMPTY_SERIES,
    themeRsSeries: themeBlock.series || EMPTY_SERIES,
    countryRsRating: countryBlock.latest?.rsRating ?? null,
    themeRsRating: themeBlock.latest?.rsRating ?? null,
  };
}
