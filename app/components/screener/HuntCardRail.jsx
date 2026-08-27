"use client";

import { useEffect, useRef } from "react";
import { HUNT_CARDS, resolveActiveHuntCard } from "@/lib/screenerHuntCards";

export default function HuntCardRail({ presetKey = "", markets = [], onSelect }) {
  const active = resolveActiveHuntCard(presetKey, markets);
  const activeButtonRef = useRef(null);

  useEffect(() => {
    activeButtonRef.current?.scrollIntoView?.({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [active?.id]);

  return (
    <div className="huntCardRail huntCardRailScroll" role="tablist" aria-label="Fichas de caza">
      {HUNT_CARDS.map((card) => {
        const selected = active?.id === card.id;
        return (
          <button
            type="button"
            key={card.id}
            role="tab"
            aria-selected={selected}
            className={selected ? "active" : ""}
            ref={selected ? activeButtonRef : undefined}
            onClick={() => onSelect?.(card.id)}
          >
            {card.label}
          </button>
        );
      })}
    </div>
  );
}
