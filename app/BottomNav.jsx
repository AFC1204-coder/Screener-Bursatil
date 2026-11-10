"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Ellipsis, Gauge, Layers3, List, ListChecks, Rocket, Search, Star } from "lucide-react";
import { usePathname } from "next/navigation";

// Navegación superior de escritorio (AppHeaderNav). NO cambia con la barra
// móvil: el escritorio sigue con estos cinco destinos.
export const NAV_ITEMS = [
  { href: "/", label: "Screener", Icon: Search },
  { href: "/lists", label: "Listas", Icon: List },
  { href: "/sectors", label: "Sectores", Icon: Layers3 },
  { href: "/research-desk", label: "Research", Icon: Star },
  { href: "/market-health", label: "Mercado", Icon: Gauge },
];

// Barra inferior móvil (estudio móvil 2026-11, §2.8): cuatro destinos de uso
// diario con etiqueta + «Más». Research pasa a «Más» (decisión 1 del estudio,
// propuesta por defecto: Sectores en la barra).
export const MOBILE_TAB_ITEMS = [
  { href: "/", label: "Screener", Icon: Search },
  { href: "/lists", label: "Listas", Icon: List },
  { href: "/sectors", label: "Sectores", Icon: Layers3 },
  { href: "/market-health", label: "Mercado", Icon: Gauge },
];

// Destinos agrupados en «Más» (solo móvil). IPO radar sigue fuera de la
// navegación de escritorio (tests/bottomNav.test.js).
export const MOBILE_MORE_ITEMS = [
  { href: "/research-desk", label: "Research", hint: "notas y tesis", Icon: Star },
  { href: "/review", label: "Review", hint: "cola de clasificación", Icon: ListChecks },
  { href: "/ipo-radar", label: "IPO radar", hint: "salidas recientes", Icon: Rocket },
];

export function activeForPath(pathname = "/", href = "/") {
  if (href === "/") return pathname === "/" || pathname.startsWith("/stock/");
  return pathname.startsWith(href);
}

export function moreIsActive(pathname = "/") {
  return MOBILE_MORE_ITEMS.some(({ href }) => activeForPath(pathname, href));
}

export function AppHeaderNav() {
  const pathname = usePathname() || "/";
  return (
    <nav className="appHeaderNav" aria-label="Navegación principal superior">
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const active = activeForPath(pathname, href);
        return (
          <Link key={href} href={href} className={`appHeaderNavItem ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default function BottomNav() {
  const pathname = usePathname() || "/";
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = moreIsActive(pathname);

  // Cambiar de ruta cierra la hoja.
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setMoreOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  return (
    <>
      {moreOpen ? (
        <>
          <div className="bottomNavMoreBackdrop" aria-hidden="true" onClick={() => setMoreOpen(false)} />
          <div className="bottomNavMoreSheet" id="bottomNavMore" role="menu" aria-label="Más secciones">
            {MOBILE_MORE_ITEMS.map(({ href, label, hint, Icon }) => {
              const active = activeForPath(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  role="menuitem"
                  className={`bottomNavMoreItem ${active ? "active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMoreOpen(false)}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                  <small>{hint}</small>
                </Link>
              );
            })}
          </div>
        </>
      ) : null}
      <nav className="bottomNav" aria-label="Navegación principal">
        {MOBILE_TAB_ITEMS.map(({ href, label, Icon }) => {
          const active = !moreOpen && activeForPath(pathname, href);
          return (
            <Link key={href} href={href} className={`navItem ${active ? "active" : ""}`} aria-current={activeForPath(pathname, href) ? "page" : undefined}>
              <span className="navIcon" aria-hidden="true"><Icon /></span>
              <span className="navLabel">{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`navItem navMore ${moreOpen || moreActive ? "active" : ""}`}
          aria-expanded={moreOpen}
          aria-controls="bottomNavMore"
          aria-haspopup="menu"
          aria-current={moreActive ? "page" : undefined}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span className="navIcon" aria-hidden="true"><Ellipsis /></span>
          <span className="navLabel">Más</span>
        </button>
      </nav>
    </>
  );
}
