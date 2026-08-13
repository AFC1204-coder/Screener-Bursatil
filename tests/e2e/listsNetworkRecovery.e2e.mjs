// Listas debe RECUPERARSE de un fallo de red, no quedarse colgada.
//
// Regresión concreta (2026-08-13): app/lists/page.jsx usaba
// userFacingServiceError en el catch del efecto de discovery sin haberlo
// importado. Al fallar la red, el propio manejador de errores lanzaba
// ReferenceError: el .finally() nunca corría, discoveryLoading se quedaba en
// true y la página se quedaba diciendo "..." para siempre, sin explicar nada.
// El fallo solo aparecía cuando la red fallaba de verdad — ningún test
// unitario lo veía, y el repo no tiene linter que cazara el identificador
// libre (ver docs/migracion-listas-2026-08-13.md §4.1).
export const name = "listas se recupera de un fallo de red sin quedarse colgada";

const row = {
  symbol: "LNR",
  companyName: "Lists Network Recovery",
  country: "US",
  sector: "Technology",
  industry: "Software",
  theme: "AI Platforms",
  price: 100,
  sma50: 92,
  sma200: 80,
  sma200Slope: 1,
  distance52w: -3,
  objectiveScore: 82,
  totalScore: 82,
  rsGlobalPct: 72,
  weaknessScore: 12,
};

// Se evalúa dentro del navegador: lee el KPI cuyo rótulo coincide.
const KPI_VALUE = `(label) => {
  const kpi = [...document.querySelectorAll(".listsPage .kpi")]
    .find((node) => node.querySelector("span")?.textContent?.trim() === label);
  return kpi?.querySelector("b")?.textContent?.trim() ?? "";
}`;

export async function run({ context, baseUrl }) {
  // La red se cae de verdad: abort, no un 500 simulado. Es el camino que
  // reventaba, porque produce "Failed to fetch" y entra por el catch.
  await context.route("**/api/discovery**", (route) => route.abort());
  await context.route("**/api/chart**", (route) => route.abort());
  await context.addInitScript((payload) => {
    localStorage.setItem("statsedge.scans.v1", JSON.stringify([payload.scan]));
  }, {
    scan: {
      id: "lists-network-recovery-scan",
      name: "Lists network recovery scan",
      createdAt: "2026-08-12T08:00:00.000Z",
      rows: [row],
    },
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));

  await page.goto(`${baseUrl}/lists`, { waitUntil: "domcontentloaded", timeout: 90000 });

  // 1. El motivo llega traducido. Con el bug esto nunca ocurría: el catch
  //    reventaba en la propia llamada que compone el mensaje, así que
  //    discoveryError se quedaba vacío para siempre.
  await page.waitForFunction(
    () => document.body.textContent.includes("No se pudo conectar con el servidor de datos"),
    null,
    { timeout: 30000 },
  );

  // 2. Y deja de cargar, cayendo a la copia local en vez de afirmar que los
  //    datos están al día. Con el bug el .finally() no corría y el KPI se
  //    quedaba en "..." indefinidamente.
  //    Se espera a la condición final —no a "cualquier cosa que no sea
  //    ..."— porque entre el montaje y el arranque del efecto hay un render
  //    intermedio que ya dice "Datos guardados" y daría un falso verde.
  await page.waitForFunction(
    (code) => eval(code)("fuente rankings") === "Datos guardados",
    KPI_VALUE,
    { timeout: 30000 },
  );

  // 3. Y se queda así: recuperada, no de paso hacia un estado colgado.
  await page.waitForTimeout(1500);
  const settled = await page.evaluate((code) => eval(code)("fuente rankings"), KPI_VALUE);
  if (settled !== "Datos guardados") {
    throw new Error(`La fuente no se estabilizó en "Datos guardados": quedó en "${settled}"`);
  }

  // 4. El manejador de errores no puede ser el que rompa la página.
  const referenceErrors = pageErrors.filter((message) => /is not defined|ReferenceError/i.test(message));
  if (referenceErrors.length) {
    throw new Error(`ReferenceError durante el fallo de red: ${referenceErrors.join(" | ")}`);
  }

  // 5. Sin filtrar el texto crudo del navegador a la pantalla.
  const leaked = await page.evaluate(() => document.body.textContent);
  if (/Failed to fetch|TypeError/i.test(leaked)) {
    throw new Error("El texto crudo del error de red llegó a la pantalla");
  }
}
