import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionOperatingBrief } from "@/lib/screenerDomains/decision";

// Presupuesto de énfasis de la PANTALLA PRINCIPAL.
//
// Antes había exactamente 1 elemento data-emphasis="E1" (la lectura operativa
// dentro de DecisionGroups). Los paneles de auditoría interna —Decisiones,
// Auditoría y datos, Calidad de decisión, Descubrimiento global curado— se
// retiraron de la pantalla principal por el principio 1 de
// docs/principios-producto.md ("clasifica, no recomienda"), así que el
// presupuesto de la pantalla pasa a CERO: ningún elemento compite por atención
// E1 en el screener.
//
// Los componentes NO se han borrado: siguen vivos y probados en
// tests/decisionQualityStrip.test.js, y su versión por fila alimenta la ficha
// del valor. Lo que se fija aquí es que la pantalla principal no los monte.

const SHELL = readFileSync(new URL("../app/components/screener/ScreenerShell.jsx", import.meta.url), "utf8");
const MOBILE = readFileSync(new URL("../lib/screenerMobile.jsx", import.meta.url), "utf8");

const RETIRADOS = [
  "DecisionGroups",
  "DecisionOperatingBrief",
  "DecisionQualityStrip",
  "DecisionSummaryRail",
  "DecisionEvidenceSummaryRail",
  "DataHealthSummaryRail",
  "ScoreAuditSummaryRail",
  "AuditabilitySummaryRail",
  "PendingDecisionWorkRail",
  "ReviewPriorityResultRail",
  "CuratedDiscoveryPanel",
];

describe("presupuesto de énfasis · pantalla principal", () => {
  it("el shell de escritorio no monta ningún panel de auditoría interna", () => {
    for (const componente of RETIRADOS) {
      expect(SHELL, `ScreenerShell no debe referenciar ${componente}`).not.toContain(componente);
    }
  });

  it("la superficie móvil tampoco los monta", () => {
    for (const componente of RETIRADOS) {
      expect(MOBILE, `screenerMobile no debe referenciar ${componente}`).not.toContain(componente);
    }
  });

  it("no queda ningún data-emphasis=\"E1\" en la pantalla principal", () => {
    expect(SHELL).not.toContain('emphasis="E1"');
    expect(MOBILE).not.toContain('emphasis="E1"');
  });

  it("DecisionOperatingBrief sigue existiendo y es E2 fuera de la pantalla principal", () => {
    const html = renderToStaticMarkup(
      createElement(DecisionOperatingBrief, {
        audit: { rows: 3, decisions: {}, decisionQuality: {} },
        rows: [{ symbol: "ALPHA", objectiveScore: 80, totalScore: 82 }],
      })
    );
    expect(html).toContain('data-emphasis="E2"');
    expect(html).not.toContain('data-emphasis="E1"');
  });
});

// Decisión de 2026-08-12: la pantalla principal no filtra por juicios del
// sistema. «Fiabilidad», «Confianza» y «Acción» —esta última ofrecía
// literalmente «Vigilancia» y «Auditar»— se retiraron de las dos superficies,
// junto con «Prioridad», que solo quedaba en móvil. Sus filtros y contadores
// siguen calculándose en useResultViewModel.
// «Resolución» se conserva: filtra por lo que el usuario marcó en Review/Ficha,
// no por un juicio del sistema.
const FILTER_BAR = readFileSync(new URL("../app/components/screener/ResultFilterBar.jsx", import.meta.url), "utf8");

const FILTROS_RETIRADOS = [
  ["fiabilidad", "Filtrar por fiabilidad de observacion"],
  ["confianza", "Filtrar por confianza de decision"],
  ["acción sugerida", "Filtrar por accion sugerida"],
  ["prioridad", "Filtrar por prioridad de investigacion"],
];

describe("filtros de la pantalla principal", () => {
  for (const [nombre, ariaLabel] of FILTROS_RETIRADOS) {
    it(`no ofrece el filtro de ${nombre} en escritorio ni en móvil`, () => {
      expect(FILTER_BAR).not.toContain(ariaLabel);
      expect(MOBILE).not.toContain(ariaLabel);
    });
  }

  it("conserva «Resolución» en ambas superficies", () => {
    expect(FILTER_BAR).toContain("Filtrar por resolución de decisión");
    expect(MOBILE).toContain("Filtrar por resolución de decisión");
  });
});
