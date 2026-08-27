"use client";

import { HUNT_CARDS, resolveActiveHuntCard } from "@/lib/screenerHuntCards";

export default function HuntCardRail({ presetKey = "", markets = [], onSelect }) {
  const active = resolveActiveHuntCard(presetKey, markets);
  return (
    <div className="huntCardRail" role="tablist" aria-label="Fichas de caza">
      {HUNT_CARDS.map((card) => {
        const selected = active?.id === card.id;
        return (
          <button
            type="button"
            key={card.id}
            role="tab"
            aria-selected={selected}
            className={selected ? "active" : ""}
            onClick={() => onSelect?.(card.id)}
          >
            {card.label}
          </button>
        );
      })}
    </div>
  );
}
