// lib/huntCardModeDisclosure.js — modo discovery/strict/balanced y puertas por ficha hunt.
// Fuente: SCREENER_FILTER_PRESETS + HUNT_CARDS; sin side effects.

import {
  FILTER_FAMILIES,
  FILTER_STRICTNESS,
  NEUTRAL_FIELD_VALUES,
  filterStrictnessForPreset,
  settingsForPreset,
} from "@/lib/screenerFilterCatalog";
import { huntCardById, resolveActiveHuntCard } from "@/lib/screenerHuntCards";

const PRESET_DOOR_PRIORITY = {
  balanced: ["trend", "liquidity", "momentum", "relativeStrength", "score", "proximity"],
  nearPivot: ["proximity", "trend", "relativeStrength", "liquidity", "score"],
  weakness: ["score", "liquidity"],
  intl: ["liquidity", "coverage"],
  ipoDiscovery: ["ipo", "liquidity"],
};

const MODE_DOOR_LIMIT = {
  discovery: 3,
  balanced: 5,
  strict: 6,
};

const SETTING_DOOR_SPECS = {
  requireStage2: { label: "Etapa 2 mínima", familyKey: "trend" },
  requirePulso: { label: "Pulso alcista", familyKey: "trend" },
  requireRecentIpo: {
    label: (values) => `IPO reciente ≤ ${values.maxIpoAgeMonths}m`,
    familyKey: "ipo",
  },
  requireUpVolume: { label: "Volumen alcista", familyKey: "volumeSurge" },
};

function isFieldActive(key, value) {
  if (!(key in NEUTRAL_FIELD_VALUES)) {
    return value !== undefined && value !== null && value !== false;
  }
  return Number(value) !== Number(NEUTRAL_FIELD_VALUES[key]);
}

function familyLabel(familyKey) {
  return FILTER_FAMILIES[familyKey]?.label || familyKey;
}

function familyHasActiveFields(familyKey, values) {
  const family = FILTER_FAMILIES[familyKey];
  if (!family) return false;
  if ((family.settingKeys || []).some((key) => values[key] === true)) return true;
  return family.fields.some((field) => isFieldActive(field.key, values[field.key]));
}

function doorFromSetting(key, values) {
  const spec = SETTING_DOOR_SPECS[key];
  if (!spec || values[key] !== true) return null;
  const label = typeof spec.label === "function" ? spec.label(values) : spec.label;
  return {
    label,
    familyKey: spec.familyKey,
    familyLabel: familyLabel(spec.familyKey),
  };
}

function buildFamilyDoorSummary(familyKey, values) {
  const family = FILTER_FAMILIES[familyKey];
  if (!family) return null;

  for (const key of family.settingKeys || []) {
    const door = doorFromSetting(key, values);
    if (door) return door;
  }

  if (familyKey === "score" && isFieldActive("minWeaknessScore", values.minWeaknessScore)) {
    return {
      label: `Deterioro ≥ ${values.minWeaknessScore}`,
      familyKey: "score",
      familyLabel: family.label,
    };
  }

  if (familyKey === "liquidity" && familyHasActiveFields("liquidity", values)) {
    return {
      label: "Liquidez mínima (precio, cap, volumen)",
      familyKey: "liquidity",
      familyLabel: family.label,
    };
  }

  const activeFields = family.fields.filter((field) => isFieldActive(field.key, values[field.key]));
  if (!activeFields.length) return null;

  if (familyKey === "momentum") {
    const parts = [];
    if (isFieldActive("minPerf3m", values.minPerf3m)) parts.push(`3M ≥ ${values.minPerf3m}%`);
    if (isFieldActive("minPerf6m", values.minPerf6m)) parts.push(`6M ≥ ${values.minPerf6m}%`);
    if (isFieldActive("minPerf12m", values.minPerf12m)) parts.push(`12M ≥ ${values.minPerf12m}%`);
    if (parts.length) {
      return {
        label: parts.slice(0, 2).join(" · "),
        familyKey,
        familyLabel: family.label,
      };
    }
  }

  if (familyKey === "relativeStrength" && isFieldActive("minRsRating", values.minRsRating)) {
    return {
      label: `RS global ≥ ${values.minRsRating}`,
      familyKey,
      familyLabel: family.label,
    };
  }

  if (familyKey === "proximity") {
    const parts = [];
    if (isFieldActive("maxDistance52w", values.maxDistance52w)) parts.push(`52s ≤ ${values.maxDistance52w}%`);
    if (isFieldActive("maxExtensionSma50", values.maxExtensionSma50)) {
      parts.push(`ext. SMA50 ≤ ${values.maxExtensionSma50}%`);
    }
    if (parts.length) {
      return {
        label: parts.join(" · "),
        familyKey,
        familyLabel: family.label,
      };
    }
  }

  if (familyKey === "coverage") {
    return {
      label: "Cobertura de datos mínima",
      familyKey,
      familyLabel: family.label,
    };
  }

  const first = activeFields[0];
  return {
    label: `${first.label} ${values[first.key]}${first.unit || ""}`.trim(),
    familyKey,
    familyLabel: family.label,
  };
}

function buildDoors(presetKey, values, mode) {
  const priority = PRESET_DOOR_PRIORITY[presetKey] || PRESET_DOOR_PRIORITY.balanced;
  const limit = MODE_DOOR_LIMIT[mode] || MODE_DOOR_LIMIT.balanced;
  const doors = [];
  const seenLabels = new Set();

  for (const familyKey of priority) {
    if (doors.length >= limit) break;
    if (!familyHasActiveFields(familyKey, values)) continue;
    const door = buildFamilyDoorSummary(familyKey, values);
    if (!door || seenLabels.has(door.label)) continue;
    doors.push(door);
    seenLabels.add(door.label);
  }

  return doors;
}

/**
 * @param {{ cardId?: string, presetKey?: string, markets?: string[] }} params
 * @returns {null | {
 *   cardId: string,
 *   cardLabel: string,
 *   presetKey: string,
 *   mode: string,
 *   modeLabel: string,
 *   modeDesc: string,
 *   modeBadgeLabel: string,
 *   doors: Array<{ label: string, familyKey?: string, familyLabel?: string }>,
 *   summaryLine: string,
 * }}
 */
export function huntCardModeDisclosure({ cardId = "", presetKey = "", markets = [] } = {}) {
  const card = cardId
    ? huntCardById(cardId)
    : resolveActiveHuntCard(presetKey, markets);
  if (!card) return null;

  const effectivePresetKey = card.presetKey;
  const values = settingsForPreset(effectivePresetKey);
  const mode = filterStrictnessForPreset(effectivePresetKey);
  const strictnessMeta = FILTER_STRICTNESS[mode] || FILTER_STRICTNESS.balanced;
  const doors = buildDoors(effectivePresetKey, values, mode);
  const modeBadgeLabel = mode === "discovery"
    ? "Discovery"
    : mode === "strict"
      ? "Strict"
      : "Balanceado";

  return {
    cardId: card.id,
    cardLabel: card.label,
    presetKey: effectivePresetKey,
    mode,
    modeLabel: strictnessMeta.name,
    modeDesc: strictnessMeta.desc,
    modeBadgeLabel,
    doors,
    summaryLine: doors.length
      ? `${strictnessMeta.name} · ${doors.length} puerta${doors.length === 1 ? "" : "s"}`
      : strictnessMeta.name,
  };
}
