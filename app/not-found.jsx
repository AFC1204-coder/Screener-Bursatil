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

const EXITS = [
  { href: "/", label: "Screener", detail: "La tabla de resultados y los filtros." },
  { href: "/lists", label: "Listas", detail: "Rankings por estrategia." },
  { href: "/sectors", label: "Sectores", detail: "Estado por grupo temático." },
  { href: "/market-health", label: "Salud de mercado", detail: "Régimen, amplitud y liderazgo." },
];

// `.eyebrow` solo existe en la hoja de salud de mercado, que aquí no se carga:
// el micro-rótulo se compone con tokens globales para no arrastrar una hoja
// entera por una línea de texto.
const EYEBROW_STYLE = {
  display: "block",
  textTransform: "uppercase",
  letterSpacing: ".08em",
  fontSize: "11px",
  color: "var(--muted)",
};

export default function NotFound() {
  return (
    <main className="page">
      <section className="card">
        <span style={EYEBROW_STYLE}>StatsEdge · Error 404</span>
        <h1 style={{ margin: "var(--space-2) 0", fontFamily: "var(--font-display)" }}>
          Esta página no existe
        </h1>
        <p style={{ margin: 0, maxWidth: "60ch", color: "var(--soft)" }}>
          La dirección que has abierto no corresponde a ninguna pantalla del producto.
          Puede que el enlace esté mal escrito, o que apunte a un valor que ya no está
          en el universo analizado.
        </p>

        {/* Dos columnas en cuanto hay sitio: cuatro tarjetas a ancho completo
            hacían una escalera vacía. `.fine` aquí no vale — su color está
            pensado para pies de tabla y sobre esta tarjeta no se lee. */}
        <div
          className="notFoundExits"
          style={{
            display: "grid",
            gap: "var(--space-3)",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            marginTop: "var(--space-5)",
          }}
        >
          {EXITS.map((exit) => (
            <Link className="card" key={exit.href} href={exit.href} style={{ display: "block", padding: "var(--space-4)" }}>
              <b>{exit.label}</b>
              <span style={{ display: "block", marginTop: "var(--space-1)", fontSize: "12.5px", color: "var(--soft)" }}>{exit.detail}</span>
            </Link>
          ))}
        </div>

        <div style={{ marginTop: "var(--space-5)" }}>
          <Link className="btn btnPrimary" href="/">Volver al screener</Link>
        </div>
      </section>
    </main>
  );
}
