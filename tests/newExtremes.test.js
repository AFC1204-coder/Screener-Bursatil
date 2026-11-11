// newExtremes: nuevos máximos/mínimos relativos por cierre (docs/diseno-nuevos-maximos-minimos-2026-11.md).
import { describe, expect, it } from "vitest";
import { newExtremes } from "@/lib/indicators";

// Días hábiles consecutivos desde 2026-01-05 (lunes). Devuelve barras DESCENDENTES.
function daily(closes) {
  const out = [];
  const d = new Date("2026-01-05T00:00:00Z");
  for (const c of closes) {
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    out.push({ date: d.toISOString().slice(0, 10), close: c, high: c * 1.05, low: c * 0.95 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out.reverse();
}
// 70 barras de relleno oscilante en 100±3 con picos propios al final controlados por el test.
const base = (n = 64) => Array.from({ length: n }, (_, i) => 100 + 3 * Math.sin(i / 2));
const run = (tail) => [...base(), ...tail];

describe("newExtremes · diario por cierre", () => {
  it("datos insuficientes → null, nunca 0", () => {
    expect(newExtremes(daily(base(40)))).toBeNull();
    expect(newExtremes([])).toBeNull();
    expect(newExtremes(daily(base()), { basis: "high" })).toBeNull();
  });
  it("primera barra que cierra por encima del último swing alto = evento", () => {
    // pivote alto en 110 (r=3: tres cierres menores a cada lado), luego cierra en 111
    const bars = daily(run([104, 106, 108, 110, 108, 106, 104, 111]));
    const ev = newExtremes(bars);
    expect(ev.high).toMatchObject({ level: 110 });
    expect(ev.low).toBeNull();
  });
  it("si ya había superado el nivel antes, la siguiente barra es continuación del movimiento, no evento", () => {
    const bars = daily(run([104, 106, 108, 110, 108, 106, 104, 111, 112]));
    expect(newExtremes(bars).high).toBeNull();
  });
  it("una mecha por encima que cierra por debajo NO es ruptura", () => {
    const bars = daily(run([104, 106, 108, 110, 108, 106, 104, 109]));
    bars[0].high = 120; // mecha muy por encima del pivote
    expect(newExtremes(bars).high).toBeNull();
  });
  it("mínimo relativo simétrico: cierra por debajo del último swing bajo", () => {
    const bars = daily(run([96, 94, 92, 90, 92, 94, 96, 89]));
    const ev = newExtremes(bars);
    expect(ev.low).toMatchObject({ level: 90 });
    expect(ev.high).toBeNull();
  });
  it("sin swing confirmado aún (pivote sin r barras detrás) no hay evento", () => {
    const bars = daily(run([104, 106, 108, 110, 108]));
    expect(newExtremes(bars).high).toBeNull();
  });
  it("lleva apellido: continuación si el swing roto supera al anterior, giro si no", () => {
    const up = daily(run([100, 103, 106, 108, 106, 103, 100, 104, 107, 110, 107, 104, 101, 111]));
    expect(newExtremes(up).high.kind).toBe("continuacion");
    const down = daily(run([100, 103, 106, 112, 106, 103, 100, 104, 107, 109, 107, 104, 101, 110]));
    expect(newExtremes(down).high.kind).toBe("giro");
  });
});

describe("newExtremes · semanal por cierre", () => {
  // una barra por viernes: 40 semanas oscilantes + cola
  function weekly(closes) {
    const out = [];
    const d = new Date("2026-01-02T00:00:00Z"); // viernes
    for (const c of closes) { out.push({ date: d.toISOString().slice(0, 10), close: c }); d.setUTCDate(d.getUTCDate() + 7); }
    return out.reverse();
  }
  const wbase = Array.from({ length: 36 }, (_, i) => 100 + 3 * Math.sin(i / 2));
  it("exige 30 semanas; usa r=2", () => {
    expect(newExtremes(weekly(wbase.slice(0, 20)), { timeframe: "weekly" })).toBeNull();
    const ev = newExtremes(weekly([...wbase, 104, 108, 110, 107, 104, 111]), { timeframe: "weekly" });
    expect(ev.radius).toBe(2);
    expect(ev.high).toMatchObject({ level: 110 });
    expect(ev.partial).toBe(false);
  });
  it("agrega los cierres diarios al último cierre de la semana y marca la semana en curso como parcial", () => {
    // semanas completas hasta viernes + martes de la semana siguiente
    const closes = [...wbase, 104, 108, 110, 107, 104];
    const bars = weekly(closes).reverse();
    const tue = new Date(bars[bars.length - 1].date + "T00:00:00Z");
    tue.setUTCDate(tue.getUTCDate() + 4); // martes siguiente
    bars.push({ date: tue.toISOString().slice(0, 10), close: 111 });
    const ev = newExtremes(bars.reverse(), { timeframe: "weekly" });
    expect(ev.partial).toBe(true);
    expect(ev.high).toMatchObject({ level: 110 });
  });
});
