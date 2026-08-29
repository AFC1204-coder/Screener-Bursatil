import Link from "next/link";
import { filterFamilyEmptyMessage } from "@/lib/filterFamilyCoverage";

export function FilterFamilyEmptyLabel({
  familyKey,
  analyzedCount = 0,
  coverage = {},
  filterLayers = {},
  settings = {},
}) {
  const message = filterFamilyEmptyMessage(familyKey, {
    analyzedCount,
    coverage,
    filterLayers,
    settings,
  });
  if (!message) return null;
  return (
    <span className="emptyResultsCopy">
      {message}{" "}
      {familyKey === "ipo" ? (
        <Link href="/ipo-radar" className="btn btnSmall emptyResultsCta">
          Abrir IPO Radar
        </Link>
      ) : null}
    </span>
  );
}
