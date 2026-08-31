// lib/themeRsAssign.js — asignación de theme para ranking RS tema (MET-3b).
// Solo las 12 keys de THEME_RULES; residual/General/sector Yahoo no rankean.

import { inferBusinessTheme, THEME_RULES } from "@/lib/businessTheme";

const RANKABLE_KEYS = new Set(THEME_RULES.map((rule) => rule.key));

export const THEME_PROFILE_MISSING = "theme-profile-missing";
export const THEME_RESIDUAL = "theme-residual";
export const THEME_SAMPLE_INSUFFICIENT = "theme-sample-insufficient";

export function isRankableThemeKey(key = "") {
  return RANKABLE_KEYS.has(String(key || "").trim());
}

export function rankableThemeKeys() {
  return THEME_RULES.map((rule) => rule.key);
}

export function hasMinimumThemeProfile(sector = "", industry = "", summary = "") {
  return Boolean(
    String(sector || "").trim()
      || String(industry || "").trim()
      || String(summary || "").trim(),
  );
}

/**
 * @returns {{ themeKey: string|null, exclusionReason: string|null }}
 */
export function rankableThemeForProfile(sector = "", industry = "", summary = "") {
  if (!hasMinimumThemeProfile(sector, industry, summary)) {
    return { themeKey: null, exclusionReason: THEME_PROFILE_MISSING };
  }
  const inferred = inferBusinessTheme(sector, industry, summary);
  if (isRankableThemeKey(inferred.key)) {
    return { themeKey: inferred.key, exclusionReason: null };
  }
  return { themeKey: null, exclusionReason: THEME_RESIDUAL };
}
