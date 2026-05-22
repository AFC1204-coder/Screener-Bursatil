import "./globals.css";
import BottomNav from "./BottomNav";

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
  viewportFit: "cover",
  themeColor: "#09090b",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <header className="appTopBar">
          <a className="appBrand" href="/">
            <span className="appBrandMark">S</span>
            <span>
              <b>StatsEdge</b>
              <small>Equity Research</small>
            </span>
          </a>
        </header>
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
