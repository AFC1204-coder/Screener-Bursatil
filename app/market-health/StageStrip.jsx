// app/market-health/StageStrip.jsx — la franja de etapas del hero.
//
// Sustituye a la constelación de índices (RegimeConstellation, retirada
// 2026-08-17). Aquella dibujaba cinco puntos SVG con jitter y anti-solape, y
// degeneraba justo en su caso más frecuente: en un mercado tendencial los
// cinco índices comparten etapa y distancias parecidas, así que los rótulos
// acababan apilados en una torre con líneas cruzando la curva
// (docs/analisis-salud-mercado-2026-08-16.md, Parte D). Además deducía la
// zona buscando dígitos en el texto de la etiqueta, con lo que «Bajo MM30s»
// caía en la zona de techo por el 3 de «MM30s» (auditoría C-19).
//
// Aquí cada índice es un chip HTML dentro de la franja de su etapa CANÓNICA
// (`stageState` de lib/weeklyStage.js, el mismo clasificador que la tabla y
// la ficha): compartir etapa forma una lista legible, no una superposición.
// Y debajo de cada franja, cuando el escaneo nocturno ya clasifica con el
// criterio vigente, el porcentaje del universo que está en esa etapa — la
// divergencia entre los índices y los valores que los acompañan se ve en la
// misma columna, que es lo que un número suelto no puede decir.
import { num, pct, pctShare } from "@/lib/formatters";
import { stageConfirmationMark, stageWordForState } from "@/lib/stageDisplay";

/* Las cuatro franjas del ciclo, en el orden del ciclo. El nombre corto es el
   de la metodología (lib/weeklyStage.js): base, avance, techo, declive. */
export const STAGE_ZONES = [
  { state: "stage1", name: "Base" },
  { state: "stage2", name: "Avance" },
  { state: "stage3", name: "Techo" },
  { state: "stage4", name: "Declive" },
];

/* Curva de Etapa como firma visual de fondo (DIRECCION-VISUAL.md §5),
   redibujada con cuatro tramos IGUALES para que cada tramo quede alineado con
   su columna de la cuadrícula: suelo (0–30), subida (30–60), techo (60–90),
   caída (90–120). El marcador del régimen se coloca en el centro del tramo
   de la etapa dominante. */
export const STRIP_CURVE = {
  viewBox: "0 0 120 28",
  path: "M2,23 L30,23 C38,23 52,5 60,5 L90,5 C98,5 112,23 118,23",
  centers: { stage1: [15, 23], stage2: [45, 14], stage3: [75, 5], stage4: [104, 14] },
};

/* Estado de un índice para colocarlo en su franja. `stageState` viene del
   clasificador canónico; los payloads ANTIGUOS — el caché que la ruta sirve
   sin `refresh=1`, escrito por el código anterior — solo traen la etiqueta
   larga en `stage30w` («Etapa 2 probable»). Ese caso lo resuelve el
   diccionario único (lib/stageDisplay.js), que deriva el estado del texto ya
   guardado por PALABRA completa («etapa 2»), nunca por dígitos sueltos: un
   «Bajo MM30s» sigue siendo sin etapa, no zona de techo (C-19). */
export function stateForIndex(index = {}) {
  return stageWordForState(index.stageState || "", index.stage30w || "")?.tone || null;
}

/* Etapa dominante del conjunto: la que concentra más peso de índices
   clasificados. Devuelve null si ningún índice trae etapa. */
export function dominantStageState(indexes = []) {
  const weightByState = new Map();
  for (const index of indexes) {
    const state = stateForIndex(index);
    if (!STAGE_ZONES.some((zone) => zone.state === state)) continue;
    const weight = Number(index.weight) || 1;
    weightByState.set(state, (weightByState.get(state) || 0) + weight);
  }
  if (!weightByState.size) return null;
  return [...weightByState.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/* Tono semántico del régimen. Único color de convicción de la vista:
   - etapa 4 dominante → óxido (declive: riesgo real);
   - etapa 2 dominante → señal, salvo que la amplitud del universo diga que
     menos del 45% sostiene su media de 30 semanas (avance sin compañía);
   - etapas 1/3 o sin clasificar → humo (transición, sin convicción). */
export function regimeTone(indexes = [], breadth = null) {
  const dominant = dominantStageState(indexes);
  if (!dominant) return "humo";
  if (dominant === "stage4") return "oxido";
  if (dominant === "stage2") {
    const above30w = breadth?.indicators?.find?.((item) => item.key === "above30w");
    if (Number.isFinite(above30w?.pct) && above30w.pct < 45) return "humo";
    return "senal";
  }
  return "humo";
}

/* Reparto del universo por etapa, solo si el escaneo nocturno ya clasifica
   con el criterio vigente. Mientras queden filas de la taxonomía anterior
   («base»/«mixed»), el reparto por franja mentiría por omisión — el 40% del
   universo no caería en ninguna — así que se declara el motivo en una nota
   única y el detalle completo queda en «Amplitud del universo». */
export function universeByStage(stages) {
  if (!stages?.available || !Array.isArray(stages.buckets)) return null;
  const legacyCount = stages.buckets
    .filter((bucket) => bucket.key === "base" || bucket.key === "mixed")
    .reduce((sum, bucket) => sum + (bucket.count || 0), 0);
  if (legacyCount > 0) return { legacy: true, legacyCount };
  const byState = {};
  for (const bucket of stages.buckets) {
    if (STAGE_ZONES.some((zone) => zone.state === bucket.key)) byState[bucket.key] = bucket;
  }
  return { legacy: false, byState };
}

function chipTitle(index) {
  const parts = [index.stage30w || ""];
  if (Number.isFinite(index.distanceSma30w)) {
    parts.push(`Precio a ${pct(index.distanceSma30w)} de su media de 30 semanas.`);
  }
  if (Number.isFinite(index.stageWeeks)) {
    parts.push(`${num(index.stageWeeks)} semanas en la etapa.`);
  }
  return parts.filter(Boolean).join(" · ");
}

export default function StageStrip({ indexes = [], stages = null, tone = "humo" }) {
  const items = Array.isArray(indexes) ? indexes : [];
  const dominant = dominantStageState(items);
  const universe = universeByStage(stages);
  const unclassified = items.filter(
    (index) => !STAGE_ZONES.some((zone) => zone.state === stateForIndex(index)),
  );
  const marker = dominant ? STRIP_CURVE.centers[dominant] : null;

  return (
    <div className="stageStrip">
      <svg className="stageStripCurve" viewBox={STRIP_CURVE.viewBox} aria-hidden="true">
        <path d={STRIP_CURVE.path} />
        {marker && (
          <circle className="stageStripMarker" cx={marker[0]} cy={marker[1]} r="2.6" data-tone={tone} />
        )}
      </svg>
      <div className="stageStripZones">
        {STAGE_ZONES.map((zone) => {
          const zoneItems = items
            .filter((index) => stateForIndex(index) === zone.state)
            .sort((a, b) => (b.distanceSma30w ?? -Infinity) - (a.distanceSma30w ?? -Infinity));
          const bucket = universe && !universe.legacy ? universe.byState[zone.state] : null;
          return (
            <div
              key={zone.state}
              className="stageStripZone"
              data-zone={zone.state}
              data-dominant={zone.state === dominant || undefined}
            >
              <span className="stageStripZoneName">
                <b>{stageWordForState(zone.state)?.word || zone.state}</b> {zone.name}
              </span>
              <span className="stageStripChips">
                {zoneItems.map((index) => {
                  const mark = stageConfirmationMark(index.stageConfirmation);
                  return (
                    <span className="stageStripChip" key={index.symbol} title={chipTitle(index)}>
                      <b>{index.symbol}</b>
                      {Number.isFinite(index.distanceSma30w) && <em>{pct(index.distanceSma30w)}</em>}
                      {mark?.suffix ? <i title={mark.title}>{mark.suffix}</i> : null}
                    </span>
                  );
                })}
                {!zoneItems.length && <span className="stageStripZoneEmpty">ninguno</span>}
              </span>
              {bucket && (
                <span
                  className="stageStripZoneUniverse"
                  title={`${num(bucket.count)} de ${num(stages.measured)} valores del escaneo nocturno en esta etapa.`}
                >
                  universo {pctShare(bucket.pct)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {universe?.legacy && (
        <p className="stageStripNote">
          El reparto del universo por etapa no se muestra aquí: el escaneo nocturno vigente aún
          clasifica con el criterio anterior. El detalle está en «Amplitud del universo».
        </p>
      )}
      {unclassified.length > 0 && (
        <p className="stageStripNote">
          Sin etapa: {unclassified.map((index) => `${index.symbol} (${index.stage30w || "sin dato"})`).join(" · ")}
        </p>
      )}
    </div>
  );
}
