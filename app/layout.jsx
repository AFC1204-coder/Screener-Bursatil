// Pizarra y Tiza v2: tokens-v2.css es la única fuente de tokens para toda la app
// (global, todas las rutas). Sustituye a tokens.css v1. Spec: docs/design/DIRECCION-VISUAL.md.
import "../styles/tokens-v2.css";
import "../styles/base.css";
import "../styles/components.css";
import AuthGate from "./AuthGate";
import BottomNav, { AppHeaderNav } from "./BottomNav";

export const metadata = {
  title: "StatsEdge",
  description: "Professional equity research and screening platform",
  manifest: "/manifest.webmanifest",
  applicationName: "StatsEdge",
  appleWebApp: { capable: true, title: "StatsEdge", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#09090b",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <header className="appTopBar">
          <a className="appBrand" href="/">
            <span className="appBrandMark">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
                {/* Background Radar sweeps */}
                <circle cx="8" cy="16" r="6" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" strokeDasharray="2 2" />
                <circle cx="8" cy="16" r="11" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
                {/* Sweeper sweep arc line */}
                <line x1="8" y1="16" x2="15" y2="9" stroke="var(--line3)" strokeWidth="1.5" strokeLinecap="round" />
                {/* Solid chart breakout path in tiza (brand monochrome) */}
                <path d="M3 17L8 12L13 15L21 5" stroke="var(--tiza)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                {/* Arrowhead */}
                <path d="M16 5H21V10" stroke="var(--tiza)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span>
              <b>StatsEdge</b>
              <small>Equity Research</small>
            </span>
          </a>
          <AppHeaderNav />
        </header>
        <AuthGate>
          {children}
          <BottomNav />
        </AuthGate>
      </body>
    </html>
  );
}
