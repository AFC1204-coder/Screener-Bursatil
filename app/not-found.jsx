// app/not-found.jsx — página 404 del producto.
//
// Antes salía la de fábrica de Next.js: fondo blanco, tipografía del sistema,
// "This page could not be found" en inglés. Rompía el producto entero — la
// única pantalla donde el usuario ve que hay dos aplicaciones distintas.
//
// Reglas que respeta:
//   - Castellano, como el resto del producto.
//   - Tokens de Pizarra y Tiza (docs/design/DIRECCION-VISUAL.md): usa las
//     clases globales de styles/components.css que ya cargan en el layout, sin
//     colores propios ni CSS nuevo.
//   - Nada de detalles internos: no dice qué ruta falló ni por qué. El usuario
//     no necesita saberlo y a nadie más le incumbe.
//   - Sin vocabulario de acción sobre valores (principio 1): las salidas son de
//     navegación, no sugerencias de qué mirar.

import Link from "next/link";
import "../styles/empty-states.css";
import StockSymbolSearch from "./stock/[symbol]/StockSymbolSearch";

const EXITS = [
  { href: "/", label: "Screener", detail: "La tabla de resultados y los filtros." },
  { href: "/lists", label: "Listas", detail: "Rankings por estrategia." },
  { href: "/sectors", label: "Sectores", detail: "Estado por grupo temático." },
  { href: "/market-health", label: "Salud de mercado", detail: "Régimen, amplitud y liderazgo." },
];

export default function NotFound() {
  return (
    <main className="page">
      <section className="card esPanel" aria-labelledby="notFoundTitle">
        <span className="esEyebrow">StatsEdge · Error 404</span>
        <h1 className="esTitle" id="notFoundTitle">Esta página no existe</h1>
        <p className="esLead">
          La dirección que has abierto no corresponde a ninguna pantalla del producto.
          Puede que el enlace esté mal escrito, o que apunte a un valor que ya no está
          en el universo analizado.
        </p>

        <div className="esActions">
          <Link className="btn btnPrimary" href="/">Volver al screener</Link>
        </div>

        {/* La búsqueda reutiliza los estilos de `.stockPage`, de ahí el
            envoltorio: así el buscador es el mismo que el de la ficha. */}
        <div className="esSearch stockPage">
          <span className="esSearchLabel">¿Buscabas un valor? Busca por ticker o nombre.</span>
          <StockSymbolSearch />
        </div>

        <div className="esExits">
          {EXITS.map((exit) => (
            <Link className="esExit" key={exit.href} href={exit.href}>
              <b>{exit.label}</b>
              <span>{exit.detail}</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
