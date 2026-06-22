import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RowTrustSignature from "@/app/RowTrustSignature";
import { buildRowTrustSignature } from "@/lib/rowTrustSignature";

function visibleText(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("row trust signature", () => {
  it("resume objetivo, proxy, revisión y bloqueo sin texto largo visible", () => {
    const signature = buildRowTrustSignature({
      dataHealth: {
        status: { key: "stale", label: "Precio viejo", tone: "warn", detail: "precio con 9 dias de desfase" },
        topLine: "Cob 72",
      },
      metricTruth: {
        key: "review",
        measuredCount: 28,
        proxyCount: 2,
        title: "28 medidas · 2 proxy/estimadas · SMA50: missing",
      },
      scoreAudit: {
        integrityTone: "warn",
        residual: 5.2,
        topLine: "Score 82 · calc 76.8",
        missing: [],
      },
      evidence: { status: "needs-work", tone: "warn", summary: "Demanda pendiente" },
      vcpReliability: { key: "needs-validation", tone: "warn", label: "Validar VCP", summary: "volumen parcial" },
      rowIssues: [{ key: "risk", label: "Riesgo crítico", severity: "bad", detail: "rentabilidad/riesgo pobre" }],
    });

    expect(signature).toMatchObject({
      measuredCount: 28,
      proxyCount: 2,
      reviewCount: 5,
      blockedCount: 1,
      tone: "bad",
    });

    const html = renderToStaticMarkup(React.createElement(RowTrustSignature, { signature }));
    const visible = visibleText(html);

    expect(html).toContain("rowTrustSignature bad");
    expect(visible).toContain("Obj 28");
    expect(visible).toContain("p 2");
    expect(visible).toContain("! 5");
    expect(visible).toContain("x 1");
    expect(visible).not.toContain("precio con 9 dias de desfase");
    expect(html).toContain("precio con 9 dias de desfase");
  });

  it("acepta metadatos compactos de review/listas sin perder revisión o bloqueo", () => {
    const signature = buildRowTrustSignature({
      dataHealth: { key: "ready", label: "OK", tone: "good", detail: "datos aptos" },
      metricTruth: { key: "mixed", measuredCount: 3, proxyCount: 1, detail: "3 medidas · 1 proxy" },
      scoreAudit: { key: "missing", label: "Inc.", tone: "warn", detail: "faltan componentes" },
      evidence: { status: "ready", tone: "good", summary: "pruebas listas" },
    });

    expect(signature).toMatchObject({
      measuredCount: 3,
      proxyCount: 1,
      reviewCount: 1,
      blockedCount: 0,
      tone: "warn",
    });

    const visible = visibleText(renderToStaticMarkup(React.createElement(RowTrustSignature, { signature })));
    expect(visible).toContain("Obj 3");
    expect(visible).toContain("p 1");
    expect(visible).toContain("! 1");
    expect(visible).toContain("x 0");
  });
});
