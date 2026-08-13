// Listas enseña el RS del ranking semanal y declara de cuándo son los datos.
//
// Dos cosas que faltaban y que el evaluador señaló por separado:
//   · la columna RS salía ausente porque discovery no hidrataba
//     rs_weekly_items, aunque la fila SÍ está en el ranking;
//   · ninguna fecha de la pantalla decía cuál mandaba.
// El payload va simulado a propósito: aquí se comprueba que la pantalla
// enseña lo que la API le da, no que la API tenga datos hoy.
export const name = "listas enseña RS canónico y la fecha que manda";

const ITEMS = [
  { symbol: "AAA", weeklyRsAvailable: true, weeklyRsRating: 91, weeklyRsAsOf: "2026-08-09", weeklyRsSampleSize: 4868 },
  { symbol: "BBB", weeklyRsAvailable: true, weeklyRsRating: 78, weeklyRsAsOf: "2026-08-09", weeklyRsSampleSize: 4868 },
  // Consultado contra el ranking y NO está: ausencia con motivo, nunca el
  // percentil del lote que sí viaja en la fila.
  { symbol: "CCC", weeklyRsAvailable: false, weeklyRsReason: "no está en el ranking semanal", rsGlobalPct: 64 },
].map((extra) => ({
  companyName: `${extra.symbol} Corp`,
  country: "US",
  sector: "Technology",
  industry: "Software",
  theme: "AI Platforms",
  lastDate: "2026-08-12",
  price: 100, sma50: 92, sma200: 80, sma200Slope: 1,
  distance52w: -3, extSma50: 2, perf3m: 20,
  objectiveScore: 82, totalScore: 82, rsQualityScore: 80,
  weinsteinScore: 90, minerviniScore: 90, weaknessScore: 5,
  dataCoverageScore: 95, priceFreshnessDays: 1,
  ...extra,
}));

export async function run({ context, baseUrl }) {
  await context.route("**/api/chart**", (route) => route.abort());
  await context.route("**/api/discovery**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      configured: true,
      source: "scan_results",
      generatedAt: "2026-08-13T05:03:00.000Z",
      dataAsOf: { date: "2026-08-12", latest: "2026-08-12", mixed: false, dates: ["2026-08-12"] },
      rsAsOf: { date: "2026-08-09", sampleSize: 4868 },
      nightly: { found: true, empty: false, localId: "materialized:US:2026-08-13:o0:l5608", rows: 75 },
      inputRows: 3,
      lists: [{ key: "leaders", title: "Score compuesto", items: ITEMS }],
      rows: ITEMS,
      groups: { theme: [], sector: [], industry: [] },
      health: { state: "pass", rows: 3, sourceLabel: "Scan results derivados", note: "" },
    }),
  }));

  const page = await context.newPage();
  await page.goto(`${baseUrl}/lists`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => !!document.querySelector(".listsPage .stockQualityStrip"), null, { timeout: 40000 })
    .catch(() => { throw new Error("la franja de calidad de dato no aparece en Listas"); });

  const franja = await page.evaluate(() => document.querySelector(".listsPage .stockQualityStrip").textContent);
  // La fecha de los datos, no la del cálculo: generatedAt es del 13 y lo que
  // debe leerse es el cierre del 12.
  if (!franja.includes("12 ago 2026")) throw new Error(`la franja no declara el cierre: ${franja}`);
  if (!franja.includes("09 ago 2026") || !franja.includes("4868")) {
    throw new Error(`la franja no declara el corte del RS con su muestra: ${franja}`);
  }
  if (!franja.includes("75") || !franja.includes("5608")) throw new Error(`la franja no declara el universo: ${franja}`);

  const tabla = await page.evaluate(() => {
    const cabeceras = [...document.querySelectorAll(".listsPage table.table thead th")].map((th) => th.textContent.trim());
    const idx = cabeceras.indexOf("RS");
    const filas = [...document.querySelectorAll(".listsPage table.table tbody tr")].map((tr) => {
      const tds = [...tr.querySelectorAll("td")];
      return { ticker: tds[0]?.textContent.trim(), rs: idx >= 0 ? tds[idx]?.textContent.trim() : null };
    });
    return { tieneColumna: idx >= 0, filas };
  });
  if (!tabla.tieneColumna) throw new Error("la tabla de Listas no tiene columna RS");

  const aaa = tabla.filas.find((f) => f.ticker?.startsWith("AAA"));
  const ccc = tabla.filas.find((f) => f.ticker?.startsWith("CCC"));
  if (aaa?.rs !== "91") throw new Error(`AAA debería enseñar el RS semanal 91, enseña "${aaa?.rs}"`);
  // Y el que no está en el ranking no puede caer al percentil del lote: 64
  // es rsGlobalPct, otro número sobre otra población.
  if (ccc?.rs === "64") throw new Error("CCC cayó al percentil del lote en vez de mostrar ausencia");
  if (/\d/.test(ccc?.rs || "")) throw new Error(`CCC debería mostrar ausencia, enseña "${ccc?.rs}"`);
}
