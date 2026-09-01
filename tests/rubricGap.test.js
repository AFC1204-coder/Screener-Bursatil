import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildResultRow,
  classifyMatch,
  detectorLabel,
  expandEvaluationCases,
  summarizeDetector,
} from "../research/contracciones/arneses/rubric-gap.mjs";
import {
  evaluateShadowGates,
  gateG1,
  gateG2,
  gateG3,
  primeraEnAtrVentana,
} from "../research/contracciones/arneses/shadow-gates.mjs";
import { STRUCTURE_E2_MA_ONLY, STRUCTURE_E2_STRUCTURAL } from "@/lib/weeklyStageStructure";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../research/contracciones/corpus-manual.json"), "utf8"),
);
const tanda3 = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../research/contracciones/tanda3-gap-casos.json"), "utf8"),
);

function detectionFixture(overrides = {}) {
  const shadow = {
    g1: true,
    g2: true,
    g3: true,
    g1Reason: "ok",
    g2Reason: "ok",
    g3Reason: "ok",
    propuestaProducto: false,
    metrics: {
      primeraEnAtr: null,
      primeraEnAtrVentana: null,
      dispRatio: null,
      ultimaEnAtr: null,
      tightRatio: null,
      episodeBars: null,
    },
    ...(overrides.shadow ?? {}),
  };
  return {
    v4: { base: false, reason: "contexto" },
    v5: { base: false, reason: "contexto" },
    v7: { base: false, reason: "contexto" },
    prod: { vcpCandidate: false },
    stage: { state: "stage1", label: "Etapa 1" },
    structure: { state: "n/a", label: "", distResistancePct: null, rng26Pct: null },
    shadow,
    bars: 200,
    lastBar: "2026-04-13",
    ...overrides,
    shadow: {
      ...shadow,
      propuestaProducto: overrides.v7?.base === true && shadow.g1 && shadow.g2 && shadow.g3,
    },
  };
}

function rowFromFixture(id, detection) {
  const evalCases = expandEvaluationCases(corpus.casos, tanda3.casos);
  const evalCase = evalCases.find((c) => c.evalId === id);
  expect(evalCase).toBeTruthy();
  return buildResultRow(evalCase, detection);
}

describe("rubric-gap match logic", () => {
  it("ICE: dueño BASE sin v4 → miss", () => {
    const row = rowFromFixture("ICE-2026-01", detectionFixture());
    expect(row.ownerVerdict).toBe("BASE");
    expect(row.v4).toBe("no");
    expect(row.v4Match).toBe("miss");
    expect(row.v7Match).toBe("miss");
  });

  it("GOOGL: dueño BASE con v4 → match", () => {
    const row = rowFromFixture("GOOGL-2026-02", detectionFixture({
      v4: { base: true, reason: "ok" },
      v5: { base: true, reason: "ok" },
      v7: { base: true, reason: "ok", episode: 1 },
      stage: { state: "stage2", label: "Etapa 2" },
      structure: { state: "n/a", label: "", distResistancePct: -1.2, rng26Pct: 32 },
      shadow: {
        g1: true, g2: true, g3: true,
        propuestaProducto: true,
        metrics: { primeraEnAtr: 6, primeraEnAtrVentana: 5.4, dispRatio: -0.12, ultimaEnAtr: 1.2, tightRatio: 0.25, episodeBars: 53 },
      },
      lastBar: "2026-04-24",
    }));
    expect(row.v4).toBe("BASE");
    expect(row.v7).toBe("BASE");
    expect(row.propuestaProducto).toBe(true);
    expect(row.v4Match).toBe("match");
    expect(row.v7Match).toBe("match");
    expect(row.prodMatch).toBe("miss");
  });

  it("NDAQ: dueño NO con v4 FP — v7 no añade FP nuevo en fixture", () => {
    const row = rowFromFixture("NDAQ-2025-11", detectionFixture({
      v4: { base: true, reason: "ok" },
      v5: { base: true, reason: "ok" },
      v7: { base: true, reason: "ok", episode: 1 },
      stage: { state: "stage2", label: "Etapa 2" },
      lastBar: "2025-12-17",
    }));
    expect(row.ownerVerdict).toBe("NO");
    expect(row.v7Match).toBe("false_positive");
  });

  it("VLO reconfig: episodios separados y FN documentado en bloque", () => {
    const evalCases = expandEvaluationCases([], tanda3.casos);
    const vlo = evalCases.filter((c) => c.symbol === "VLO");
    expect(vlo.length).toBeGreaterThanOrEqual(3);
    expect(vlo.filter((c) => c.primary)).toHaveLength(1);
    expect(vlo.map((c) => c.evalId)).toEqual(
      expect.arrayContaining(["VLO-tanda3", "VLO-tanda3::vcp1", "VLO-tanda3::vcp2"]),
    );

    const block = buildResultRow(vlo.find((c) => c.primary), detectionFixture({
      v4: { base: false, reason: "reexpansion" },
      v5: { base: false, reason: "reexpansion" },
      v7: { base: true, reason: "ok", episode: 1 },
      stage: { state: "stage2", label: "Etapa 2" },
      lastBar: "2026-07-07",
    }));
    expect(block.reconfig).toBe(true);
    expect(block.v4Match).toBe("miss");
    expect(block.v7Match).toBe("match");
    expect(block.nota).toMatch(/reconfig FN/i);
  });
});

describe("detectV7 VLO reconfig", () => {
  it("vcp2 @ 2026-07-08 hace match con episodio post-fallo", async () => {
    const evalCases = expandEvaluationCases([], tanda3.casos);
    const vcp2 = evalCases.find((c) => c.evalId === "VLO-tanda3::vcp2");
    expect(vcp2).toBeTruthy();

    const { supabaseRequestAll, supabaseConfig } = await import("@/lib/supabaseServer");
    const { toResearchBars, evaluateAtAsOf } = await import("../research/contracciones/arneses/rubric-gap.mjs");
    const cfg = supabaseConfig();
    if (!cfg.configured) return;

    const rows = await supabaseRequestAll("daily_bars", {
      query: {
        select: "trade_date,open,high,low,close,adj_close,volume",
        owner_id: `eq.${cfg.ownerId}`,
        symbol: "eq.VLO",
        order: "trade_date.asc",
      },
      timeoutMs: 25000,
    }, { maxRows: 5000 });
    const allBars = toResearchBars(rows);
    const detection = evaluateAtAsOf(allBars, "2026-07-08");
    expect(detection.v7.base).toBe(true);
    expect(detection.v4.base).toBe(false);

    const row = buildResultRow(vcp2, detection);
    expect(row.v7Match).toBe("match");
  }, 30000);
});

describe("rubric-gap helpers", () => {
  it("classifyMatch y detectorLabel", () => {
    expect(detectorLabel(true)).toBe("BASE");
    expect(detectorLabel(false)).toBe("no");
    expect(classifyMatch("BASE", true)).toBe("match");
    expect(classifyMatch("BASE", false)).toBe("miss");
    expect(classifyMatch("NO", true)).toBe("false_positive");
    expect(classifyMatch("NO", false)).toBe("match");
  });

  it("summarizeDetector cuenta recall/specificidad solo en filas primarias", () => {
    const rows = [
      { id: "a", veredicto: "BASE", primary: true, v4: { base: true }, v5: { base: true }, v7: { base: true }, prod: { vcpCandidate: false } },
      { id: "b", veredicto: "BASE", primary: true, v4: { base: false }, v5: { base: false }, v7: { base: false }, prod: { vcpCandidate: false } },
      { id: "b::ep", veredicto: "BASE", primary: false, v4: { base: true }, v5: { base: true }, v7: { base: true }, prod: { vcpCandidate: true } },
      { id: "c", veredicto: "NO", primary: true, v4: { base: true }, v5: { base: false }, v7: { base: true }, prod: { vcpCandidate: false } },
      { id: "d", veredicto: "NO", primary: true, v4: { base: false }, v5: { base: false }, v7: { base: false }, prod: { vcpCandidate: false } },
    ];
    const v4 = summarizeDetector(rows, "v4");
    const v7 = summarizeDetector(rows, "v7");
    expect(v4.recallBase).toEqual({ hits: 1, total: 2 });
    expect(v4.specificityNo).toEqual({ hits: 1, total: 2 });
    expect(v4.falsePositives).toEqual(["c"]);
    expect(v4.falseNegatives).toEqual(["b"]);
    expect(v7.falsePositives).toEqual(["c"]);
  });

  it("summarizeDetector v7 independiente de v4", () => {
    const rows = [
      { id: "vlo", veredicto: "BASE", primary: true, v4: { base: false }, v7: { base: true } },
    ];
    expect(summarizeDetector(rows, "v7").recallBase).toEqual({ hits: 1, total: 1 });
  });
});

describe("shadow gates G1–G3", () => {
  it("G1: stage2 y no E2_ma_only sin pata tight", () => {
    expect(gateG1("stage2", "n/a", 1.5).pass).toBe(true);
    expect(gateG1("stage3", "n/a", 1.5).pass).toBe(false);
    expect(gateG1("stage2", STRUCTURE_E2_MA_ONLY, 1.5).pass).toBe(true);
    expect(gateG1("stage2", STRUCTURE_E2_MA_ONLY, null).pass).toBe(false);
    expect(gateG1("stage1", STRUCTURE_E2_MA_ONLY, 1.5).pass).toBe(false);
  });

  it("G2: ELV-like episodio corto lejos del techo", () => {
    expect(gateG2({
      structure: "n/a",
      episodeBars: 16,
      contractionCount: 2,
      distResistancePct: -8.7,
    }).pass).toBe(false);
    expect(gateG2({
      structure: STRUCTURE_E2_STRUCTURAL,
      episodeBars: 16,
      contractionCount: 2,
      distResistancePct: -8.7,
    }).pass).toBe(true);
  });

  it("G3: ventana reciente en episodio largo (fuga NDAQ)", () => {
    expect(gateG3({
      primeraEnAtr: 5.8,
      primeraEnAtrVentana: 2.28,
      ultimaEnAtr: 1.9,
      tightRatio: 0.43,
      episodeBars: 80,
    }).pass).toBe(false);
    expect(gateG3({
      primeraEnAtr: 8.5,
      primeraEnAtrVentana: 3.84,
      ultimaEnAtr: 1.6,
      tightRatio: 0.39,
      episodeBars: 79,
    }).pass).toBe(true);
  });

  it("primeraEnAtrVentana usa ATR en la fecha del máximo", () => {
    const bars = [
      { d: "2025-10-01", h: 100, l: 95, c: 98, v: 1 },
      { d: "2025-10-21", h: 110, l: 100, c: 105, v: 1 },
      { d: "2025-11-18", h: 105, l: 95, c: 100, v: 1 },
      { d: "2025-12-03", h: 108, l: 102, c: 106, v: 1 },
    ];
    for (let i = 0; i < 30; i += 1) {
      bars.unshift({ d: `2025-08-${String(30 - i).padStart(2, "0")}`, h: 90, l: 88, c: 89, v: 1 });
    }
    const fechas = ["2025-10-21→2025-11-18", "2025-11-28→2025-12-03"];
    const contras = [8.8, 3.8];
    expect(primeraEnAtrVentana(bars, fechas, contras, 35)).toBeTypeOf("number");
  });
});

describe("shadow gates corpus anchors", () => {
  const mustReject = [
    "NDAQ-2025-11",
    "ELV-2026-08",
    "MSGS-2026-08",
    "MSI-tanda3",
    "BEKE-2026-08",
  ];
  const mustAccept = [
    "GOOGL-2026-02",
    "VLO-tanda3::vcp1",
  ];

  it("calibración MSI/HPE/NDAQ/ELV/MSGS fuera; GOOGL/VLO vcp1 dentro", async () => {
    const { supabaseRequestAll, supabaseConfig } = await import("@/lib/supabaseServer");
    const { toResearchBars, evaluateAtAsOf } = await import("../research/contracciones/arneses/rubric-gap.mjs");
    const cfg = supabaseConfig();
    if (!cfg.configured) return;

    const evalCases = expandEvaluationCases(corpus.casos, tanda3.casos);
    const hpe = evalCases.find((c) => c.symbol === "HPE" && c.primary);
    const targets = [...mustReject, ...mustAccept];
    if (hpe) targets.push(hpe.evalId ?? "HPE-tanda3");

    for (const id of targets) {
      const evalCase = evalCases.find((c) => c.evalId === id)
        ?? (id === "HPE-tanda3" ? hpe : null);
      expect(evalCase).toBeTruthy();

      const rows = await supabaseRequestAll("daily_bars", {
        query: {
          select: "trade_date,open,high,low,close,adj_close,volume",
          owner_id: `eq.${cfg.ownerId}`,
          symbol: `eq.${evalCase.symbol}`,
          order: "trade_date.asc",
        },
        timeoutMs: 25000,
      }, { maxRows: 5000 });
      const detection = evaluateAtAsOf(toResearchBars(rows), evalCase.evalAsOf ?? evalCase.asOf);
      const row = buildResultRow(evalCase, detection);

      if (mustReject.includes(id) || id === "HPE-tanda3") {
        expect(row.propuestaProducto, id).toBe(false);
      }
      if (mustAccept.includes(id)) {
        expect(row.propuestaProducto, id).toBe(true);
      }
    }
  }, 60000);
});
