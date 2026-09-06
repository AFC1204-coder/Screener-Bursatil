"use client";

import { buildIpoCohortWindowChips, isIpoCohortLensActive } from "@/lib/ipoCohortWindowChips";

export default function IpoCohortWindowChips({
  presetKey = "",
  cardId = "",
  analyzedRows = [],
  activeSettings = {},
  onSelectWindow,
}) {
  if (!isIpoCohortLensActive({ presetKey, cardId })) return null;

  const chips = buildIpoCohortWindowChips({
    analyzedRows,
    baseSettings: activeSettings,
    activeMonths: activeSettings.maxIpoAgeMonths,
  });

  return (
    <div className="ipoCohortWindowChips" role="group" aria-label="Ventana de edad IPO">
      <span className="ipoCohortWindowLabel">Salida</span>
      {chips.map((chip) => (
        <button
          key={chip.months}
          type="button"
          className={`ipoCohortWindowChip${chip.active ? " active" : ""}`}
          aria-pressed={chip.active}
          title={`Salida ≤ ${chip.months} meses · ${chip.count} en esta ventana`}
          onClick={() => onSelectWindow?.(chip.months)}
        >
          <span>{chip.label}</span>
          <i className="ipoCohortWindowChipCount">{chip.count}</i>
        </button>
      ))}
    </div>
  );
}
