"use client";

import Link from "next/link";
import { Gauge, Layers3, List, Search, Star } from "lucide-react";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Screener", Icon: Search },
  { href: "/lists", label: "Listas", Icon: List },
  { href: "/sectors", label: "Sectores", Icon: Layers3 },
  { href: "/research-desk", label: "Research", Icon: Star },
  { href: "/market-health", label: "Mercado", Icon: Gauge },
];

export default function BottomNav() {
  const pathname = usePathname() || "/";
  return (
    <nav className="bottomNav" aria-label="Navegación principal">
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
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
