// E2E gráfico: tras una carga fresca en StrictMode, cada cambio consecutivo de
// rango debe publicar los datos de su request; no basta con validar el primer clic.
export const name = "gráfico de ficha actualiza tres rangos consecutivos";

function tradingBars(count, latestClose) {
  const bars = [];
  const cursor = new Date("2026-07-24T00:00:00Z");
  while (bars.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      const index = count - 1 - bars.length;
      const close = latestClose - (index * 0.15);
      bars.push({
        date: cursor.toISOString().slice(0, 10),
        open: close - 0.25,
        high: close + 0.75,
        low: close - 0.75,
        close,
        volume: 1_000_000 + (index * 1000),
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return bars;
}

const localBars = tradingBars(320, 120);
const chartPayloads = {
  "5A": { close: 500, bars: tradingBars(1300, 500) },
  "6M": { close: 260, bars: tradingBars(130, 260) },
  "1M": { close: 110, bars: tradingBars(24, 110) },
};

function companyBrief() {
  return {
    symbol: "GOOGL",
    name: "Alphabet Inc.",
    sector: "Technology",
    industry: "Internet Content & Information",
    exchange: "NASDAQ",
    currency: "USD",
    country: "Estados Unidos",
    chartBars: localBars,
    chartProvider: "Yahoo Finance",
    links: {},
    visual: { initials: "GO" },
    growthMetrics: {},
    valuationMetrics: {},
    quoteSnapshot: {},
    relativeStrength: { benchmarkSymbol: "SPY", series: [], globalRsSeries: [] },
    dataQuality: {
      coverage: { label: "Completa", total: 100, technical: 100 },
      freshness: { priceDate: "2026-07-24", chartProvider: "Yahoo Finance" },
    },
    updatedAt: "2026-07-24T12:00:00.000Z",
  };
}

// La sonda de "el gráfico publicó datos nuevos" era `.universalRsLineBadge`,
// un badge rotulado "RS <rango>" que en realidad mostraba el ÚLTIMO CIERRE del
// precio (por eso cambiaba al cambiar de rango). Ese badge ya no existe: la
// línea RS vive en su propio panel y su eje rotula el RS. Lo que el badge
// aportaba a esta prueba —rango aplicado + datos nuevos— lo cubren el scope
// badge y la cotización del header, que son los mismos dos hechos sin el
// rótulo equivocado.
async function chartSnapshot(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('section.stockChartPanel[aria-label="Gráfico de la ficha"]');
    const quote = panel?.querySelector(".universalChartQuote");
    const scope = panel?.querySelector(".universalChartScopeBadge b");
    return {
      scope: scope?.textContent?.replace(/\s+/g, " ").trim() || "",
      quote: quote?.textContent?.replace(/\s+/g, " ").trim() || "",
    };
  });
}

async function selectRange(page, range, previousSnapshot) {
  const panel = page.locator('section.stockChartPanel[aria-label="Gráfico de la ficha"]');
  const button = panel.getByRole("button", { name: `Rango ${range}`, exact: true });
  await button.click();

  try {
    await page.waitForFunction(({ expectedRange, previous }) => {
      const root = document.querySelector('section.stockChartPanel[aria-label="Gráfico de la ficha"]');
      const selected = root?.querySelector(`button[aria-label="Rango ${expectedRange}"]`);
      const scope = root?.querySelector(".universalChartScopeBadge b")?.textContent?.replace(/\s+/g, " ").trim() || "";
      const quote = root?.querySelector(".universalChartQuote")?.textContent?.replace(/\s+/g, " ").trim() || "";
      return selected?.getAttribute("aria-pressed") === "true"
        && scope === `${expectedRange} · D`
        && scope !== previous.scope
        && quote !== previous.quote;
    }, { expectedRange: range, previous: previousSnapshot }, { timeout: 15000 });
  } catch {
    const current = await chartSnapshot(page);
    throw new Error(`Rango ${range}: el gráfico no publicó datos nuevos tras la secuencia. Antes=${JSON.stringify(previousSnapshot)} Después=${JSON.stringify(current)}`);
  }

  return chartSnapshot(page);
}

export async function run({ context, baseUrl }) {
  await context.route("**/api/company-brief?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(companyBrief()),
  }));
  await context.route("**/api/chart?**", (route) => {
    const url = new URL(route.request().url());
    const range = url.searchParams.get("range");
    const payload = chartPayloads[range];
    if (!payload) return route.abort("failed");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        bars: payload.bars,
        meta: { symbol: "GOOGL", requestedRange: range, requestedInterval: "D", dataProvider: "Yahoo Finance" },
        dataQuality: { status: "real", source: "Yahoo Finance" },
      }),
    });
  });

  const page = await context.newPage();
  await page.goto(`${baseUrl}/stock/GOOGL`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector('section.stockChartPanel[aria-label="Gráfico de la ficha"] .universalChartCanvas canvas', { timeout: 30000 });

  let snapshot = await chartSnapshot(page);
  for (const range of ["5A", "6M", "1M"]) {
    snapshot = await selectRange(page, range, snapshot);
  }
}
