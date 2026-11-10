"use client";

// Bloque «Entrada» del panel de lectura (HuntPeekPanel) y de la vista rápida
// móvil (MobilePeekSheet). Auditoría de producto 2026-11, propuesta 2.
// Solo hechos: pivote, distancia, zona pivote–+5 %, stop de referencia con su
// origen, % de riesgo y una calculadora de posición. Sin señales ni colores
// de compra. Cero peticiones: todo sale de la fila ya cargada. El cálculo vive
// en lib/entryRisk.js (puro, con tests); aquí solo se pinta y se guarda la
// preferencia de la calculadora (capital y % de riesgo) en localStorage.

import { useEffect, useState } from "react";
import { safeRead, safeWrite } from "@/lib/localState";
import {
  ENTRY_ABSENT,
  ENTRY_ZONE_PCT,
  POSITION_CALC_STORAGE_KEY,
  POSITION_REASON_COPY,
  POSITION_WARNING_COPY,
  STOP_SOURCES,
  entryPrice,
  entryRiskForRow,
  formatEntryPct,
  formatRiskPct,
  formatShares,
  parseDecimalInput,
  positionSize,
  sanitizePositionCalcSettings,
  stopSourceLabel,
} from "@/lib/entryRisk";
import { num, pctShare } from "@/lib/formatters";

function Absent({ title }) {
  return <span className="huntTapeGhost entryAbsent" title={title}>{ENTRY_ABSENT}</span>;
}

function zoneNote(entry) {
  if (entry.distanceToPivotPct == null) return "";
  if (entry.inEntryZone) return "precio dentro";
  return entry.distanceToPivotPct < 0 ? "precio por debajo" : "precio por encima";
}

function stopTitle(entry, currency) {
  if (entry.stopSource) return STOP_SOURCES[entry.stopSource].title;
  if (entry.stopIssue === "at-or-above-price" && entry.stopReference) {
    return `La referencia (${stopSourceLabel(entry.stopReference.source)}, ${entryPrice(entry.stopReference.value, currency)}) no está por debajo del precio: no hay stop medible`;
  }
  if (entry.stopIssue === "no-price") return "Sin precio: no hay stop medible";
  return "Sin mínimo de la última contracción ni media de 10 semanas en el escaneo";
}

function inputText(value) {
  return Number.isFinite(value) ? String(value).replace(".", ",") : "";
}

/** Capital y % de riesgo: se leen y guardan con lib/localState (try/catch). */
export function usePositionCalcSettings() {
  const [settings, setSettings] = useState(() => sanitizePositionCalcSettings(null));
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setSettings(sanitizePositionCalcSettings(safeRead(POSITION_CALC_STORAGE_KEY, null)));
    setLoaded(true);
  }, []);
  const update = (patch) => {
    setSettings((current) => {
      const next = sanitizePositionCalcSettings({ ...current, ...patch });
      safeWrite(POSITION_CALC_STORAGE_KEY, next, { silent: true });
      return next;
    });
  };
  return { settings, loaded, update };
}

function PositionCalculator({ entry, currency, idPrefix }) {
  const { settings, loaded, update } = usePositionCalcSettings();
  const [capitalText, setCapitalText] = useState("");
  const [riskText, setRiskText] = useState("");
  useEffect(() => {
    if (!loaded) return;
    setCapitalText(inputText(settings.capital));
    setRiskText(inputText(settings.riskPerTradePct));
    // Solo al cargar: después manda lo que escribe el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const capital = parseDecimalInput(capitalText);
  const riskPerTradePct = parseDecimalInput(riskText);
  const result = positionSize({ capital, riskPerTradePct, price: entry.price, stop: entry.stop });

  return (
    <div className="entryCalc">
      <div className="entryCalcInputs">
        <label htmlFor={`${idPrefix}-capital`}>
          <span className="huntPeekLabel">Capital</span>
          <input
            id={`${idPrefix}-capital`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="p. ej. 25.000"
            value={capitalText}
            onChange={(event) => {
              setCapitalText(event.target.value);
              const n = parseDecimalInput(event.target.value);
              update({ capital: n != null && n > 0 ? n : null });
            }}
          />
        </label>
        <label htmlFor={`${idPrefix}-risk`}>
          <span className="huntPeekLabel">Riesgo por operación</span>
          <span className="entryCalcPct">
            <input
              id={`${idPrefix}-risk`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={riskText}
              onChange={(event) => {
                setRiskText(event.target.value);
                const n = parseDecimalInput(event.target.value);
                if (n != null && n > 0 && n <= 100) update({ riskPerTradePct: n });
              }}
            />
            <i aria-hidden="true">%</i>
          </span>
        </label>
      </div>
      <output className="entryCalcOut" htmlFor={`${idPrefix}-capital ${idPrefix}-risk`} aria-live="polite">
        {result.ok ? (
          <>
            <span className="entryCalcLine">
              <b>{formatShares(result.shares)}</b> acciones · <b>{entryPrice(result.positionValue, currency)}</b> · <b>{pctShare(result.pctOfCapital, 1)}</b> del capital
            </span>
            <small>
              Riesgo {entryPrice(result.riskBudget, currency)} ({num(riskPerTradePct, riskPerTradePct % 1 ? 2 : 0)}% del capital) · {entryPrice(result.riskPerShare, currency)} por acción
            </small>
            {result.shares === 0 ? <small>El riesgo asignado no alcanza para una acción.</small> : null}
            {result.warnings.map((key) => (
              <small key={key} className="entryCalcWarn">Aviso: {POSITION_WARNING_COPY[key]}</small>
            ))}
          </>
        ) : (
          <small>{POSITION_REASON_COPY[result.reason]}</small>
        )}
      </output>
    </div>
  );
}

/**
 * @param {{ row: object, variant?: "desktop"|"mobile", idPrefix?: string }} props
 */
export default function EntryBlock({ row, variant = "desktop", idPrefix = "entry" }) {
  if (!row) return null;
  const currency = row.currency || "";
  const entry = entryRiskForRow(row);
  const zone = entry.zoneLow != null
    ? `${entryPrice(entry.zoneLow, currency)}–${entryPrice(entry.zoneHigh, currency)}`
    : null;
  const note = zoneNote(entry);

  return (
    <section className={`entryBlock entryBlock--${variant}`} aria-label="Entrada">
      <p className={variant === "mobile" ? "mobileSheetLabel" : "huntPeekLabel"}>Entrada</p>
      <dl className={`entryFacts${variant === "desktop" ? " huntPeekFacts" : ""}`}>
        <div>
          <dt>Pivote</dt>
          <dd title="Máximo de las 65 sesiones anteriores (pivote del escaneo)">
            {entry.pivot != null ? <b>{entryPrice(entry.pivot, currency)}</b> : <Absent title="Sin pivote en el escaneo" />}
          </dd>
        </div>
        <div>
          <dt>Al pivote</dt>
          <dd title="Distancia del precio al pivote">
            {entry.distanceToPivotPct != null ? <b>{formatEntryPct(entry.distanceToPivotPct)}</b> : <Absent title="Sin distancia al pivote" />}
          </dd>
        </div>
        <div>
          <dt>Riesgo al stop</dt>
          <dd title="(precio − stop) / precio">
            {entry.riskPct != null ? <b>{formatRiskPct(entry.riskPct)}</b> : <Absent title={stopTitle(entry, currency)} />}
            {entry.riskOverLimit ? <small>más del 10%</small> : null}
          </dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd title={stopTitle(entry, currency)}>
            {entry.stop != null ? <b>{entryPrice(entry.stop, currency)}</b> : <Absent title={stopTitle(entry, currency)} />}
            {entry.stopSource ? <small>{stopSourceLabel(entry.stopSource)}</small> : null}
          </dd>
        </div>
        <div className="entryFactZone">
          <dt>Zona +{ENTRY_ZONE_PCT}%</dt>
          <dd title={`Del pivote a +${ENTRY_ZONE_PCT}% (dato, no señal)`}>
            {zone ? <b>{zone}</b> : <Absent title="Sin pivote" />}
            {note ? <small>{note}</small> : null}
          </dd>
        </div>
      </dl>
      <PositionCalculator entry={entry} currency={currency} idPrefix={`${idPrefix}-${row.symbol || "row"}`} />
    </section>
  );
}
