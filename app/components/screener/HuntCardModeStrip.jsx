"use client";

import { buildHuntCardRsChip, HUNT_RS_COPY_SHORT } from "@/lib/huntCardRsPresentation";
import { huntCardModeDisclosure } from "@/lib/huntCardModeDisclosure";

export default function HuntCardModeStrip({
  presetKey = "",
  markets = [],
  passedRows = [],
  onOpenFamily,
}) {
  const disclosure = huntCardModeDisclosure({ presetKey, markets });
  if (!disclosure) return null;

  const rsChip = buildHuntCardRsChip({
    cardId: disclosure.cardId,
    passedRows,
  });

  return (
    <div className="huntCardModeStrip" role="region" aria-label={`Modo de ${disclosure.cardLabel}`}>
      <span
        className={`huntCardModeBadge huntCardModeBadge--${disclosure.mode}`}
        title={disclosure.modeDesc}
      >
        {disclosure.modeBadgeLabel}
      </span>
      {rsChip ? (
        <span
          className="huntCardRsChip"
          title={rsChip.title}
          aria-label={`${rsChip.label}. ${rsChip.title}`}
        >
          {rsChip.label}
        </span>
      ) : null}
      <details className="huntCardModeDisclosure">
        <summary>
          <span>Qué aplica esta ficha</span>
          <em>{disclosure.summaryLine}</em>
        </summary>
        <div className="huntCardModeDisclosureBody">
          <p className="huntCardModeIntro">
            Ficha «{disclosure.cardLabel}» · modo {disclosure.modeLabel.toLowerCase()}
          </p>
          {rsChip ? (
            <p className="huntCardRsNote">{HUNT_RS_COPY_SHORT}</p>
          ) : null}
          <ul className="huntCardModeDoors">
            {disclosure.doors.map((door) => (
              <li key={door.label}>
                <span>{door.label}</span>
                {door.familyKey && onOpenFamily ? (
                  <button
                    type="button"
                    className="huntCardModeFamilyLink"
                    onClick={() => onOpenFamily(door.familyKey)}
                  >
                    Abrir familia
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
