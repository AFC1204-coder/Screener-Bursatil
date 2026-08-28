import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FilterFamilyModal, LayerControl, LayerToggleButton } from "@/lib/screenerFiltersView";

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
});
