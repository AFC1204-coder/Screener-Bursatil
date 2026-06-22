// E2E filtros: sobre una sesión restaurada de 3 filas (US/DE/FR), el filtro de
// vista por país reduce la tabla sin tocar la red, y volver a "Todos" la restaura.
export const name = "filtros de vista sobre resultados restaurados";

async function visibleSymbols(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    return ["ALPHA", "BETA.DE", "GAMMA.PA"].filter((symbol) => text.includes(symbol));
  });
}

export async function run({ context, baseUrl, sessionSeed, seedRows }) {
  const seed = sessionSeed({ rows: seedRows() });
  await context.addInitScript((value) => {
    localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(value));
  }, seed);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.body.innerText.includes("GAMMA.PA"), null, { timeout: 20000 });
  const before = await visibleSymbols(page);
  if (before.length !== 3) throw new Error(`Esperaba 3 filas restauradas, hay ${before.length}`);

  // Localizar el select de país (tiene una opción para Alemania/DE) y filtrar.
  const selected = await page.evaluate(() => {
    const selects = [...document.querySelectorAll("select")];
    for (const select of selects) {
      const option = [...select.options].find((item) => /alemania|^DE$|País: Alemania/i.test(item.textContent.trim()));
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return option.textContent.trim();
      }
    }
    return null;
  });
  if (!selected) throw new Error("No encontré el filtro de país con opción Alemania");
  await page.waitForFunction(() => !document.body.innerText.includes("GAMMA.PA"), null, { timeout: 10000 });
  const after = await visibleSymbols(page);
  if (!(after.includes("BETA.DE") && !after.includes("ALPHA") && !after.includes("GAMMA.PA"))) {
    throw new Error(`Filtro país dejó: ${after.join(",")}`);
  }

  // Volver a Todos: las 3 filas regresan (el filtro de vista no destruye resultados).
  await page.evaluate(() => {
    const selects = [...document.querySelectorAll("select")];
    for (const select of selects) {
      const option = [...select.options].find((item) => /país: todos|^todos$/i.test(item.textContent.trim()));
      if (option && [...select.options].some((item) => /alemania/i.test(item.textContent))) {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
    }
  });
  await page.waitForFunction(() => document.body.innerText.includes("GAMMA.PA"), null, { timeout: 10000 });
  const restored = await visibleSymbols(page);
  if (restored.length !== 3) throw new Error(`Tras quitar el filtro hay ${restored.length} filas`);
}
