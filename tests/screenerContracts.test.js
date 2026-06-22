import { describe, expect, it } from "vitest";
import { DECISION_TRACE_ENGINE_VERSION, DECISION_TRACE_SCHEMA_VERSION } from "@/lib/decisionTraceVersion";
import { buildScreenerContract, buildScreenerStockContext } from "@/lib/screenerContracts";

describe("screener stock context", () => {
  it("propaga accion y calidad de decision hacia la ficha", () => {
    const contract = buildScreenerContract({
      settings: { setupMode: "leader" },
      presetKey: "balanced",
      presetName: "Balanceado",
      setupName: "Stage 2",
      rowsCount: 10,
      filteredCount: 4,
      analyzedCount: 10,
    });
    const context = buildScreenerStockContext(contract, {
      symbol: "STG",
      row: { symbol: "STG", totalScore: 82, rsGlobalPct: 91, weaknessScore: 12 },
      action: { key: "candidate-long", label: "Candidato largo", tone: "good", detail: "Setup alineado." },
      readiness: { key: "operable", label: "Operable", tone: "good", detail: "Setup accionable y sin alertas principales." },
      decisionProfile: { key: "operable-clean", label: "Operable limpio", tone: "good", detail: "Confianza alta y confluencia suficiente." },
      decisionIssues: [{ key: "overextended-sma50", label: "Extendida sobre SMA50", severity: "warn", detail: "24.0%" }],
      decisionTrace: {
        schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
        engineVersion: DECISION_TRACE_ENGINE_VERSION,
        priorityScore: 1275.347,
        priority: {
          score: 1275.347,
          formula: "decision + accion + score + RS + rent/riesgo - issues",
          components: [
            { key: "readiness", label: "Decision", value: 1000, detail: "Operable" },
            { key: "action", label: "Accion", value: 160, detail: "Candidato largo" },
            { key: "score", label: "Score", value: 180.4, raw: 82 },
          ],
          issuePenalty: 70,
          penalties: [{ key: "overextended-sma50", label: "Extendida sobre SMA50", severity: "warn", value: 70 }],
        },
        confidence: { key: "high", score: 84.7, label: "Alta", tone: "good", detail: "Confluencia limpia", issueCount: 1 },
        evidence: {
          schemaVersion: 1,
          status: "needs-work",
          tone: "warn",
          passedCount: 5,
          totalCount: 6,
          summary: "Precio perseguible",
          items: [
            { key: "setup-accionable", label: "Setup accionable", status: "confirmed", statusLabel: "Confirmado", tone: "good", detail: "Plan valido" },
            { key: "precio-perseguible", label: "Precio perseguible", status: "needed", statusLabel: "Pendiente", tone: "warn", detail: "Esperar zona limpia" },
          ],
          pending: [
            { key: "precio-perseguible", label: "Precio perseguible", status: "needed", statusLabel: "Pendiente", tone: "warn", detail: "Esperar zona limpia" },
          ],
        },
        drivers: [{ key: "rs-global", label: "RS global", value: "91" }],
        watch: [{ key: "pullback", label: "Pullback", detail: "Esperar zona limpia" }],
        line: "RS global fuerte con setup alineado.",
      },
      decisionBrief: {
        thesis: { label: "Tesis", value: "RS global 91", detail: "Liderazgo claro", tone: "good" },
        risk: { label: "Riesgo", value: "Pullback", detail: "Esperar zona limpia", tone: "warn" },
        nextAction: { label: "Siguiente", value: "Preparar entrada", detail: "Validar pivot", tone: "good" },
      },
      dataHealth: {
        schemaVersion: 1,
        status: { key: "ready", label: "Datos aptos", tone: "good", detail: "Base tecnica fresca y cobertura util." },
        coverageScore: 82.4,
        freshness: { label: "fresco", detail: "1d/5d", days: 1, maxDays: 5, ok: true, stale: false, tone: "good" },
        provider: { label: "Yahoo Finance", tone: "neutral", detail: "cache hit" },
        issues: [],
        topLine: "Cob 82 · 1d/5d · Yahoo Finance",
      },
      scoreAudit: {
        schemaVersion: 1,
        formula: "fixture formula",
        displayedScore: 82,
        calculatedScore: 78.4,
        residual: 3.6,
        integrityTone: "good",
        topLine: "RS +14.6 · Setup +13.6",
        components: [
          { key: "rs", label: "RS", field: "rsGlobalPct", weight: 0.16, value: 91, points: 14.56, tone: "good" },
          { key: "setup", label: "Setup", field: "setupQualityScore", weight: 0.17, value: 80, points: 13.6, tone: "good" },
        ],
        positive: [
          { key: "rs", label: "RS", field: "rsGlobalPct", weight: 0.16, value: 91, points: 14.56, tone: "good" },
        ],
        drags: [],
        risks: [],
        missing: [],
      },
      rank: 1,
      queueSize: 4,
    });

    expect(context.action.label).toBe("Candidato largo");
    expect(context.readiness.label).toBe("Operable");
    expect(context.decisionProfile).toEqual({ key: "operable-clean", label: "Operable limpio", tone: "good", detail: "Confianza alta y confluencia suficiente." });
    expect(context.statusTone).toBe("good");
    expect(context.statusText).toMatch(/^Operable:/);
    expect(context.decisionIssues).toEqual([{ key: "overextended-sma50", label: "Extendida sobre SMA50", severity: "warn", detail: "24.0%" }]);
    expect(context.decisionTrace.priorityScore).toBe(1275.35);
    expect(context.decisionTrace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
    expect(context.decisionTrace.priority.components.map((item) => item.key)).toEqual(["readiness", "action", "score"]);
    expect(context.decisionTrace.priority.penalties[0]).toMatchObject({ key: "overextended-sma50", value: 70 });
    expect(context.decisionTrace.confidence).toEqual({ key: "high", score: 85, label: "Alta", tone: "good", detail: "Confluencia limpia", issueCount: 1 });
    expect(context.decisionTrace.evidence).toMatchObject({ status: "needs-work", passedCount: 5, totalCount: 6, summary: "Precio perseguible" });
    expect(context.decisionTrace.evidence.pending[0]).toMatchObject({ key: "precio-perseguible", status: "needed" });
    expect(context.decisionTrace.drivers).toEqual([{ key: "rs-global", label: "RS global", value: "91" }]);
    expect(context.decisionTrace.watch).toEqual([{ key: "pullback", label: "Pullback", detail: "Esperar zona limpia" }]);
    expect(context.decisionTrace.line).toBe("RS global fuerte con setup alineado.");
    expect(context.decisionBrief.nextAction.value).toBe("Preparar entrada");
    expect(context.decisionBrief.risk.detail).toBe("Esperar zona limpia");
    expect(context.dataHealth).toMatchObject({
      status: { key: "ready", label: "Datos aptos", tone: "good" },
      coverageScore: 82,
      topLine: "Cob 82 · 1d/5d · Yahoo Finance",
    });
    expect(context.dataHealth.freshness).toMatchObject({ days: 1, maxDays: 5, ok: true });
    expect(context.scoreAudit).toMatchObject({
      displayedScore: 82,
      calculatedScore: 78.4,
      residual: 3.6,
      integrityTone: "good",
      topLine: "RS +14.6 · Setup +13.6",
    });
    expect(context.scoreAudit.positive[0]).toMatchObject({ key: "rs", points: 14.56 });
  });

  it("conserva pruebas de decision aunque no haya decisionTrace valida", () => {
    const contract = buildScreenerContract({
      settings: { setupMode: "leader" },
      presetKey: "balanced",
      presetName: "Balanceado",
      setupName: "Stage 2",
      rowsCount: 2,
      filteredCount: 1,
      analyzedCount: 2,
    });
    const context = buildScreenerStockContext(contract, {
      symbol: "EVD",
      row: { symbol: "EVD", totalScore: 78, rsGlobalPct: 74 },
      decisionEvidence: {
        schemaVersion: 1,
        status: "needs-work",
        tone: "warn",
        passedCount: 4,
        totalCount: 6,
        summary: "Confluencia amplia · Datos fiables",
        items: [
          { key: "setup-accionable", label: "Setup accionable", status: "confirmed", statusLabel: "Confirmado", tone: "good", detail: "Plan valido" },
          { key: "confluencia-amplia", label: "Confluencia amplia", status: "needed", statusLabel: "Pendiente", tone: "warn", detail: "liderazgo 2/3" },
        ],
        pending: [
          { key: "confluencia-amplia", label: "Confluencia amplia", status: "needed", statusLabel: "Pendiente", tone: "warn", detail: "liderazgo 2/3" },
        ],
      },
    });

    expect(context.decisionTrace).toBeNull();
    expect(context.decisionEvidence).toMatchObject({
      status: "needs-work",
      tone: "warn",
      passedCount: 4,
      totalCount: 6,
      summary: "Confluencia amplia · Datos fiables",
    });
    expect(context.decisionEvidence.pending[0]).toMatchObject({ key: "confluencia-amplia", status: "needed" });
  });

  it("restaura accion, readiness e issues desde decisionTrace guardada", () => {
    const contract = buildScreenerContract({
      settings: { setupMode: "leader" },
      presetKey: "balanced",
      presetName: "Balanceado",
      setupName: "Stage 2",
      rowsCount: 10,
      filteredCount: 4,
      analyzedCount: 10,
    });
    const context = buildScreenerStockContext(contract, {
      symbol: "RST",
      row: {
        symbol: "RST",
        totalScore: 74,
        rsGlobalPct: 82,
        decisionTrace: {
          schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
          engineVersion: DECISION_TRACE_ENGINE_VERSION,
          priorityScore: 988,
          priority: {
            score: 988,
            components: [
              { key: "readiness", label: "Decision", value: 660 },
              { key: "action", label: "Accion", value: 80 },
              { key: "score", label: "Score", value: 162.8, raw: 74 },
            ],
            issuePenalty: 75,
            penalties: [{ key: "thin-confirmation", label: "Confirmación fina", severity: "warn", value: 75 }],
          },
          action: { key: "candidate-with-watch", label: "Candidato con vigilancia", tone: "watch", detail: "Buen perfil, timing pendiente." },
          readiness: { key: "watch", label: "Vigilar", tone: "watch", detail: "Esperar confirmación." },
          confidence: { key: "medium", score: 64, label: "Media", tone: "warn" },
          brief: {
            thesis: { label: "Tesis", value: "RS fuerte", detail: "Buen perfil relativo", tone: "good" },
            risk: { label: "Riesgo", value: "Confirmación fina", detail: "Pocos drivers ejecutivos.", tone: "warn" },
            nextAction: { label: "Siguiente", value: "Esperar confirmación", detail: "Mejor punto", tone: "watch" },
          },
          issues: [{ key: "thin-confirmation", label: "Confirmación fina", severity: "warn", detail: "Pocos drivers ejecutivos." }],
        },
      },
    });

    expect(context.action.label).toBe("Candidato con vigilancia");
    expect(context.readiness.label).toBe("Vigilar");
    expect(context.statusTone).toBe("watch");
    expect(context.statusText).toMatch(/^Vigilar:/);
    expect(context.decisionIssues).toEqual([{ key: "thin-confirmation", label: "Confirmación fina", severity: "warn", detail: "Pocos drivers ejecutivos." }]);
    expect(context.decisionBrief.thesis.value).toBe("RS fuerte");
    expect(context.decisionBrief.nextAction.value).toBe("Esperar confirmación");
  });

  it("no restaura decisiones desde una decisionTrace de motor antiguo", () => {
    const contract = buildScreenerContract({
      settings: { setupMode: "leader" },
      presetKey: "balanced",
      presetName: "Balanceado",
      setupName: "Stage 2",
      rowsCount: 1,
      filteredCount: 1,
      analyzedCount: 1,
    });
    const context = buildScreenerStockContext(contract, {
      symbol: "OLD",
      row: {
        symbol: "OLD",
        totalScore: 74,
        rsGlobalPct: 82,
        decisionTrace: {
          schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
          engineVersion: "decision-trace-v1",
          priorityScore: 988,
          priority: {
            score: 988,
            components: [
              { key: "readiness", label: "Decision", value: 1000 },
              { key: "action", label: "Accion", value: 160 },
              { key: "score", label: "Score", value: 160 },
            ],
            issuePenalty: 0,
            penalties: [],
          },
          action: { key: "candidate-long", label: "Candidato largo", tone: "good", detail: "Trace antigua." },
          readiness: { key: "operable", label: "Operable", tone: "good", detail: "Trace antigua." },
          confidence: { key: "high", score: 92, label: "Alta", tone: "good" },
          issues: [],
        },
      },
    });

    expect(context.decisionTrace).toBeNull();
    expect(context.action).toBeNull();
    expect(context.readiness).toBeNull();
    expect(context.decisionIssues).toEqual([]);
  });

  it("marca el contexto como riesgoso si la salud de datos viene bloqueada", () => {
    const contract = buildScreenerContract({
      settings: { setupMode: "leader" },
      presetKey: "balanced",
      presetName: "Balanceado",
      setupName: "Stage 2",
      rowsCount: 1,
      filteredCount: 1,
      analyzedCount: 1,
    });
    const context = buildScreenerStockContext(contract, {
      symbol: "BAD",
      row: {
        symbol: "BAD",
        totalScore: 78,
        rsGlobalPct: 86,
        dataHealth: {
          status: { key: "blocked", label: "Bloqueado", tone: "bad", detail: "No usar como decision sin revisar datos base." },
          coverageScore: 24,
          issues: [{ key: "quality-gate", label: "Datos base", tone: "bad", detail: "precio ausente" }],
          topLine: "Cob 24 · sin frescura · proveedor",
        },
      },
      readiness: { key: "operable", label: "Operable", tone: "good", detail: "Setup accionable." },
    });

    expect(context.statusTone).toBe("bad");
    expect(context.dataHealth.status.key).toBe("blocked");
    expect(context.dataHealth.issues[0]).toMatchObject({ key: "quality-gate", label: "Datos base", tone: "bad" });
  });
});
