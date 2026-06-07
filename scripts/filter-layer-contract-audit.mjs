import fs from "node:fs/promises";

import {
  ALL_FILTER_LAYERS,
  DEFAULT_FIELD_RULES,
  DEFAULT_FILTER_LAYERS,
  FILTER_FAMILY_PRESETS,
  FILTER_FIELDS,
  NEUTRAL_FIELD_VALUES,
  SCREENER_FILTER_PRESETS,
  SCREENER_FILTER_QUERY_KEYS,
  SETTING_LAYER_DEPENDENCIES,
  SETUP_MODES,
  filterLayersForPreset,
  settingsForPreset,
  setupModeLayerRequirements,
} from "@/lib/screenerFilterCatalog";
import {
  effectiveSettingsFromLayers,
  fieldLayerKeys,
  isFieldRuleActive,
  settingApplies,
  settingLayerDependency,
} from "@/lib/screenerFilterLayers";

const MARKDOWN_OUTPUT = process.env.FILTER_LAYER_CONTRACT_MARKDOWN !== "0";
const QUIET = process.env.FILTER_LAYER_CONTRACT_QUIET === "1";
const OUTPUT_PATH = process.env.FILTER_LAYER_CONTRACT_OUTPUT || (MARKDOWN_OUTPUT ? "docs/methodology/latest-filter-layer-contract-audit.md" : "");

const layerKeys = new Set(Object.keys(ALL_FILTER_LAYERS));
const queryKeys = new Set(SCREENER_FILTER_QUERY_KEYS);
const fieldKeys = new Set(FILTER_FIELDS.map((field) => field.key));
const modeKeys = new Set(SETUP_MODES.map(([key]) => key));
const checks = [];
const failures = [];

function cleanText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function mdEscape(value = "") {
  return cleanText(value).replace(/\|/g, "/");
}

function fmt(value) {
  if (value === null || value === undefined || value === "") return "null";
  const n = Number(value);
  if (Number.isFinite(n)) return Math.abs(n) >= 1000 ? n.toLocaleString("en-US") : String(Number(n.toFixed(4)));
  return cleanText(value);
}

function record(area, label, ok, expected = "", actual = "") {
  const item = { area, label, expected, actual };
  if (ok) checks.push(item);
  else failures.push(item);
}

function expect(area, label, condition, expected = "true", actual = "false") {
  record(area, label, Boolean(condition), expected, actual);
}

function expectEqual(area, label, actual, expected) {
  record(area, label, Object.is(actual, expected), fmt(expected), fmt(actual));
}

function nonNeutralValue(key, neutral) {
  if (key.startsWith("max")) return neutral === 999 ? 7 : Number(neutral) - 1;
  if (key.startsWith("min")) return Number(neutral) <= -100 ? 5 : Number(neutral) + 10;
  return Number(neutral) === 0 ? 10 : Number(neutral) + 10;
}

function stressSettings(overrides = {}) {
  const next = {
    ...settingsForPreset("strict"),
    filterStrictness: "strict",
    setupMode: "leader",
    requireStage2: true,
    requireSma200Up: true,
    requirePriceAboveSma50: true,
    requireRecentIpo: true,
    requireUpVolume: true,
    requireContractionsDecreasing: true,
    ...overrides,
  };
  for (const field of FILTER_FIELDS) {
    next[field.key] = nonNeutralValue(field.key, NEUTRAL_FIELD_VALUES[field.key]);
  }
  return next;
}

function disabledFieldsForLayers(layers = DEFAULT_FILTER_LAYERS) {
  return FILTER_FIELDS.filter((field) => !isFieldRuleActive(field, DEFAULT_FIELD_RULES, layers));
}

function trueSetupRequirements(mode = "") {
  if (mode === "weakness") return [["score", true]];
  return Object.entries(setupModeLayerRequirements(mode)).filter(([, required]) => required === true);
}

function simulateLayerAction(layerKey, action = {}) {
  const actionSettings = action.settings || {};
  const fieldLayerUpdates = Object.fromEntries(Object.keys(actionSettings)
    .flatMap((key) => fieldLayerKeys(key))
    .map((key) => [key, true]));
  const settingLayerUpdates = Object.fromEntries(Object.keys(actionSettings)
    .map((key) => settingLayerDependency(key)?.layer)
    .filter(Boolean)
    .map((key) => [key, true]));
  const nextLayers = {
    [layerKey]: true,
    ...fieldLayerUpdates,
    ...settingLayerUpdates,
    ...setupModeLayerRequirements(actionSettings.setupMode),
    ...(action.filterLayers || {}),
  };
  const ruleUpdates = Object.fromEntries(Object.keys(actionSettings)
    .filter((key) => DEFAULT_FIELD_RULES[key] !== undefined)
    .map((key) => [key, true]));
  const layers = { ...DEFAULT_FILTER_LAYERS, ...nextLayers };
  const fieldRules = { ...DEFAULT_FIELD_RULES, ...ruleUpdates, ...(action.fieldRules || {}) };
  const rawSettings = { ...stressSettings(), ...actionSettings };
  const effective = effectiveSettingsFromLayers(rawSettings, layers, fieldRules);
  return { layers, fieldRules, rawSettings, effective };
}

function auditLayerNeutralization() {
  for (const layerKey of layerKeys) {
    const layers = { ...ALL_FILTER_LAYERS, [layerKey]: false };
    const effective = effectiveSettingsFromLayers(stressSettings(), layers, DEFAULT_FIELD_RULES);
    const targets = FILTER_FIELDS.filter((field) => fieldLayerKeys(field).includes(layerKey));
    expect("layers", `${layerKey} has visible fields or dependency coverage`, targets.length > 0 || Object.values(SETTING_LAYER_DEPENDENCIES).some((dependency) => dependency.layer === layerKey));
    for (const field of targets) {
      expectEqual("layers", `${layerKey} off neutralizes ${field.key}`, effective[field.key], NEUTRAL_FIELD_VALUES[field.key]);
    }
  }
}

function auditFieldRuleNeutralization() {
  for (const field of FILTER_FIELDS) {
    const fieldRules = { ...DEFAULT_FIELD_RULES, [field.key]: false };
    const effective = effectiveSettingsFromLayers(stressSettings(), ALL_FILTER_LAYERS, fieldRules);
    expect("fieldRules", `${field.key} disabled is inactive`, !isFieldRuleActive(field, fieldRules, ALL_FILTER_LAYERS));
    expectEqual("fieldRules", `${field.key} disabled preserves but does not cut`, effective[field.key], NEUTRAL_FIELD_VALUES[field.key]);
  }
}

function auditSettingDependencies() {
  for (const [key, dependency] of Object.entries(SETTING_LAYER_DEPENDENCIES)) {
    const layers = { ...ALL_FILTER_LAYERS, [dependency.layer]: false };
    const effective = effectiveSettingsFromLayers(stressSettings({ [key]: true }), layers, DEFAULT_FIELD_RULES);
    expect("settings", `${key} dependency uses known layer`, layerKeys.has(dependency.layer), "known layer", dependency.layer);
    expect("settings", `${key} is visually disabled when ${dependency.layer} is off`, !settingApplies(key, layers));
    expectEqual("settings", `${key} is neutralized when ${dependency.layer} is off`, effective[key], false);
  }
}

function auditSetupModeFallbacks() {
  for (const [mode] of SETUP_MODES) {
    expect("setupModes", `${mode} is known`, modeKeys.has(mode));
    for (const [layerKey] of trueSetupRequirements(mode)) {
      const layers = { ...ALL_FILTER_LAYERS, [layerKey]: false };
      const effective = effectiveSettingsFromLayers(stressSettings({ setupMode: mode }), layers, DEFAULT_FIELD_RULES);
      expectEqual("setupModes", `${mode} falls back when ${layerKey} is off`, effective.setupMode, "any");
    }
  }
}

function auditPresets() {
  for (const [presetKey, preset] of Object.entries(SCREENER_FILTER_PRESETS)) {
    const layers = filterLayersForPreset(presetKey);
    const effective = effectiveSettingsFromLayers(preset.v, layers, DEFAULT_FIELD_RULES);
    const disabledFields = disabledFieldsForLayers(layers);
    expect("presets", `${presetKey} preset has a known setup mode`, modeKeys.has(effective.setupMode || "leader"), "known mode", effective.setupMode || "leader");
    for (const [layerKey] of trueSetupRequirements(effective.setupMode)) {
      expect("presets", `${presetKey} satisfies ${effective.setupMode}:${layerKey}`, layers[layerKey] !== false, "layer on", "layer off");
    }
    for (const field of disabledFields) {
      expectEqual("presets", `${presetKey} neutralizes disabled ${field.key}`, effective[field.key], NEUTRAL_FIELD_VALUES[field.key]);
    }
  }
}

function auditFamilyActions() {
  for (const [layerKey, family] of Object.entries(FILTER_FAMILY_PRESETS)) {
    expect("actions", `${layerKey} family maps to known layer`, layerKeys.has(layerKey), "known layer", layerKey);
    for (const action of family.actions || []) {
      const label = `${layerKey}:${action.label}`;
      for (const key of Object.keys(action.settings || {})) {
        expect("actions", `${label} setting ${key} is known`, queryKeys.has(key), "known query key", key);
      }
      for (const key of Object.keys(action.filterLayers || {})) {
        expect("actions", `${label} filter layer ${key} is known`, layerKeys.has(key), "known layer", key);
      }
      for (const key of Object.keys(action.fieldRules || {})) {
        expect("actions", `${label} field rule ${key} is known`, fieldKeys.has(key), "known field", key);
      }

      const simulated = simulateLayerAction(layerKey, action);
      for (const field of FILTER_FIELDS) {
        if (!isFieldRuleActive(field, simulated.fieldRules, simulated.layers)) {
          expectEqual("actions", `${label} neutralizes inactive ${field.key}`, simulated.effective[field.key], NEUTRAL_FIELD_VALUES[field.key]);
        }
      }
      for (const [key, dependency] of Object.entries(SETTING_LAYER_DEPENDENCIES)) {
        if (simulated.layers[dependency.layer] === false) {
          expectEqual("actions", `${label} neutralizes inactive ${key}`, simulated.effective[key], false);
        }
      }
      for (const [requiredLayer] of trueSetupRequirements(simulated.effective.setupMode)) {
        expect("actions", `${label} satisfies ${simulated.effective.setupMode}:${requiredLayer}`, simulated.layers[requiredLayer] !== false, "layer on", "layer off");
      }
    }
  }
}

function renderMarkdown() {
  const total = checks.length + failures.length;
  const byArea = new Map();
  for (const item of [...checks, ...failures]) {
    const prev = byArea.get(item.area) || { checks: 0, failures: 0 };
    prev.checks += 1;
    if (failures.includes(item)) prev.failures += 1;
    byArea.set(item.area, prev);
  }
  const areaRows = [...byArea.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([area, stats]) => `| ${mdEscape(area)} | ${stats.checks - stats.failures}/${stats.checks} | ${stats.failures ? "FAIL" : "OK"} |`)
    .join("\n");
  const failureRows = failures.slice(0, 80)
    .map((item) => `| ${mdEscape(item.area)} | ${mdEscape(item.label)} | ${mdEscape(item.expected)} | ${mdEscape(item.actual)} |`)
    .join("\n");
  return [
    "# Filter Layer Contract Audit",
    "",
    `- Checks: ${total}`,
    `- Passed: ${checks.length}`,
    `- Failed: ${failures.length}`,
    "",
    "## Areas",
    "",
    "| Area | Pass | Status |",
    "|---|---:|---|",
    areaRows,
    "",
    failures.length
      ? [
        "## Failures",
        "",
        "| Area | Check | Expected | Actual |",
        "|---|---|---|---|",
        failureRows,
      ].join("\n")
      : "## Failures\n\nNo failures.",
    "",
  ].join("\n");
}

auditLayerNeutralization();
auditFieldRuleNeutralization();
auditSettingDependencies();
auditSetupModeFallbacks();
auditPresets();
auditFamilyActions();

if (OUTPUT_PATH) await fs.writeFile(OUTPUT_PATH, renderMarkdown(), "utf8");

if (!QUIET || failures.length) {
  console.log(`Filter layer contract audit: ${checks.length}/${checks.length + failures.length} passed`);
  if (OUTPUT_PATH) console.log(`Report: ${OUTPUT_PATH}`);
}

if (failures.length) {
  for (const failure of failures.slice(0, 20)) {
    console.error(`[${failure.area}] ${failure.label}: expected ${failure.expected}, got ${failure.actual}`);
  }
  process.exitCode = 1;
}
