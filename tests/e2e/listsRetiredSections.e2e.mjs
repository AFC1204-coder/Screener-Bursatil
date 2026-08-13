// Las tres listas retiradas no se pintan NI SIQUIERA cuando discovery las
// devuelve llenas de filas.
//
// El payload de este test da 3 filas a cada una de las nueve listas, así que
// un fallo aquí significa que alguien las devolvió a la vista. Antes de
// tocarlo, leer RETIRED_LIST_SECTIONS en app/lists/page.jsx: cada entrada
// dice qué tendría que ser cierto para devolverla. Ninguna se retiró por
// estar vacía —las tres sacaban filas el día que se fueron—, así que "ahora
// sí salen filas" no es motivo para reactivarlas.
export const name = "listas retiradas no se pintan aunque discovery las devuelva llenas";

const RETIRADAS = ["Deterioro técnico", "IPO / New Leaders", "Vigilancia pivot"];
const VISIBLES = [
  "Score compuesto",
  "RS Quality Leaders",
  "Tendencia establecida",
  "Rupturas con contracción",
  "Extended but strong",
  "Pullback to SMA50",
];

function item(symbol, extra = {}) {
  return {
    symbol,
    companyName: `${symbol} Corp`,
    country: "US",
    sector: "Technology",
    industry: "Software",
    theme: "AI Platforms",
    lastDate: "2026-08-12",
    price: 100,
    sma50: 92,
    sma200: 80,
    sma200Slope: 1,
    distance52w: -3,
    extSma50: 2,
    perf3m: 20,
    objectiveScore: 82,
    totalScore: 82,
    rsGlobalPct: 80,
    rsQualityScore: 80,
    weinsteinScore: 90,
    minerviniScore: 90,
    weaknessScore: 5,
    dataCoverageScore: 95,
    priceFreshnessDays: 1,
    ...extra,
  };
}

const LISTAS = [
  { key: "leaders", title: "Score compuesto" },
  { key: "rsQuality", title: "RS Quality Leaders" },
  { key: "weakness", title: "Deterioro técnico", extra: { weaknessScore: 90 } },
  { key: "weinstein", title: "Tendencia establecida" },
  { key: "minervini", title: "Rupturas con contracción" },
  { key: "nearPivot", title: "Vigilancia pivot", extra: { distanceToPivotPct: -1 } },
  { key: "ipo", title: "IPO / New Leaders", extra: { ipoAgeMonths: 12, ipoScore: 70 } },
  { key: "extended", title: "Extended but strong", extra: { extSma50: 20, objectiveScore: 75 } },
  { key: "pullback", title: "Pullback to SMA50" },
];

export async function run({ context, baseUrl }) {
  const lists = LISTAS.map((spec) => ({
    key: spec.key,
    title: spec.title,
    items: [1, 2, 3].map((n) => item(`${spec.key.toUpperCase()}${n}`, spec.extra)),
  }));
  await context.route("**/api/discovery**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      configured: true,
      source: "scan_results",
      generatedAt: "2026-08-13T05:03:00.000Z",
      inputRows: 27,
      lists,
      rows: lists.flatMap((list) => list.items),
      groups: { theme: [], sector: [], industry: [] },
      health: { state: "pass", rows: 27, sourceLabel: "Scan results derivados", note: "" },
    }),
  }));
  await context.route("**/api/chart**", (route) => route.abort());

  const page = await context.newPage();
  await page.goto(`${baseUrl}/lists`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => document.body.textContent.includes("Score compuesto"), null, { timeout: 40000 });
  await page.waitForTimeout(3000);

  const visto = await page.evaluate(() => ({
    titulos: [...document.querySelectorAll(".listsPage .listDisclosure .sectionTitle h2")].map((h) => h.textContent.trim()),
    // Los tickers sembrados llevan el nombre de su lista, así que si una fila
    // de una lista retirada se colara en otra sección, se vería.
    tickers: [...document.querySelectorAll(".listsPage table.table tbody tr td:first-child a.ticker")].map((a) => a.textContent.trim()),
  }));

  const retiradasVisibles = RETIRADAS.filter((titulo) => visto.titulos.includes(titulo));
  if (retiradasVisibles.length) {
    throw new Error(`Listas retiradas de vuelta en la vista: ${retiradasVisibles.join(", ")}`);
  }
  const faltan = VISIBLES.filter((titulo) => !visto.titulos.includes(titulo));
  if (faltan.length) {
    throw new Error(`Faltan secciones que sí deben verse: ${faltan.join(", ")}`);
  }
  const colados = visto.tickers.filter((t) => /^(WEAKNESS|IPO|NEARPIVOT)\d$/.test(t));
  if (colados.length) {
    throw new Error(`Filas de listas retiradas visibles en otra sección: ${[...new Set(colados)].join(", ")}`);
  }
}
