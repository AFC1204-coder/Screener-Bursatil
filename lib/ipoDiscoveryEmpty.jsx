import Link from "next/link";
import { ipoDiscoveryEmptyMessage } from "@/lib/ipoDiscoveryView";

export function IpoDiscoveryEmptyLabel({ analyzedCount = 0, coverage = {} }) {
  return (
    <span className="emptyResultsCopy">
      {ipoDiscoveryEmptyMessage({ analyzedCount, coverage })}{" "}
      <Link href="/ipo-radar" className="btn btnSmall emptyResultsCta">
        Abrir IPO Radar
      </Link>
    </span>
  );
}
