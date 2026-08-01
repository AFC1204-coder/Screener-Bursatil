// E2E favoritos: añadir un favorito manual en research-desk lo pinta en la tabla
// con su columna de evolución (sparkline o serie en construcción), y sobrevive a
// una recarga (persistencia local).
export const name = "favoritos en research-desk";

export async function run({ context, baseUrl }) {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/research-desk`, { waitUntil: "networkidle", timeout: 90000 });
  await page.locator('[data-testid="research-desk-tools"] summary').click();
  await page.fill("textarea.textarea", "NVDA");
  await page.click("text=Anadir a watchlist");
  await page.waitForFunction(() => {
    const table = [...document.querySelectorAll("table")].find((el) => /evoluci/i.test(el.innerText));
    return table && table.innerText.includes("NVDA");
  }, null, { timeout: 20000 });

  // Columna de evolución presente para la fila (svg con serie o placeholder).
  const evolution = await page.evaluate(() => {
    const table = [...document.querySelectorAll("table")].find((el) => /evoluci/i.test(el.innerText));
    const row = [...table.querySelectorAll("tbody tr")].find((tr) => tr.innerText.includes("NVDA"));
    if (!row) return "sin fila";
    if (row.querySelector("svg path")) return "sparkline";
    if (row.innerText.includes("Serie en construcción")) return "placeholder";
    return "sin columna";
  });
  if (evolution === "sin fila" || evolution === "sin columna") throw new Error(`Evolución: ${evolution}`);

  // Sobrevive a la recarga.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.body.innerText.includes("NVDA"), null, { timeout: 20000 });
}
