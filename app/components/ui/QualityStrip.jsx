import "../../../styles/quality-strip.css";

/* Franja de calidad de dato: una sola línea que dice de cuándo son los datos
   que hay debajo.
   Estrenada en la ficha del valor (bloque N0) y extraída aquí sin cambiarla
   cuando Listas necesitó exactamente lo mismo. Un evaluador contó cinco
   fechas repartidas por el producto sin que ninguna dijera cuál manda; la
   respuesta no es una etiqueta más, es esta franja en cada pantalla, siempre
   con el mismo aspecto y el mismo sitio.
   Los items son { label, value } y se pintan en el orden recibido: el
   primero es la fecha que manda. */
/* Mismo formato de fecha en todas las pantallas que montan la franja.
   Delegado en la capa única (lib/formatters.js, dateShort): tener aquí una
   máscara propia era una tercera manera de escribir la misma fecha. */
import { dateShort } from "@/lib/formatters";

export function compactDate(value) {
  if (!value) return "";
  const label = dateShort(value);
  return label === "-" ? "" : label;
}

export function QualityStrip({ items = [] }) {
  if (!items.length) return null;
  return (
    <div className="stockQualityStrip" aria-label="Cobertura de datos">
      <span className="stockQualityStripLabel">Calidad de dato</span>
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="stockQualityStripItem">
          <span className="stockTechRowLabel">{item.label}</span>
          <span className="stockTechRowValue">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

export default QualityStrip;
