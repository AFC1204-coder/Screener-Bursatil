export const DECISION_TRACE_SCHEMA_VERSION = 1;
export const DECISION_TRACE_ENGINE_VERSION = "decision-trace-v3";

export function isDecisionTraceVersionCurrent(trace = null) {
  if (!trace || typeof trace !== "object") return false;
  return Number(trace.schemaVersion) === DECISION_TRACE_SCHEMA_VERSION
    && trace.engineVersion === DECISION_TRACE_ENGINE_VERSION;
}
