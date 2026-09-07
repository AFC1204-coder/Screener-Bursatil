"use client";

import Link from "next/link";
import { Gauge, Layers3, List, Search, Star } from "lucide-react";
import { usePathname } from "next/navigation";

export const NAV_ITEMS = [
  { href: "/", label: "Screener", Icon: Search },
  { href: "/lists", label: "Listas", Icon: List },
  { href: "/sectors", label: "Sectores", Icon: Layers3 },
  { href: "/research-desk", label: "Research", Icon: Star },
  { href: "/market-health", label: "Mercado", Icon: Gauge },
];

function activeForPath(pathname = "/", href = "/") {
  if (href === "/") return pathname === "/" || pathname.startsWith("/stock/");
  return pathname.startsWith(href);
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
  return (
    <nav className="bottomNav" aria-label="Navegación principal">
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const active = activeForPath(pathname, href);
        return (
          <Link key={href} href={href} className={`navItem ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
            <span className="navIcon" aria-hidden="true"><Icon /></span>
            <span className="navLabel">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
