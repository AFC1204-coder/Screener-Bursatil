"use client";

import { useEffect, useState } from "react";

/** Breakpoint canónico del screener (alineado con `styles/screener.css`). */
export const SCREENER_MOBILE_MAX_PX = 760;

export const SCREENER_MOBILE_MEDIA_QUERY = `(max-width: ${SCREENER_MOBILE_MAX_PX}px)`;

/**
 * Viewport móvil del screener según `matchMedia(SCREENER_MOBILE_MEDIA_QUERY)`.
 *
 * Hidratación: estado inicial `false` (desktop) en SSR y primer paint; el efecto
 * sincroniza con `matchMedia` sin recargar. En móvil real puede haber un frame
 * breve con la rama desktop antes del sync — preferible a mismatch de hidratación.
 */
export function useScreenerMobileViewport() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(SCREENER_MOBILE_MEDIA_QUERY);
    const sync = () => setIsMobile(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }, []);

  return isMobile;
}

export default useScreenerMobileViewport;
