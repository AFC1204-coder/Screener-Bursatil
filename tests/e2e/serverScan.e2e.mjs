// E2E scan server-side: con un universo sembrado de 6 símbolos, el botón Ejecutar
// lanza POST /api/scan, el polling progresa y la tabla termina con resultados y
// estado "Completado". Cubre el camino UI → cadena de eslabones → restore de filas.
export const name = "scan server-side desde la UI";

export async function run({ context, baseUrl, sessionSeed }) {
  const symbols = ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN"];
  const universe = symbols.map((symbol) => ({ symbol, name: symbol, country: "US", source: "manual" }));
  const seed = sessionSeed({ universe, markets: ["US"], manual: "" });
  await context.addInitScript((value) => {
    localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(value));
  }, seed);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => {
    const [universeCount] = [...document.querySelectorAll(".kpi b")].map((el) => el.textContent.trim());
    return universeCount === "6";
  }, null, { timeout: 20000 });
  await page.getByRole("button", { name: "Ejecutar" }).first().click();
  await page.waitForFunction(
    () => /Completado:|Cancelado ·|Error/.test(document.body.innerText),
    null,
    { timeout: 180000 },
  );
  const text = await page.evaluate(() => document.body.innerText);
  if (!text.includes("Completado:")) throw new Error(`El scan no completó: ${text.match(/(Completado|Cancelado|Error)[^\n]*/)?.[0] || "sin estado"}`);
  const tickers = await page.$$eval("table a.ticker", (els) => els.map((el) => el.textContent.trim()));
  const found = symbols.filter((symbol) => tickers.includes(symbol));
  if (!found.length) throw new Error("El scan completó pero la tabla no muestra ningún símbolo del universo");
}
