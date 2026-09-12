export const name = "market health publica N0 sin esperar news";

const NEWS_DELAY_MS = 5500;

function json(data, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(data) };
}

async function stubCore(context) {
  await context.route("**/api/market-health", (route) => route.fulfill(json({
    marketScore: 55,
    heroScope: "US",
    regime: { label: "Neutral", stance: "Observación" },
    breadthProxy: {},
    weinsteinTape: null,
    sectorTape: [],
    sectorSummary: {},
    indexes: [{ symbol: "SPY", name: "S&P 500", score: 55 }],
    failures: [],
  })));
  await context.route("**/api/market-breadth", (route) => route.fulfill(json({ indicators: [], stages: null })));
  await context.route("**/api/market-leadership**", (route) => route.fulfill(json({ pulse: null })));
  await context.route("**/api/coverage**", (route) => route.fulfill(json({ markets: [], summary: {} })));
  await context.route("**/api/methodology-health", (route) => route.fulfill(json({ status: "pass", label: "OK" })));
  await context.route("**/api/social-sentiment**", (route) => route.fulfill(json({ configured: false, rows: [] })));
}

export async function run({ context, baseUrl }) {
  await stubCore(context);
  await context.route("**/api/market-news", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, NEWS_DELAY_MS));
    await route.fulfill(json({
      total: 3,
      pessimismIndex: 61,
      bearishPct: 40,
      neutralPct: 30,
      bullishPct: 30,
      dominantSentiment: "bajista",
      contrarianRead: "Lectura de prueba",
      rows: [{
        title: "Titular lento",
        link: "https://example.com/news",
        publishedAt: "2026-09-12T00:00:00Z",
        sentimentLabel: "bajista",
      }],
    }));
  });

  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(`${baseUrl}/market-health`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector('[data-testid="market-regime-panel"]', { timeout: 20000 });
  const tN0 = Date.now() - t0;

  const newsRow = page.locator('[data-testid="market-sentiment-titulares"]');
  await newsRow.waitFor({ timeout: 5000 });
  if ((await newsRow.getAttribute("data-loading")) !== "true") {
    throw new Error("News debería seguir en carga local cuando N0 ya es visible");
  }
  if (await page.locator("section.card.error").count()) {
    throw new Error("News lenta no puede disparar el error global de Market Health");
  }
  if (tN0 > 4000) {
    throw new Error(`N0 tardó ${tN0}ms con news artificialmente lenta: el barrier sigue acoplado`);
  }

  await page.waitForFunction(() => {
    const row = document.querySelector('[data-testid="market-sentiment-titulares"]');
    return row && row.getAttribute("data-loading") !== "true" && /61/.test(row.textContent || "");
  }, null, { timeout: 15000 });
  const tNews = Date.now() - t0;
  if (tNews - tN0 < 3000) {
    throw new Error(`News resolvió demasiado pronto (${tNews}ms vs N0 ${tN0}ms); no se demostró el desacople`);
  }

  await context.unroute("**/api/market-news");
  await context.route("**/api/market-news", (route) => route.fulfill(json({ error: "upstream news failed" }, 500)));
  const errorPage = await context.newPage();
  await errorPage.goto(`${baseUrl}/market-health`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await errorPage.waitForSelector('[data-testid="market-regime-panel"]', { timeout: 20000 });
  await errorPage.waitForSelector(".marketSentimentCardNotice", { timeout: 10000 });
  if (await errorPage.locator("section.card.error").count()) {
    throw new Error("Un 500 de market-news no debe pintar el banner global de Market Health");
  }
  const notice = await errorPage.locator(".marketSentimentCardNotice").innerText();
  if (!/titulares|disponibles|upstream/i.test(notice)) {
    throw new Error(`Aviso local de news inesperado: ${notice}`);
  }

  console.log(`MH-PERF-2 e2e timings: N0=${tN0}ms news=${tNews}ms delay=${NEWS_DELAY_MS}ms`);
}
