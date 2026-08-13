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
/* Mismo formato de fecha en todas las pantallas que montan la franja: "12 ago
   2026". Vivía dentro de la ficha; se mueve aquí con el componente para que
   dos superficies no puedan escribir la misma fecha de dos maneras. */
export function compactDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "";
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
