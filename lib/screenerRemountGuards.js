import { screenerSessionDataExpired } from "@/lib/nightlyBoundary";
import { localScanIsSampled } from "@/lib/snapshotFreshness";

/**
 * Tras remount (/review → /), si la sesión persistida sigue vigente y hay
 * copia local del nocturno US, no hace falta GET cloud en restoreLatestSnapshot.
 * Arranque frío (sin sesión válida) sigue pidiendo la nube.
 */
export function shouldSkipCloudSnapshotRestore({
  localScan = null,
  session = null,
  now = new Date(),
} = {}) {
  if (!localScan?.rows?.length) return false;
  if (session?.version == null) return false;
  if (screenerSessionDataExpired(session, now)) return false;
  if (localScanIsSampled(localScan)) return false;
  return true;
}
