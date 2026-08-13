// Sin escaneo nocturno, Listas lo dice. No enseña otra cosa en su lugar.
//
// El anclaje al último "materialized:US:" evita mezclar mercados, pero abre
// un caso nuevo: que ese escaneo no exista, no haya terminado bien o no haya
// guardado nada. Los tres acaban en "no hay listas", y la pantalla tiene que
// explicar cuál es — un "sin datos" genérico deja al usuario sin saber si el
// mercado no dio nada o si el producto está roto.
export const name = "sin escaneo nocturno, listas explica el motivo en vez de callarlo";

const CASOS = [
  {
    reason: "no-nightly-scan",
    message: "No hay ningún escaneo nocturno del mercado estadounidense guardado. Las listas se construyen solo con esa fuente.",
  },
  {
    reason: "nightly-not-publishable",
    message: "El último escaneo nocturno no terminó correctamente, así que no publica listas.",
  },
  {
    reason: "nightly-read-failed",
    message: "No se ha podido leer el escaneo nocturno ahora mismo.",
  },
];

function absencePayload(caso) {
  return {
    ok: true,
    configured: true,
    source: "nightly_us_unavailable",
    message: caso.message,
    nightly: { found: false, reason: caso.reason },
    inputRows: 0,
    lists: [],
    rows: [],
    groups: { theme: [], sector: [], industry: [] },
    health: { state: "empty", rows: 0, sourceLabel: "Sin escaneo nocturno", note: caso.message },
  };
}

export async function run({ context, baseUrl }) {
  await context.route("**/api/chart**", (route) => route.abort());

  for (const caso of CASOS) {
    await context.route("**/api/discovery**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(absencePayload(caso)),
    }));

    const page = await context.newPage();
    await page.goto(`${baseUrl}/lists`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForFunction(
      (texto) => document.body.textContent.includes(texto),
      caso.message,
      { timeout: 30000 },
    ).catch(() => {
      throw new Error(`[${caso.reason}] la pantalla no explica el motivo`);
    });

    const vista = await page.evaluate(() => ({
      tickers: [...document.querySelectorAll(".listsPage table.table tbody tr td:first-child a.ticker")].map((a) => a.textContent.trim()),
      vacio: !!document.querySelector(".listsEmptyState"),
    }));
    if (!vista.vacio) throw new Error(`[${caso.reason}] no muestra el estado vacío`);
    // Lo importante: no aparece NADA en su lugar. Ni de otro mercado, ni de
    // otra fecha, ni un resto de una lectura anterior.
    if (vista.tickers.length) {
      throw new Error(`[${caso.reason}] enseña ${vista.tickers.length} valores sin escaneo nocturno: ${vista.tickers.slice(0, 5).join(", ")}`);
    }
    await page.close();
    await context.unroute("**/api/discovery**");
  }
}
