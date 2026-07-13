// scripts/e2e/auditV1Block2.mjs
//
// Verificación visual POST-migración de color (Bloque 2 — auditoría v1):
// 135 sustituciones 1:1 literales v1 → tokens v2 en styles/components.css.
// Esta tarea es SOLO de captura y reporte. No modifica código.
//
// Uso:
//   npm run dev  (en otra terminal)
//   node --env-file=.env.local --import ./scripts/refactor-check/register.mjs \
//        scripts/e2e/auditV1Block2.mjs
//
// Salida: PNGs en output/playwright/audit-v1-block2-*.png

import { chromium } from "playwright";
import { createHmac } from "crypto";
import { mkdirSync } from "node:fs";
import { buildResearchRow } from "@/lib/researchRow";
import { stage2Bars, stage4Bars } from "../../tests/fixtures.js";

const BASE_URL = process.env.STATSEDGE_E2E_BASE_URL || "http://127.0.0.1:3000";
const OUT_DIR = "output/playwright";
mkdirSync(OUT_DIR, { recursive: true });

function signedSessionCookie(now = Date.now()) {
  const secret = String(
    process.env.STATSEDGE_SESSION_SECRET || process.env.STATSEDGE_ACCESS_TOKEN || ""
  ).trim();
  if (!secret) throw new Error("Falta STATSEDGE_SESSION_SECRET / STATSEDGE_ACCESS_TOKEN");
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
  const payload = `v1.${expiresAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function buildRow(symbol, bars, profile, override = {}) {
  const base = buildResearchRow(symbol, { bars }, profile, { requireLongHistory: false }, {});
  return { ...base, ...override };
}

function seedScreenerRows() {
  const profile = (name) => ({
    name,
    sector: "Technology",
    industry: "Semiconductors",
    marketCap: 5_000_000_000,
    growthMetrics: { revenueGrowth: 25, earningsGrowth: 30 },
  });
  const alpha = buildRow("ALPHA", stage2Bars(), profile("ALPHA Inc"), {
    rsGlobalPct: 92, rsRating: 88, rsCountryPct: 88, rsSectorPct: 88, ticker: "ALPHA",
  });
  const beta = buildRow("BETA", stage2Bars(), profile("BETA Corp"), {
    rsGlobalPct: 55, rsRating: 60, rsCountryPct: 60, rsSectorPct: 60, ticker: "BETA",
  });
  const gamma = buildRow("GAMMA", stage4Bars(), profile("GAMMA Inc"), {
    rsGlobalPct: 20, rsRating: 22, rsCountryPct: 22, rsSectorPct: 22, ticker: "GAMMA",
  });
  return [alpha, beta, gamma];
}

function sessionSeed(rows) {
  return {
    version: 4,
    presetKey: "broad",
    markets: ["US"],
    manual: "",
    universe: ["ALPHA", "BETA", "GAMMA"],
    universeScope: "US::",
    rows,
    analyzedRows: rows,
    scanContext: {
      id: "audit-v1-block2",
      symbolsCount: rows.length,
      baseCount: rows.length,
      providerErrors: [],
      scannedAt: new Date().toISOString(),
    },
    settings: {},
    scanMode: "all",
    status: "Listo",
  };
}

// Construye un payload de company-brief que produzca un tradePlanStatus concreto.
// mode: "extended" (>8), "ready" ([-3, 3]), "below" (<-3).
// También setea setupDisplay* para que methodologyDisplayForRow considere el plan elegible.
function buildFakeCompanyBrief(symbol, mode = "extended") {
  const distanceToPivotPct = mode === "extended" ? 12 : mode === "ready" ? 1 : mode === "below" ? -5 : 12;
  return {
    ok: true,
    symbol,
    name: `${symbol} Inc.`,
    sector: "Technology",
    industry: "Semiconductors",
    country: "US",
    currency: "USD",
    exchange: "NASDAQ",
    quote: { price: 100 + distanceToPivotPct, currency: "USD" },
    setupPattern: {
      available: true,
      distanceToPivotPct,
      pivotPrice: 100,
      pivotClarityScore: 70,
      structureScore: 80,
      verdict: "stage-2-advanced",
      structure: "consolidation-base",
      consolidationCandidate: true,
      contractionCount: 3,
    },
    // Campos leídos por methodologyDisplayForRow vía storedDisplay/mergedRow
    setupDisplayKey: "actionable_vcp",
    setupDisplayState: "actionable",
    setupDisplayLabel: "VCP plan válido",
    setupDisplayShortLabel: "Plan válido",
    setupDisplayReason: "Estructura accionable con pivote claro",
    setupDisplayActionable: true,
    setupDisplayTradePlanEligible: true,
    setupDisplayBlocksPatternClaim: false,
    setupDisplayStrict: true,
    chartBars: [],
    historyCoverage: { years: 5, complete: true },
  };
}

async function captureFullPage(page, name) {
  await page.screenshot({ path: `${OUT_DIR}/${name}`, fullPage: false });
  console.log(`✓ ${name}`);
}

async function captureElement(page, selector, name, padding = 30) {
  const el = page.locator(selector).first();
  if (!(await el.count())) {
    console.log(`· ${selector} no presente — omitiendo ${name}`);
    return null;
  }
  let box;
  try { box = await el.boundingBox(); } catch { box = null; }
  if (!box || box.width === 0 || box.height === 0) {
    try { await el.scrollIntoViewIfNeeded({ timeout: 2000 }); box = await el.boundingBox(); } catch {}
  }
  if (!box || box.width === 0 || box.height === 0) {
    console.log(`· ${selector} sin bounding box válido — omitiendo ${name}`);
    return null;
  }
  const vp = page.viewportSize() || { width: 1600, height: 1200 };
  // Si el elemento está fuera del viewport (y < 0 o y+height > vp.height), usa scrollIntoView primero.
  if (box.y < 0 || box.y + box.height > vp.height - 20) {
    try { await el.scrollIntoViewIfNeeded({ timeout: 3000 }); box = await el.boundingBox(); } catch {}
  }
  const clip = {
    x: Math.max(0, box.x - padding),
    y: Math.max(0, box.y - padding),
    width: Math.min(vp.width, box.width + padding * 2),
    height: Math.min(vp.height, box.height + padding * 2),
  };
  if (clip.width <= 0 || clip.height <= 0) {
    console.log(`· ${selector} clip vacío (${JSON.stringify(clip)}) — omitiendo ${name}`);
    return null;
  }
  await page.screenshot({ path: `${OUT_DIR}/${name}`, clip });
  console.log(`✓ ${name}`);
  return el;
}

async function dumpComputedColors(page, selector) {
  const el = page.locator(selector).first();
  if (!(await el.count())) return null;
  return el.evaluate((node) => {
    const cs = getComputedStyle(node);
    return { className: node.className, color: cs.color, background: cs.backgroundColor, border: cs.borderColor };
  });
}

const browser = await chromium.launch();

// ---------- 1. Screener ----------
{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
  await context.addCookies([{ name: "statsedge_session", value: signedSessionCookie(), domain: "127.0.0.1", path: "/" }]);
  const page = await context.newPage();
  const rows = seedScreenerRows();
  await page.addInitScript((seed) => {
    window.localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(seed));
  }, sessionSeed(rows));

  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".desktopResultsSection", { timeout: 25_000 });
  await page.waitForTimeout(1000);

  await captureFullPage(page, "audit-v1-block2-01-screener-initial.png");

  // .btnPrimary en estado normal (sin hover)
  await captureElement(page, ".btnPrimary", "audit-v1-block2-05-btnprimary.png");

  // Abre Quick Review Modal clicando "Revisar" (botón btnPrimary visible en results header) → expone .reviewQueueSummaryChip en varios tones
  const reviewBtn = page.locator(".desktopResultsSection button.btnPrimary:has-text('Revisar')").first();
  if (await reviewBtn.count()) {
    await reviewBtn.click({ timeout: 5_000, force: true });
    await page.waitForTimeout(900);
    await captureFullPage(page, "audit-v1-block2-02a-screener-quickreview.png");
    await captureElement(page, ".reviewQueueSummary", "audit-v1-block2-02b-screener-quickreview-chips.png");
    // Recorre cada chip de la primera rail y captura su computed style
    const chipInfo = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".reviewQueueSummaryChip")).slice(0, 10).map((el) => {
        const cs = getComputedStyle(el);
        return { className: el.className, color: cs.color, background: cs.backgroundColor, border: cs.borderColor, text: el.textContent.trim().slice(0, 30) };
      });
    });
    console.log("   .reviewQueueSummaryChip computed:");
    for (const c of chipInfo) console.log(`     ${JSON.stringify(c)}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  } else {
    console.log("· botón 'Revisar' (btnPrimary) no visible");
  }

  await context.close();
}

// ---------- 2. Ticker con .tradePlanStatus (3 modes: extended, ready, below) ----------
// El panel .tradePlanStatus requiere que el gate de elegibilidad esté abierto. En el dev actual,
// los tickers reales no tienen setup plan-elegible, y el SSR provee initialData (lo que evita que
// el cliente refetch /api/company-brief). Por tanto la verificación visual de los tones se hace
// inyectando manualmente los tres spans con cada tone y capturando su computed style.
{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
  await context.addCookies([{ name: "statsedge_session", value: signedSessionCookie(), domain: "127.0.0.1", path: "/" }]);
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/stock/AAPL`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // Inyecta tres badges .tradePlanStatus (ready/below/extended) DENTRO de .stockPage,
  // porque las reglas están scoped a `.stockPage .tradePlanStatus.*` (línea 9389+ de components.css).
  await page.evaluate(() => {
    const stockPage = document.querySelector(".stockPage") || document.body;
    const host = document.createElement("div");
    host.id = "audit-tps-host";
    Object.assign(host.style, {
      margin: "24px 0", display: "flex", flexDirection: "column", gap: "12px",
      background: "rgba(23, 41, 31, 0.95)", padding: "16px",
      border: "1px solid rgba(237, 232, 218, 0.26)", borderRadius: "8px",
      maxWidth: "420px",
    });
    const title = document.createElement("strong");
    title.textContent = "Audit v1 — block 2 · TPS tones (injected)";
    title.style.color = "rgb(237, 232, 218)";
    title.style.fontSize = "12px";
    host.appendChild(title);
    const variants = [
      { tone: "ready", label: "Zona pivot" },
      { tone: "below", label: "Bajo pivot" },
      { tone: "extended", label: "Sobre pivot" },
    ];
    for (const v of variants) {
      const span = document.createElement("span");
      span.className = `tradePlanStatus ${v.tone}`;
      span.textContent = v.label;
      host.appendChild(span);
    }
    stockPage.appendChild(host);
    host.scrollIntoView();
  });
  await page.waitForTimeout(400);

  await captureFullPage(page, "audit-v1-block2-04a-stock-tps-injected.png");
  await captureElement(page, "#audit-tps-host", "audit-v1-block2-04b-stock-tps-injected-isolated.png", 12);

  for (const tone of ["ready", "below", "extended"]) {
    const info = await page.evaluate((t) => {
      const el = document.querySelector(`.tradePlanStatus.${t}`);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { className: el.className, color: cs.color, background: cs.backgroundColor, border: cs.borderColor, text: el.textContent };
    }, tone);
    console.log(`   .tradePlanStatus.${tone}: ${JSON.stringify(info)}`);
  }

  await context.close();
}

// ---------- 3. Review con .reviewDecisionPanel ----------
{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
  await context.addCookies([{ name: "statsedge_session", value: signedSessionCookie(), domain: "127.0.0.1", path: "/" }]);
  const page = await context.newPage();

  const rows = seedScreenerRows();
  await page.addInitScript((seed) => {
    // Sembramos tanto screenerSession como review (review lee `statsedge.review.v1`)
    window.localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(seed));
    window.localStorage.setItem("statsedge.review.v1", JSON.stringify({
      version: 1,
      activeSettings: {},
      rows: seed.rows.map((r) => ({
        symbol: r.symbol || r.ticker,
        name: r.name,
        sector: r.sector,
        industry: r.industry,
        country: r.country || "US",
        quote: r.quote || { price: 100, currency: "USD" },
        fundamentals: r.fundamentals || {},
        scoreComposite: r.scoreComposite,
        decision: r.decision,
        marketCap: r.marketCap,
        readiness: r.readiness,
      })),
    }));
  }, sessionSeed(rows));

  await page.goto(`${BASE_URL}/review`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3_000);

  await captureFullPage(page, "audit-v1-block2-06-review.png");

  const counts = await page.evaluate(() => ({
    reviewQueueSummaryChip: document.querySelectorAll(".reviewQueueSummaryChip").length,
    reviewDecisionPanel: document.querySelectorAll(".reviewDecisionPanel").length,
    reviewResolveRail: document.querySelectorAll(".reviewResolveRail button").length,
    reviewDecisionEvidence: document.querySelectorAll(".reviewDecisionEvidence").length,
    decisionTraceChip: document.querySelectorAll(".decisionTraceChip").length,
    reviewQueueSummary: document.querySelectorAll(".reviewQueueSummary").length,
  }));
  console.log(`   /review counts: ${JSON.stringify(counts)}`);

  await captureElement(page, ".reviewQueueSummary", "audit-v1-block2-06b-review-summary.png");
  await captureElement(page, ".reviewDecisionPanel", "audit-v1-block2-06c-review-decision-panel.png");
  await captureElement(page, ".reviewResolveRail", "audit-v1-block2-06d-review-resolve-rail.png");

  // Dump computed styles de los chips
  const chipInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".reviewQueueSummaryChip")).slice(0, 15).map((el) => {
      const cs = getComputedStyle(el);
      return { className: el.className, color: cs.color, background: cs.backgroundColor, border: cs.borderColor, text: el.textContent.trim().slice(0, 30) };
    });
  });
  console.log("   /review .reviewQueueSummaryChip computed:");
  for (const c of chipInfo) console.log(`     ${JSON.stringify(c)}`);

  await context.close();
}

// ---------- 4. Mobile con .bottomNav ----------
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  await context.addCookies([{ name: "statsedge_session", value: signedSessionCookie(), domain: "127.0.0.1", path: "/" }]);
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottomNav", { timeout: 15_000 });
  await page.waitForTimeout(800);

  await captureFullPage(page, "audit-v1-block2-07-mobile-bottomnav.png");
  await captureElement(page, ".bottomNav", "audit-v1-block2-07b-mobile-bottomnav-isolated.png", 20);

  const navItems = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".bottomNav .navItem")).map((el) => {
      const cs = getComputedStyle(el);
      return { className: el.className, color: cs.color, background: cs.backgroundColor };
    });
  });
  console.log("   .bottomNav .navItem computed:");
  for (const c of navItems) console.log(`     ${JSON.stringify(c)}`);

  await context.close();
}

// ---------- 5. Desktop con .appTopBar ----------
{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
  await context.addCookies([{ name: "statsedge_session", value: signedSessionCookie(), domain: "127.0.0.1", path: "/" }]);
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".appTopBar", { timeout: 15_000 });
  await page.waitForTimeout(800);

  await captureElement(page, ".appTopBar", "audit-v1-block2-08-desktop-topbar-isolated.png", 20);
  await captureElement(page, ".appHeaderNavItem.active", "audit-v1-block2-08b-desktop-topbar-active.png", 12);

  const topbar = await dumpComputedColors(page, ".appTopBar");
  console.log(`   .appTopBar: ${JSON.stringify(topbar)}`);
  const navActive = await dumpComputedColors(page, ".appHeaderNavItem.active");
  console.log(`   .appHeaderNavItem.active: ${JSON.stringify(navActive)}`);

  await context.close();
}

// ---------- 6. Sanity check de tokens y reglas ----------
{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  await context.addCookies([{ name: "statsedge_session", value: signedSessionCookie(), domain: "127.0.0.1", path: "/" }]);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  const tokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      "--bg": root.getPropertyValue("--bg").trim(),
      "--surface2": root.getPropertyValue("--surface2").trim(),
      "--decision-vigilar": root.getPropertyValue("--decision-vigilar").trim(),
      "--risk": root.getPropertyValue("--risk").trim(),
      "--senal": root.getPropertyValue("--senal").trim(),
      "--senal-dim": root.getPropertyValue("--senal-dim").trim(),
      "--oxido-dim": root.getPropertyValue("--oxido-dim").trim(),
      "--tiza": root.getPropertyValue("--tiza").trim(),
      "--text": root.getPropertyValue("--text").trim(),
    };
  });
  console.log("\n=== Tokens resueltos en runtime ===");
  for (const [k, v] of Object.entries(tokens)) console.log(`  ${k} = ${v}`);

  const selectorCheck = await page.evaluate(() => {
    function ruleMatches(re) {
      return Array.from(document.styleSheets).some((sheet) => {
        try { return Array.from(sheet.cssRules || []).some((r) => re.test(r.cssText || "")); } catch { return false; }
      });
    }
    return {
      hasStatusLEDGreen: ruleMatches(/statusLED\.green\s*\{[^}]*var\(--decision-vigilar\)/),
      hasStatusLEDYellow: ruleMatches(/statusLED\.yellow\s*\{[^}]*var\(--risk\)/),
      hasStatusLEDRed: ruleMatches(/statusLED\.red\s*\{[^}]*var\(--risk\)/),
      hasProviderBadgeYellow: ruleMatches(/providerBadge\.yellow\s*\{[^}]*var\(--senal-dim\)/),
      hasTradePlanStatusExtended: ruleMatches(/tradePlanStatus\.extended\s*\{[^}]*var\(--risk\)/),
      hasReviewDecisionPanelWarn: ruleMatches(/reviewDecisionPanel\.warn[^}]{0,200}var\(--senal-dim\)/),
      hasBtnPrimary: ruleMatches(/\.btnPrimary\s*\{/),
      hasInfoHintWarn: ruleMatches(/infoHint\.warn\s*\{[^}]*var\(--senal\)/),
    };
  });
  console.log("\n=== Reglas migradas en CSS ===");
  console.log(JSON.stringify(selectorCheck, null, 2));

  await context.close();
}

await browser.close();
console.log("\n✓ Captura completada. Salidas en output/playwright/audit-v1-block2-*");
process.exit(0);