import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  FilterArchitecturePanel,
  FilterFamilyModal,
  FilterNumber,
  FilterToggle,
  LayerControl,
  LayerToggleButton,
} from "@/lib/screenerFiltersView";
import { FILTER_FAMILIES, FILTER_FAMILY_ORDER, SETTING_LAYER_DEPENDENCIES } from "@/lib/screenerFilterCatalog";
import { PRIVATE_GLOBAL_RS_DISCLOSURE } from "@/lib/rsEngines";

function walkElements(node, predicate, results = []) {
  if (!node) return results;
  if (Array.isArray(node)) {
    node.forEach((child) => walkElements(child, predicate, results));
    return results;
  }
  if (predicate(node)) results.push(node);
  const children = node?.props?.children;
  if (children) walkElements(children, predicate, results);
  return results;
}


describe("LayerControl · toggle vs abrir", () => {
  it("renderiza toggle aislado, meta y botón Abrir separados", () => {
    const html = renderToStaticMarkup(React.createElement(LayerControl, {
      active: true,
      onClick: () => {},
      onOpen: () => {},
      label: "RS",
      detail: "Relative Strength",
      countLabel: "6 reglas",
    }));

    expect(html).toContain("layerPowerToggle");
    expect(html).toContain("layerOpenBtn");
    expect(html).toContain("Abrir ▸");
    expect(html).not.toContain("Ajustar");
    expect(html).toContain("Relative Strength");
    expect(html).toContain("6 reglas");
  });

  it("mantiene Abrir disponible cuando la capa está apagada", () => {
    const html = renderToStaticMarkup(React.createElement(LayerControl, {
      active: false,
      onClick: () => {},
      onOpen: () => {},
      label: "IPO",
      detail: "solo recientes reales",
      countLabel: "2 reglas",
    }));

    expect(html).toContain('class="layerControlRow off hasOpen"');
    expect(html).toContain("layerOpenBtn");
    expect(html).toContain('aria-pressed="false"');
  });

  it("clic en Abrir no invoca toggle; toggle no abre modal", () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();

    const toggleEl = React.createElement(LayerToggleButton, {
      active: true,
      onClick: onToggle,
      label: "RS",
    });
    toggleEl.props.onClick();
    expect(onToggle).toHaveBeenCalledTimes(1);

    const tree = LayerControl({
      active: true,
      onClick: onToggle,
      onOpen,
      label: "RS",
      detail: "Relative Strength",
      countLabel: "6 reglas",
    });
    const [openBtn] = walkElements(tree, (node) => typeof node?.props?.className === "string" && node.props.className.includes("layerOpenBtn"));
    expect(openBtn).toBeTruthy();

    onOpen.mockClear();
    onToggle.mockClear();
    openBtn.props.onClick();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("muestra barra de intensidad solo en pilotos IPO y RS", () => {
    const rsHtml = renderToStaticMarkup(React.createElement(LayerControl, {
      active: true,
      onClick: () => {},
      onOpen: () => {},
      label: "RS",
      detail: "",
      countLabel: "6 reglas",
      intensity: 50,
      intensityCustom: false,
      intensitySummary: "RS global ≥ 55",
      onIntensityChange: () => {},
      onIntensityCommit: () => {},
    }));
    const liqHtml = renderToStaticMarkup(React.createElement(LayerControl, {
      active: true,
      onClick: () => {},
      onOpen: () => {},
      label: "Liquidez",
      detail: "precio, cap, importe",
      countLabel: "5 reglas",
    }));

    expect(rsHtml).toContain("filterIntensitySlider");
    expect(rsHtml).toContain("RS global ≥ 55");
    expect(liqHtml).not.toContain("filterIntensitySlider");
  });

  it("muestra aviso de cobertura baja en tarjeta activa", () => {
    const html = renderToStaticMarkup(React.createElement(LayerControl, {
      active: true,
      onClick: () => {},
      onOpen: () => {},
      label: "RS",
      detail: "",
      countLabel: "6 reglas",
      coverageWarning: "⚠ RS con dato en 25/47",
    }));
    expect(html).toContain("layerCoverageWarning");
    expect(html).toContain("25/47");
  });
});

describe("FilterFamilyModal · power toggle aislado", () => {
  const baseProps = {
    layerKey: "relativeStrength",
    settings: {},
    filterLayers: { relativeStrength: true },
    fieldRules: {},
    onClose: () => {},
    onToggleLayer: vi.fn(),
    onApplyAction: vi.fn(),
    onUpdateSetting: vi.fn(),
    onToggleFieldRule: vi.fn(),
    onToggleLayeredSetting: vi.fn(),
  };

  it("coloca el power toggle en la cabecera, no en la toolbar de exigencia", () => {
    const html = renderToStaticMarkup(React.createElement(FilterFamilyModal, baseProps));

    expect(html).toContain("filterFamilyHeaderActions");
    expect(html).toContain("filterFamilyPower");
    expect(html).not.toMatch(/filterFamilyToolbar[\s\S]*filterFamilyPower/);
    expect(html).toContain("Exigencia");
  });

  it("toggle del modal no comparte handler con cerrar", () => {
    const onToggleLayer = vi.fn();
    const onClose = vi.fn();
    const tree = FilterFamilyModal({
      ...baseProps,
      onToggleLayer,
      onClose,
    });

    const [powerBtn] = walkElements(tree, (node) => node?.props?.["aria-pressed"] === true);
    expect(powerBtn).toBeTruthy();
    powerBtn.props.onClick();

    expect(onToggleLayer).toHaveBeenCalledWith("relativeStrength");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("muestra barra de intensidad y pliegue Auxiliares en RS", () => {
    const html = renderToStaticMarkup(React.createElement(FilterFamilyModal, {
      ...baseProps,
      familyIntensity: 55,
      familyIntensityCustom: false,
      onFamilyIntensityChange: () => {},
      onFamilyIntensityCommit: () => {},
    }));

    expect(html).toContain("filterIntensitySlider");
    expect(html).toContain("Auxiliares");
    expect(html).toContain(PRIVATE_GLOBAL_RS_DISCLOSURE.split(" ")[0]);
  });

  it("muestra cobertura N/M en cabecera del modal", () => {
    const html = renderToStaticMarkup(React.createElement(FilterFamilyModal, {
      ...baseProps,
      familyCoverage: { total: 47, withRsData: 25, low: true },
    }));
    expect(html).toContain("filterFamilyCoverage");
    expect(html).toContain("RS semanal en 25/47 del lote");
  });
});

const allLayersOn = Object.fromEntries(FILTER_FAMILY_ORDER.map((key) => [key, true]));

function familyModalProps(layerKey) {
  return {
    layerKey,
    settings: {},
    filterLayers: allLayersOn,
    fieldRules: {},
    onClose: () => {},
    onToggleLayer: () => {},
    onApplyAction: () => {},
    onUpdateSetting: () => {},
    onToggleFieldRule: () => {},
    onToggleLayeredSetting: () => {},
  };
}

describe("FilterFamilyModal · cobertura por familia (gate SHELL-A)", () => {
  it("expone reglas de campo de las 14 familias, no solo IPO/RS", () => {
    expect(FILTER_FAMILY_ORDER).toHaveLength(14);
    for (const key of FILTER_FAMILY_ORDER) {
      const family = FILTER_FAMILIES[key];
      const tree = FilterFamilyModal(familyModalProps(key));
      const fieldNodes = walkElements(tree, (node) => node?.type === FilterNumber);
      expect(fieldNodes.map((node) => node.props.field.key).sort()).toEqual(
        family.fields.map((field) => field.key).sort(),
      );

      const expectedSettings = Object.entries(SETTING_LAYER_DEPENDENCIES)
        .filter(([, dependency]) => dependency.layer === key)
        .map(([settingKey]) => settingKey)
        .sort();
      expect(expectedSettings).toEqual([...(family.settingKeys || [])].sort());
      const toggleNodes = walkElements(tree, (node) => node?.type === FilterToggle);
      expect(toggleNodes).toHaveLength(expectedSettings.length);
    }
  });

  it("Tendencia incluye definición de etapa y los interruptores de la familia", () => {
    const html = renderToStaticMarkup(React.createElement(FilterFamilyModal, familyModalProps("trend")));
    expect(html).toContain("Definición de etapa");
    expect(html).toContain("Media rápida semanal");
    expect(html).toContain("Media lenta semanal");
    expect(html).toContain("Pendiente semanas");
    expect(html).toContain("Media plana");
    expect(html).toContain("Etapa 2");
    expect(html).toContain("Pulso");
  });

  it("Volumen+ e IPO reciben los interruptores huérfanos del aside", () => {
    const volumeHtml = renderToStaticMarkup(React.createElement(FilterFamilyModal, familyModalProps("volumeSurge")));
    const ipoHtml = renderToStaticMarkup(React.createElement(FilterFamilyModal, familyModalProps("ipo")));
    expect(volumeHtml).toContain("Volumen en vela alcista");
    expect(ipoHtml).toContain("IPO real reciente");
  });
});

describe("FilterArchitecturePanel · SHELL-B", () => {
  it("ya no duplica Vista de resultados (chips UX-7 + «+ Filtro»)", () => {
    const html = renderToStaticMarkup(React.createElement(FilterArchitecturePanel, {
      filterLayers: { trend: true },
      useRegimeFilter: true,
      onToggleLayer: () => {},
      onToggleRegime: () => {},
      sheetFamilyKeys: ["trend"],
      cardLabel: "Líderes Etapa 2",
    }));
    expect(html).toContain("filterArchitecture");
    expect(html).not.toContain("viewLayerMini");
    expect(html).not.toContain("Vista de resultados");
  });
});

describe("FilterArchitecturePanel · SHELL-C familias de ficha", () => {
  it("muestra familias de la ficha al primer nivel y otras plegadas", () => {
    const html = renderToStaticMarkup(React.createElement(FilterArchitecturePanel, {
      filterLayers: { trend: true, ipo: true },
      useRegimeFilter: false,
      onToggleLayer: () => {},
      onToggleRegime: () => {},
      sheetFamilyKeys: ["trend", "liquidity", "momentum", "relativeStrength", "score", "proximity"],
      cardLabel: "Líderes Etapa 2",
    }));
    expect(html).toContain("filterSheetFamilies");
    expect(html).toContain("Ficha activa");
    expect(html).toContain("Líderes Etapa 2");
    expect(html).toContain("filterOtherFamiliesDisclosure");
    expect(html).toContain("Otras familias");
    expect(html).toContain("Volver a la ficha");
    expect(html).not.toContain("filterArchitectureHead");
    expect(html).not.toContain("Núcleo");
    expect(html).not.toContain("Adicionales");
  });
});
