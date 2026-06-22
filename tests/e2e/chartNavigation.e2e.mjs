// E2E grafico: la vista rapida debe mantener una ventana manual cuando el
// usuario cambia temporalidad o estilo, y resetear solo cuando lo pide.
export const name = "navegación del gráfico conserva contexto manual";

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function openFirstResultChart(page) {
  const opened = await page.evaluate(() => {
    const row = document.querySelector(".compactResultsTable tbody tr");
    row?.click();
    return Boolean(row);
  });
  if (!opened) throw new Error("No encontré filas del screener para abrir la vista rápida");
  await page.waitForSelector(".quickReviewModal .universalChartCanvas canvas", { timeout: 30000 });
  await page.waitForFunction(() => {
    const state = document.querySelector(".quickReviewModal .universalChartViewState");
    return Boolean(state?.textContent?.trim());
  }, null, { timeout: 10000 });
  await page.waitForSelector('.quickReviewModal [role="group"][aria-label="Temporalidad"] button[aria-label="Temporalidad W"]', { timeout: 10000 });
}

async function chartSnapshot(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".quickReviewModal");
    const state = root?.querySelector(".universalChartViewState");
    const scope = root?.querySelector(".universalChartScopeBadge b");
    const viewport = root?.querySelector(".universalChartViewportRail");
    return {
      stateText: state?.textContent?.replace(/\s+/g, " ").trim() || "",
      stateClass: state?.className || "",
      visibleBars: Number(state?.querySelector("b")?.textContent || NaN),
      scopeText: scope?.textContent?.replace(/\s+/g, " ").trim() || "",
      viewportText: viewport?.textContent?.replace(/\s+/g, " ").trim() || "",
      viewportMode: viewport?.getAttribute("data-view-mode") || "",
      viewportManual: viewport?.getAttribute("data-manual") || "",
      viewportWindow: viewport?.getAttribute("data-window-label") || "",
    };
  });
}

async function waitForManualChartState(page, label) {
  try {
    await page.waitForFunction(() => {
      const state = document.querySelector(".quickReviewModal .universalChartViewState");
      const text = state?.textContent || "";
      const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return Boolean(state) && !normalized.includes("ultimo dato") && !normalized.includes("vista");
    }, null, { timeout: 10000 });
  } catch {
    const snapshot = await chartSnapshot(page);
    throw new Error(`${label}: esperaba vista manual, recibí ${JSON.stringify(snapshot)}`);
  }
}

async function waitForAutoChartState(page, label) {
  try {
    await page.waitForFunction(() => {
      const state = document.querySelector(".quickReviewModal .universalChartViewState");
      const normalized = (state?.textContent || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return normalized.includes("ultimo dato");
    }, null, { timeout: 10000 });
  } catch {
    const snapshot = await chartSnapshot(page);
    throw new Error(`${label}: esperaba vista restaurada al último dato, recibí ${JSON.stringify(snapshot)}`);
  }
}

export async function run({ context, baseUrl, sessionSeed, seedRows }) {
  const seed = sessionSeed({ rows: seedRows() });
  await context.addInitScript((value) => {
    localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(value));
  }, seed);

  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.body.innerText.includes("ALPHA"), null, { timeout: 20000 });
  await openFirstResultChart(page);

  const modal = page.locator(".quickReviewModal");
  await modal.getByRole("button", { name: "Acercar gráfico" }).click();
  await waitForManualChartState(page, "Tras hacer zoom");

  await page.waitForFunction(() => {
    const button = document.querySelector('.quickReviewModal button[aria-label="Mover ventana hacia el historial"]');
    return Boolean(button && !button.disabled);
  }, null, { timeout: 10000 });
  await modal.getByRole("button", { name: "Mover ventana hacia el historial" }).click();
  await waitForManualChartState(page, "Tras desplazarse a historial");

  const beforeIntervalChange = await chartSnapshot(page);
  if (!/historial|zoom/i.test(normalizeText(beforeIntervalChange.stateText))) {
    throw new Error(`El gráfico no entró en vista manual antes de cambiar temporalidad: ${JSON.stringify(beforeIntervalChange)}`);
  }

  await modal.getByRole("button", { name: "Temporalidad W" }).click();
  await page.waitForFunction(() => {
    const scope = document.querySelector(".quickReviewModal .universalChartScopeBadge b")?.textContent || "";
    return /·\s*W\b/.test(scope);
  }, null, { timeout: 10000 });
  await waitForManualChartState(page, "Tras cambiar de diario a semanal");

  const afterIntervalChange = await chartSnapshot(page);
  if (!/1A\s*·\s*W/.test(afterIntervalChange.scopeText)) {
    throw new Error(`La temporalidad semanal no quedó reflejada en el gráfico: ${JSON.stringify(afterIntervalChange)}`);
  }
  if (afterIntervalChange.viewportManual !== "true" || !afterIntervalChange.viewportWindow || /sin ventana/i.test(afterIntervalChange.viewportWindow)) {
    throw new Error(`El gráfico no expuso una ventana manual estable tras cambiar temporalidad: ${JSON.stringify(afterIntervalChange)}`);
  }

  await modal.locator('select[aria-label="Tipo de grafico"]').selectOption("8");
  await waitForManualChartState(page, "Tras cambiar de velas a línea");

  await modal.getByRole("button", { name: "Restaurar rango seleccionado" }).click();
  await waitForAutoChartState(page, "Tras restaurar rango");
}
