import { MissingValue } from "@/lib/screenerColumns";

// Recuento que puede no haber llegado. Un 0 en estos paneles se lee como una
// afirmación —"ninguna fila con precio viejo", "ningún fallo de datos"—, y esa
// afirmación solo se puede hacer si el recuento existe de verdad
// (docs/principios-producto.md, principio 3).
//
// El cero REAL se sigue mostrando como 0: el corte lo hace Number.isFinite
// sobre el valor, no la falsedad del cero en JavaScript.
export function CountValue({ value, reason = "" }) {
  const number = value === null || value === undefined || value === "" ? NaN : Number(value);
  if (!Number.isFinite(number)) return <MissingValue reason={reason} />;
  return <>{number}</>;
}
