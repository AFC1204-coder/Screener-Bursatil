// Fixtures de barras sintéticas y deterministas para los tests de indicadores y scoring.
// Contrato de barras de la app: array DESCENDENTE (bars[0] = última sesión).
// Las fechas se generan hacia atrás desde hoy (solo días laborables) para que la
// frescura de precio sea estable; ninguna aserción depende del día concreto.

function tradingDatesDesc(count) {
  const dates = [];
  const cursor = new Date();
  while (dates.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() - 1);
  }
  return dates;
}

function buildBars({ count, startClose, dailyDrift, waveAmplitude = 1.5, baseVolume = 1000000 }) {
  const dates = tradingDatesDesc(count);
  const bars = [];
  for (let i = 0; i < count; i++) {
    // i = 0 es la última sesión; la serie cronológica usa el índice invertido.
    const t = count - 1 - i;
    const close = startClose + dailyDrift * t + waveAmplitude * Math.sin(t / 3);
    const volume = baseVolume + (t % 7) * 50000;
    bars.push({
      date: dates[i],
      close,
      open: close * 0.998,
      high: close * 1.01,
      low: close * 0.99,
      volume,
    });
  }
  return bars;
}

// Stage 2 claro: tendencia alcista sostenida (~+0.31/día durante 320 sesiones, 50 → ~149).
// Garantiza precio > SMA50 > SMA150 > SMA200 con pendiente SMA200 positiva, cerca de máximos.
export function stage2Bars() {
  return buildBars({ count: 320, startClose: 50, dailyDrift: 0.31 });
}

// Stage 4 claro: tendencia bajista equivalente (150 → ~51). Precio < SMA200 con pendiente negativa.
export function stage4Bars() {
  return buildBars({ count: 320, startClose: 150, dailyDrift: -0.31 });
}

// Histórico insuficiente: menos de 20 barras (buildResearchRow debe rechazarla).
export function shortHistoryBars() {
  return buildBars({ count: 15, startClose: 100, dailyDrift: 0.2 });
}
