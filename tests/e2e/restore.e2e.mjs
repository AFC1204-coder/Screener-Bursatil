// E2E restore: la sesión local con resultados se restaura tal cual (y sobrevive a
// una recarga), y con la sesión vacía el último snapshot de Supabase puebla la
// tabla sin pisar nada (no había nada que pisar).
export const name = "restore (sesión local + snapshot Supabase)";

export async function run({ context, baseUrl, sessionSeed, seedRows }) {
  // — Parte 1: restauración desde localStorage —
  const rows = seedRows();
  const seed = sessionSeed({ rows });
  await context.addInitScript((value) => {
    localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(value));
  }, seed);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.body.innerText.includes("ALPHA"), null, { timeout: 20000 });
  const text = await page.evaluate(() => document.body.innerText);
  if (!text.includes("restaurada") && !text.includes("ALPHA")) throw new Error("No se restauró la sesión local");
  for (const symbol of ["ALPHA", "BETA.DE", "GAMMA.PA"]) {
    if (!text.includes(symbol)) throw new Error(`Falta ${symbol} tras el restore`);
  }
  // Recarga: debe sobrevivir (persistencia no pisa el restore)
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.body.innerText.includes("ALPHA"), null, { timeout: 20000 });

  // — Parte 2: sesión vacía → snapshot Supabase —
  const fresh = await context.browser().newContext({ viewport: { width: 1600, height: 1000 } });
  const cloudPage = await fresh.newPage();
  await cloudPage.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 90000 });
  await cloudPage.waitForFunction(() => document.querySelectorAll("table a.ticker").length > 0, null, { timeout: 45000 });
  const cloudText = await cloudPage.evaluate(() => document.body.innerText);
  const tickers = await cloudPage.$$eval("table a.ticker", (els) => els.map((el) => el.textContent.trim()).filter(Boolean));
  if (!tickers.length) throw new Error("La sesión vacía no restauró filas desde el último snapshot");
  for (const symbol of ["ALPHA", "BETA.DE", "GAMMA.PA"]) {
    if (cloudText.includes(symbol)) throw new Error(`El snapshot cloud pisó la sesión local anterior: ${symbol}`);
  }
  await fresh.close();
}
