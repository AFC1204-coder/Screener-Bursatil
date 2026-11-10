import "../../styles/page-ticket.css";

/* Ticket de pantalla compartido (rediseño 2026-11, paso 9).
   Es la misma fila de var(--ticket-h) que el screener pinta en
   ScreenerShell (.screenerTicket): título de la vista, un chip corto de
   ámbito/fuente, una verdad corta y las acciones a la derecha. Sustituye a
   las cabeceras heroicas de las vistas hermanas (eyebrow + h1 de 30 px +
   subtítulo + botonera cruzada): la topbar ya navega, así que aquí no hay
   enlaces a otras pantallas, solo acciones propias de la vista.

   Props:
   - title: nombre de la vista (único h1 de la página).
   - chip: texto corto o nodo (p. ej. «Ranking en vivo»); `chipMeta` añade el
     dato secundario en humo, como «1/27» en el chip de mercados.
   - truth: una frase corta con cifras («55 acciones · 6 listas con datos»).
     `truthTitle` lleva la versión larga como tooltip.
   - children: acciones (botones/enlaces); el primario usa .btnPrimary.
   - lead: nodo opcional antes del título (logo de la ficha).
   - badge: nodo opcional tras el título, sin caja de chip (chip-curva de la
     etapa en la ficha); si hay `badge` no se pinta `chip`.
   El CSS viaja con el componente (styles/page-ticket.css), como QualityStrip. */
export function PageTicket({ title, lead = null, badge = null, chip = null, chipMeta = null, chipTitle, truth = null, truthTitle, className = "", children = null }) {
  return (
    <div className={`pageTicket${className ? ` ${className}` : ""}`}>
      {lead}
      <h1 className="pageTicketTitle">{title}</h1>
      {badge}
      {!badge && chip ? (
        <span className="pageTicketChip" title={chipTitle}>
          <span className="pageTicketChipLabel">{chip}</span>
          {chipMeta ? <em>{chipMeta}</em> : null}
        </span>
      ) : null}
      {truth ? <p className="pageTicketTruth" role="status" title={truthTitle}>{truth}</p> : <span className="pageTicketSpacer" aria-hidden="true" />}
      {children ? <div className="pageTicketActions">{children}</div> : null}
    </div>
  );
}

export default PageTicket;
