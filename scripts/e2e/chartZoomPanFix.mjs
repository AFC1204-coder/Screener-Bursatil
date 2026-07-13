// Verificación E2E del fix de zoom/pan en UniversalPriceChart.
// Ejecuta gestos reales contra el dev server, captura el log de logical range
// por evento (`?chartlog=1`) y reporta si la respuesta es fluida y monotónica.
//
// Salida: imprime resumen de eventos por gesto + veredictos de validación.
// Exit 0 si pasa, 1 si detecta regresión.
import { chromium } from "playwright";

const BASE_URL = "http://127.0.0.1:3000";
const SYMBOL = "AAPL";

const log = [];
let currentGesture = null;

function attachLogSink(page) {
  page.on("console", (msg) => {
    const text = msg.text();
    if (!text.startsWith("[chart-logical-range]")) return;
    const match = /\[chart-logical-range\]\s+([\d.]+)\s+(\{.*\})/.exec(text);
    if (!match) return;
    const [, ts, range] = match;
    if (!currentGesture) return;
    currentGesture.events.push({ ts: Number(ts), range: JSON.parse(range) });
  });
}

function newGesture(name) {
  if (currentGesture) log.push(currentGesture);
  currentGesture = { name, events: [], startedAt: Date.now() };
}

function finishGesture() {
  if (currentGesture) {
    log.push(currentGesture);
    currentGesture = null;
  }
}

function summarizeGesture(g) {
  const r = (e) => e.range;
  const first = r(g.events[0]);
  const last = r(g.events.at(-1));
  const spanFirst = first ? first.to - first.from : 0;
  const spanLast = last ? last.to - last.from : 0;
  const fromDelta = last && first ? last.from - first.from : 0;
  const toDelta = last && first ? last.to - first.to : 0;
  const tsFirst = g.events[0]?.ts ?? 0;
  const tsLast = g.events.at(-1)?.ts ?? 0;
  return {
    name: g.name,
    nEvents: g.events.length,
    durationMs: Math.round(tsLast - tsFirst),
    spanFirst,
    spanLast,
    fromDelta,
    toDelta,
  };
}

// Heurística de regresión: cada evento debe avanzar el rango en la MISMA
// dirección del gesto del usuario. Contamos inversiones de signo seguidas.
function detectOscillation(g) {
  if (g.events.length < 4) return 0;
  let flips = 0;
  let prev = null;
  for (const ev of g.events) {
    const mid = (ev.range.from + ev.range.to) / 2;
    if (prev != null) {
      const diff = mid - prev;
      if (prev !== 0 && Math.sign(diff) !== Math.sign(prev) && Math.abs(diff) > 0.01 && Math.abs(prev) > 0.01) {
        flips += 1;
      }
      prev = diff;
    } else {
      prev = 0;
    }
  }
  return flips;
}

async function waitForChart(page) {
  await page.waitForSelector(".universalChartCanvas canvas", { timeout: 30_000 });
  await page.waitForTimeout(800);
}

async function getCanvasBox(page) {
  return await page.evaluate(() => {
    const el = document.querySelector(".universalChartCanvas canvas");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

async function panDrag(page, box, dx, dy) {
  const startX = box.x + box.w * 0.6;
  const startY = box.y + box.h * 0.5;
  const steps = 10;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(startX - (dx * i) / steps, startY - (dy * i) / steps, { steps: 1 });
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
}

async function zoomWheel(page, box, dyTotal) {
  const cx = box.x + box.w * 0.5;
  const cy = box.y + box.h * 0.5;
  await page.mouse.move(cx, cy);
  const steps = 5;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.wheel(0, (dyTotal * i) / steps);
    await page.waitForTimeout(40);
  }
}

async function changeRangeTo(page, label) {
  const button = page.locator(`.universalChartScopeBadge:has-text("${label}")`).first();
  // El ScopeBadge no es clickable; hay botones en ChartPreferences.
  // Buscamos por el texto dentro del componente de preferencias.
  const alt = page.locator(`button:has-text("${label}"), [role="button"]:has-text("${label}")`).first();
  try {
    await alt.scrollIntoViewIfNeeded({ timeout: 4000 });
    await alt.click({ timeout: 4000 });
  } catch {
    try {
      await button.click({ timeout: 2000 });
    } catch {}
  }
  await page.waitForTimeout(400);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  attachLogSink(page);

  console.log(`→ Cargando ${BASE_URL}/stock/${SYMBOL}?chartlog=1`);
  const nav = await page.goto(`${BASE_URL}/stock/${SYMBOL}?chartlog=1`, { waitUntil: "domcontentloaded" });
  console.log(`  status=${nav?.status()}`);
  await waitForChart(page);
  const box = await getCanvasBox(page);
  console.log(`  canvas box=${JSON.stringify(box)}`);

  // Gesto 1: pan drag hacia la izquierda
  newGesture("pan-left");
  await panDrag(page, box, 200, 0);
  await page.waitForTimeout(400);
  finishGesture();

  // Gesto 2: pan drag hacia la derecha
  newGesture("pan-right");
  await panDrag(page, box, -200, 0);
  await page.waitForTimeout(400);
  finishGesture();

  // Gesto 3: zoom out (wheel positivo hacia abajo = alejar en comportamiento por defecto)
  newGesture("zoom-out-wheel");
  await zoomWheel(page, box, 400);
  await page.waitForTimeout(400);
  finishGesture();

  // Gesto 4: zoom in (wheel negativo hacia arriba)
  newGesture("zoom-in-wheel");
  await zoomWheel(page, box, -400);
  await page.waitForTimeout(400);
  finishGesture();

  // Gesto 5: cambio de rango 1M -> 1A
  newGesture("range-change-1A");
  try {
    const alt = page.locator('button:has-text("1A"), [role="button"]:has-text("1A")').first();
    await alt.scrollIntoViewIfNeeded({ timeout: 4000 });
    await alt.click({ timeout: 4000 });
    await page.waitForTimeout(700);
  } catch (e) {
    console.log(`  [range 1A] no encontrado: ${e.message}`);
  }
  finishGesture();

  // Gesto 6: zoom/pan inmediato tras cambio de rango
  newGesture("pan-left-after-range-change");
  await panDrag(page, box, 150, 0);
  await page.waitForTimeout(400);
  finishGesture();

  // Gesto 7: cambio de intervalo D -> 1H
  newGesture("interval-change-1H");
  try {
    const alt = page.locator('button:has-text("1H"), [role="button"]:has-text("1H")').first();
    await alt.scrollIntoViewIfNeeded({ timeout: 4000 });
    await alt.click({ timeout: 4000 });
    await page.waitForTimeout(700);
  } catch (e) {
    console.log(`  [interval 1H] no encontrado: ${e.message}`);
  }
  finishGesture();

  // Gesto 8: zoom/pan inmediato tras cambio de intervalo
  newGesture("zoom-in-after-interval-change");
  await zoomWheel(page, box, -300);
  await page.waitForTimeout(400);
  finishGesture();

  await browser.close();

  // Reporte
  console.log("\n=== Resumen por gesto ===");
  const summary = log.map(summarizeGesture);
  let regression = false;
  for (const s of summary) {
    const g = log.find((x) => x.name === s.name);
    const flips = detectOscillation(g);
    const ok = flips <= 2 || s.nEvents < 4;
    console.log(`  ${ok ? "✓" : "✗"} ${s.name.padEnd(35)} evts=${String(s.nEvents).padStart(3)} dur=${String(s.durationMs).padStart(5)}ms  flips=${flips}  spanΔ=${(s.spanLast - s.spanFirst).toFixed(2)}  fromΔ=${s.fromDelta.toFixed(2)}  toΔ=${s.toDelta.toFixed(2)}`);
    if (!ok) regression = true;
  }

  if (regression) {
    console.log("\n❌ REGRESIÓN: al menos un gesto invirtió la dirección del delta múltiples veces.");
    process.exit(1);
  } else {
    console.log("\n✅ OK: todos los gestos producen respuesta fluida sin inversiones bruscas.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
