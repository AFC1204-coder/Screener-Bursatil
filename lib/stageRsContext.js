// lib/stageRsContext.js — corrección de etapa por fuerza relativa (decisión del dueño, 2026-11-13).
//
// El motor de etapas (lib/weeklyStage.js) mira solo la media de 30 semanas y el precio: una media plana tras
// una caída es «etapa 1 confirmada» aunque el precio esté muy por debajo de ella. Un valor así (ORCL: precio
// −25 % bajo la media, RS 13) sigue cayendo, no hace base. La fuerza relativa lo distingue: en un estudio
// sobre 3.502 acciones (jul–oct 2026, RS sustituto = percentil de la rentabilidad a 26 semanas), de los
// «etapa 1 confirmada» bajo la media, a 4 semanas acaban en etapa 4 el 53 % con RS < 30 y el 10 % con RS ≥ 30,
// y a igual distancia a la media el RS bajo multiplica por 3–5 esa probabilidad.
//
// Regla: etapa 1 confirmada + precio bajo la media + rsGlobalPct < STAGE_RS_CORRECTION_MAX_RS → etapa 4
// confirmada. No toca lo que el motor calcula: guarda el estado original en `weeklyStageEngineState` y marca
// `weeklyStageRsAdjusted`. Solo se aplica en el escaneo nocturno (percentil sobre el universo completo); la
// pantalla no la vuelve a aplicar sobre subconjuntos. Umbral sin validar fuera de una ventana corta y bajista.

export const STAGE_RS_CORRECTION_MAX_RS = 30;

export function applyStageRsContext(rows = [], { maxRs = STAGE_RS_CORRECTION_MAX_RS } = {}) {
  return rows.map((row) => {
    const rs = row?.rsGlobalPct;
    const distance = row?.weeklyDistanceSlowMa;
    if (row?.weeklyStageState !== "stage1" || row?.weeklyStageConfirmation !== "confirmed") return row;
    if (!Number.isFinite(rs) || !Number.isFinite(distance) || distance >= 0 || rs >= maxRs) return row;
    const label = "Etapa 4 confirmada";
    return {
      ...row,
      weeklyStageEngineState: row.weeklyStageState,
      weeklyStageRsAdjusted: true,
      weeklyStageState: "stage4",
      weeklyStageConfirmation: "confirmed",
      weeklyStageLabel: label,
      weeklyStageWeek: null,
      weeklyStageStructure: "n/a",
      weeklyStageStructureLabel: "",
      weeklyStageStructureDetail: "código stage4 (corregido por RS bajo); el subestado estructural no aplica",
      weeklyStage: row.weeklyStage && typeof row.weeklyStage === "object"
        ? {
          ...row.weeklyStage,
          state: "stage4",
          confirmation: "confirmed",
          label,
          weekInStage: null,
          detail: `Media de 30 semanas plana tras caer, precio ${Math.abs(distance).toFixed(1)} % por debajo y fuerza relativa baja (${Math.round(rs)}): la caída no ha terminado.`,
        }
        : row.weeklyStage,
    };
  });
}
