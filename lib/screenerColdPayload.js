// lib/screenerColdPayload.js — medición del peso del payload cold de mesa.
//
// SCREENER-COLD-PAYLOAD-1: herramientas para identificar qué campos hinchan el
// JSON que el cliente parsea tras chartPreview-defer y mesa-light-wire. No
// altera el wire; projectScanRowForMesaTransport sigue siendo la proyección.

import { MESA_TRANSPORT_OMIT_FIELDS } from "@/lib/scanLightProjection";

/**
 * Suma bytes JSON por clave sobre un lote de filas ya proyectadas.
 * @param {object[]} rows
 * @returns {{ field: string, bytes: number, rowCount: number }[]}
 */
export function measureProjectedFieldWeights(rows = []) {
  const totals = new Map();
  const counts = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const [key, value] of Object.entries(row)) {
      const bytes = Buffer.byteLength(JSON.stringify(value));
      totals.set(key, (totals.get(key) || 0) + bytes);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...totals.entries()]
    .map(([field, bytes]) => ({
      field,
      bytes,
      rowCount: counts.get(field) || 0,
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

/** Bytes totales de JSON.stringify(rows). */
export function measureRowsJsonBytes(rows = []) {
  return Buffer.byteLength(JSON.stringify(rows));
}

export function topProjectedFieldWeights(rows = [], limit = 10) {
  return measureProjectedFieldWeights(rows).slice(0, Math.max(0, limit));
}

/** Campos que mesa-light-wire ya omite del wire compacto (referencia tests/research). */
export function mesaTransportOmitFields() {
  return [...MESA_TRANSPORT_OMIT_FIELDS];
}
