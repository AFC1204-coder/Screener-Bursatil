import { FilterFamilyEmptyLabel } from "@/lib/filterFamilyEmpty";

/** @deprecated Usar FilterFamilyEmptyLabel con familyKey="ipo". */
export function IpoDiscoveryEmptyLabel({ analyzedCount = 0, coverage = {} }) {
  return (
    <FilterFamilyEmptyLabel
      familyKey="ipo"
      analyzedCount={analyzedCount}
      coverage={coverage}
      filterLayers={{ ipo: true }}
      settings={{ requireRecentIpo: true }}
    />
  );
}
