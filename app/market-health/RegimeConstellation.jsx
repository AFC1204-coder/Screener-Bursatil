// app/market-health/RegimeConstellation.jsx
// Variante hero de la Curva de Etapa: cada índice principal es un punto tiza
// posicionado por distancia a MM30s, marcador agregado mayor con la tiza
// semántica del régimen. Estreno real de la constelación (DIRECCION-VISUAL.md
// §5 + MARKET-HEALTH-IA.md §4).
//
// Extraído a un módulo separado para poder renderizarse en aislamiento desde
// tests sin necesidad de levantar todo el árbol de la página.

/* Curva de Etapa — geometría canónica (DIRECCION-VISUAL.md §5).
   Etapa 1: 4–30 · Etapa 2: 30–54 · Etapa 3: 54–74 · Etapa 4: 74–116.
   viewBox extendido verticalmente a 0..56 para acomodar los labels
   escalonados cuando hay clustering denso (5-6 índices en el mismo E2). */
export const CURVE_PATH = "M4,30 L30,30 C40,30 42,8 54,8 L74,8 C84,8 86,30 96,30 L116,30";
export const STAGE_X = { 1: [4, 30], 2: [30, 54], 3: [54, 74], 4: [74, 116] };
export const CURVE_Y_BY_ZONE = { 1: 30, 2: 28, 3: 10, 4: 30 };
export const CONSTELLATION_VIEWBOX = "0 0 120 56";

/* Convierte (etapa, distancia a MM30s %) en coordenadas (x, y) sobre la curva.
   Jitter vertical ±3 determinista (basado en x) para densidad visual sin colisión. */
export function indexPosition(stage30w, distanceSma30w) {
  const stage = String(stage30w || "");
  let zone = 1;
  if (/2/i.test(stage)) zone = 2;
  else if (/3/i.test(stage)) zone = 3;
  else if (/4/i.test(stage)) zone = 4;
  const [from, to] = STAGE_X[zone];
  const dist = Number.isFinite(distanceSma30w) ? Math.max(-15, Math.min(15, distanceSma30w)) : 0;
  const norm = Math.max(-1, Math.min(1, dist / 10));
  const x = from + ((to - from) / 2) + norm * ((to - from) / 2);
  const cx = Math.max(4, Math.min(116, x));
  const jitter = (((cx * 17) % 7) - 3);
  const cy = CURVE_Y_BY_ZONE[zone] + jitter;
  return { x: cx, y: cy, zone };
}

/* Coordenada y donde colocar el label de un punto dado.
   E3 (techo): label va DEBAJO del punto (la curva está arriba en y=8).
   E1/E2/E4 (suelo): label va ENCIMA del punto (la curva está abajo en y=30). */
export function labelYForPoint(point, zone) {
  if (zone === 3) return point.y + 8;
  return point.y - 3;
}

/* Posición agregada del mercado como conjunto: media ponderada por `weight`,
   con la etapa dominante para decidir el color del marcador. */
export function aggregatePosition(indexes = []) {
  const items = indexes.filter((x) => Number.isFinite(x.distanceSma30w));
  if (!items.length) return null;
  const totalWeight = items.reduce((s, x) => s + (Number(x.weight) || 1), 0);
  const weighted = items.reduce((s, x) => {
    const w = Number(x.weight) || 1;
    const pos = indexPosition(x.stage30w, x.distanceSma30w);
    return s + pos.x * w;
  }, 0);
  const x = weighted / totalWeight;
  const zones = items.map((x) => indexPosition(x.stage30w, x.distanceSma30w).zone);
  const zoneCount = zones.reduce((m, z) => ((m[z] = (m[z] || 0) + 1), m), {});
  const dominantZone = Number(Object.entries(zoneCount).sort((a, b) => b[1] - a[1])[0][0]);
  return { x, zone: dominantZone };
}

/* Color semántico del marcador agregado del régimen. */
export function regimeTone(data, indexes) {
  const items = indexes || data?.breadthProxy ? indexes : [];
  if (!items || !items.length) {
    const score = Number(data?.marketScore) || 50;
    if (score >= 60) return "senal";
    if (score <= 40) return "oxido";
    return "humo";
  }
  const pos = aggregatePosition(items);
  const abovePct = Number(data?.breadthProxy?.pctAbove30w);
  if (pos?.zone === 2 && Number.isFinite(abovePct) && abovePct >= 50) return "senal";
  if (pos?.zone === 4) return "oxido";
  if (pos?.zone === 3) return "oxido";
  if (Number.isFinite(abovePct) && abovePct < 35) return "oxido";
  return "humo";
}

/* Ancho estimado de cada label en unidades de viewBox (~10 unidades para
   tickers como "GSPC", "ACWI"). Usado para evitar solapes horizontales. */
const LABEL_HALF_WIDTH = 5;

/* Algoritmo anti-solape para labels (versión reforzada tras capturar el
   bug visual real con datos de producción):
   1. Posición base por zona (labelYForPoint).
   2. Stagger vertical: si choca con un label previo en x±10 e y±4, desplazar
      7 unidades hacia abajo (E3: hacia arriba). Hasta 8 intentos.
      Paso mayor (7 vs 3) y threshold más sensible (y<4 vs y<3) porque en
      la práctica los 5 índices principales están clusterizados en zonas
      estrechas (mismo E2 con distances similares) y un paso de 3 dejaba
      los labels a sólo ~9-12px en pantalla, indistinguibles. Con paso 7
      y threshold 4, los labels se separan ~25-30px reales.
   3. Stagger horizontal: si tras 8 intentos verticales aún choca, desplazar
      ±7 unidades en x alternando signo. Hasta 4 intentos extra.
   4. Si tras todo el algoritmo un label queda >4 unidades desplazado del
      punto, se marca con leaderLine:true para que el SVG dibuje una línea
      fina de humo entre el dot y el label.
   Esta función es PURA y testeable — recibe los rows y devuelve los puntos
   con labelX, labelY, leaderLine asignados. */
export function layoutConstellationPoints(rows) {
  const items = Array.isArray(rows) ? rows.slice(0, 6) : [];
  const points = items.map((row) => ({
    row,
    ...indexPosition(row.stage30w, row.distanceSma30w),
  }));
  const placedLabels = [];
  for (const p of points) {
    let yOffset = 0;
    let xOffset = 0;
    let found = false;
    for (let attempt = 0; attempt < 12 && !found; attempt++) {
      const step = attempt < 8 ? "v" : "h";
      if (step === "v") {
        const candidateY = labelYForPoint(p, p.zone) + yOffset;
        const collision = placedLabels.some((pl) =>
          Math.abs(pl.xCenter - (p.x + xOffset)) < LABEL_HALF_WIDTH * 2 &&
          Math.abs(pl.y - candidateY) < 4
        );
        if (!collision) {
          p.labelY = candidateY;
          p.labelX = p.x + xOffset;
          placedLabels.push({ xCenter: p.labelX, y: candidateY, zone: p.zone });
          found = true;
          break;
        }
        yOffset += p.zone === 3 ? -7 : 7;
      } else {
        const sign = ((attempt - 8) % 2 === 0) ? 1 : -1;
        const mag = Math.ceil(((attempt - 8) + 1) / 2) * 7;
        xOffset = sign * mag;
        const candidateY = labelYForPoint(p, p.zone) + yOffset;
        const collision = placedLabels.some((pl) =>
          Math.abs(pl.xCenter - (p.x + xOffset)) < LABEL_HALF_WIDTH * 2 &&
          Math.abs(pl.y - candidateY) < 4
        );
        if (!collision) {
          p.labelY = candidateY;
          p.labelX = p.x + xOffset;
          placedLabels.push({ xCenter: p.labelX, y: candidateY, zone: p.zone });
          found = true;
          break;
        }
      }
    }
    if (!found) {
      p.labelY = labelYForPoint(p, p.zone) + yOffset;
      p.labelX = p.x + xOffset;
      placedLabels.push({ xCenter: p.labelX, y: p.labelY, zone: p.zone });
    }
    const dist = Math.abs(p.labelY - p.y) + Math.abs(p.labelX - p.x);
    p.leaderLine = dist > 4;
  }
  return points;
}

export default function RegimeConstellation({ indexes = [] }) {
  const points = layoutConstellationPoints(indexes);
  const aggregate = aggregatePosition(indexes);
  const tone = regimeTone(null, indexes);
  const shortLabel = (sym) => String(sym || "").replace(/^\^/, "");

  return (
    <div className="marketRegimeConstellation">
      <svg
        className="marketRegimeConstellationSvg"
        viewBox={CONSTELLATION_VIEWBOX}
        role="img"
        aria-label="Posición de los índices principales en la Curva de Etapa"
      >
        {/* Trazo de la curva */}
        <path d={CURVE_PATH} className="curve-track" />
        {/* Ticks de zona en la base (referencia visual) */}
        <g className="curve-zone-ticks">
          <text x="17" y="54" textAnchor="middle" className="curve-zone-tick">E1</text>
          <text x="42" y="54" textAnchor="middle" className="curve-zone-tick">E2</text>
          <text x="64" y="54" textAnchor="middle" className="curve-zone-tick">E3</text>
          <text x="95" y="54" textAnchor="middle" className="curve-zone-tick">E4</text>
        </g>
        {/* Leader lines (debajo de dots/labels, en humo a baja opacidad).
           Solo se dibujan cuando el label se alejó >5 unidades del punto. */}
        <g className="curve-leaders">
          {points.filter((p) => p.leaderLine).map((p) => (
            <line
              key={`lead-${p.row.symbol}`}
              x1={p.x}
              y1={p.y}
              x2={p.labelX}
              y2={p.labelY}
              className="curve-leader"
            />
          ))}
        </g>
        {/* Puntos de índices */}
        {points.map((p) => (
          <g key={p.row.symbol || `idx-${p.row.distanceSma30w}-${p.x}`}>
            <circle cx={p.x} cy={p.y} r="1.4" className="curve-index-dot" />
            <text
              x={p.labelX}
              y={p.labelY}
              className="curve-index-label"
              textAnchor="middle"
            >
              {shortLabel(p.row.symbol)}
            </text>
          </g>
        ))}
        {/* Marcador agregado: el régimen como conjunto, único color semántico */}
        {aggregate && (
          <circle
            cx={aggregate.x}
            cy={CURVE_Y_BY_ZONE[aggregate.zone] ?? 24}
            r="2.4"
            className="curve-marker"
            data-tone={tone}
          />
        )}
      </svg>
    </div>
  );
}