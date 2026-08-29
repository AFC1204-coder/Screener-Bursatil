"use client";
import "../../styles/ipo-radar.css";
import { useEffect, useMemo, useState } from "react";
import { dateShort } from "@/lib/formatters";
import {
  alertDate,
  dateOnly,
  daysUntil,
  filterIpoRadarDueItems,
  IPO_ALERT_WINDOW_DAYS,
} from "@/lib/ipoRadarAlerts";
import { safeRead, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { buildReviewPageHref } from "@/lib/screenerReviewLaunch";
import { countryCode, stockUrl } from "@/lib/symbols";

const EMPTY_FORM = {
  companyName: "",
  symbol: "",
  country: "US",
  exchange: "",
  sector: "",
  industry: "",
  expectedPricingDate: "",
  expectedTradeDate: "",
  status: "watch",
  priority: "normal",
  includeInScreener: true,
  sourceUrl: "",
  notes: "",
};

const COUNTRIES = [
  ["US", "Estados Unidos"],
  ["ES", "España"],
  ["DE", "Alemania"],
  ["FR", "Francia"],
  ["NL", "Países Bajos"],
  ["GB", "Reino Unido"],
  ["CH", "Suiza"],
  ["SE", "Suecia"],
  ["DK", "Dinamarca"],
  ["IT", "Italia"],
  ["JP", "Japón"],
  ["HK", "Hong Kong"],
  ["SG", "Singapur"],
  ["TW", "Taiwán"],
  ["KR", "Corea del Sur"],
  ["IN", "India"],
  ["IL", "Israel"],
  ["CN", "China"],
  ["AU", "Australia"],
  ["ZA", "Sudáfrica"],
  ["BR", "Brasil"],
  ["MX", "México"],
];

const STATUS_LABELS = {
  watch: "En vigilancia",
  filed: "Documentación presentada",
  priced: "Precio fijado",
  listed: "Ya cotiza",
  delayed: "Retrasada",
  passed: "Descartada",
};

function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function normalizeSymbol(symbol = "") {
  return String(symbol || "").trim().toUpperCase();
}
function dateLabel(value) {
  const d = dateOnly(value);
  if (!d) return "Sin fecha";
  // dateOnly (ISO) sigue siendo la clave interna de cálculo; lo que se
  // muestra pasa por la máscara única del producto ("4 ago 2026"), no ISO.
  const shown = dateShort(d);
  const delta = daysUntil(d);
  if (delta === 0) return `${shown} · hoy`;
  if (delta === 1) return `${shown} · mañana`;
  if (delta > 1) return `${shown} · en ${delta} días`;
  return `${shown} · hace ${Math.abs(delta)} días`;
}
function latestScanRows() {
  const scans = safeRead(STORAGE_KEYS.scans, []);
  return scans[0]?.rows || [];
}
function statusTone(status = "") {
  if (status === "listed") return "good";
  if (status === "passed" || status === "delayed") return "bad";
  if (status === "priced") return "good";
  return "neutral";
}

function IpoForm({ form, setForm, onSubmit, editing }) {
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  return <section className="card ipoRadarForm">
    <div className="sectionTitle">
      <h2>{editing ? "Editar IPO" : "Nueva candidata IPO"}</h2>
      <span className="fine">pre-IPO / primera cotización</span>
    </div>
    <div className="ipoFormGrid">
      <label className="field"><span>Empresa</span><input className="input" value={form.companyName} onChange={(e) => update("companyName", e.target.value)} placeholder="Nombre de la empresa" /></label>
      <label className="field"><span>Ticker si existe</span><input className="input" value={form.symbol} onChange={(e) => update("symbol", normalizeSymbol(e.target.value))} placeholder="Ej. RDDT, 9988.HK..." /></label>
      <label className="field"><span>País</span><select className="select" value={form.country} onChange={(e) => update("country", e.target.value)}>{COUNTRIES.map(([code, name]) => <option key={code} value={code}>{code} · {name}</option>)}</select></label>
      <label className="field"><span>Bolsa prevista</span><input className="input" value={form.exchange} onChange={(e) => update("exchange", e.target.value)} placeholder="Nasdaq, HKEX, BME..." /></label>
      <label className="field"><span>Sector</span><input className="input" value={form.sector} onChange={(e) => update("sector", e.target.value)} placeholder="Technology, Healthcare..." /></label>
      <label className="field"><span>Subsector</span><input className="input" value={form.industry} onChange={(e) => update("industry", e.target.value)} placeholder="Software, Semiconductors..." /></label>
      <label className="field"><span>Fecha pricing estimada</span><input className="input" type="date" value={form.expectedPricingDate} onChange={(e) => update("expectedPricingDate", e.target.value)} /></label>
      <label className="field"><span>Primer día cotización</span><input className="input" type="date" value={form.expectedTradeDate} onChange={(e) => update("expectedTradeDate", e.target.value)} /></label>
      <label className="field"><span>Estado</span><select className="select" value={form.status} onChange={(e) => update("status", e.target.value)}>{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="field"><span>Prioridad</span><select className="select" value={form.priority} onChange={(e) => update("priority", e.target.value)}><option value="high">Alta</option><option value="normal">Normal</option><option value="low">Baja</option></select></label>
      <label className="field wide"><span>Fuente / prospecto</span><input className="input" value={form.sourceUrl} onChange={(e) => update("sourceUrl", e.target.value)} placeholder="URL de prospecto, bolsa o noticia..." /></label>
      <label className="field wide"><span>Notas</span><textarea className="textarea" value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Lock-up, crecimiento, fecha esperada, dudas..." /></label>
    </div>
    <label className="checkLine">
      <input type="checkbox" checked={form.includeInScreener} onChange={(e) => update("includeInScreener", e.target.checked)} />
      <span>Incluir automáticamente en el universo del screener cuando tenga ticker</span>
    </label>
    <div className="controls" style={{ marginTop: 12 }}>
      <button className="btn btnPrimary" onClick={onSubmit}>{editing ? "Guardar cambios" : "Añadir IPO"}</button>
    </div>
  </section>;
}

export default function IpoRadarPage() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState("");
  const [status, setStatus] = useState("Listo");

  function persist(next) {
    const sorted = [...next].sort((a, b) => {
      const ad = alertDate(a) || "9999-12-31";
      const bd = alertDate(b) || "9999-12-31";
      return ad.localeCompare(bd);
    });
    setItems(sorted);
    safeWrite(STORAGE_KEYS.ipoRadar, sorted);
  }

  useEffect(() => {
    persist(safeRead(STORAGE_KEYS.ipoRadar, []));
  }, []);

  const due = useMemo(() => filterIpoRadarDueItems(items, { windowDays: IPO_ALERT_WINDOW_DAYS }), [items]);
  const withTicker = useMemo(() => items.filter((item) => normalizeSymbol(item.symbol)), [items]);
  const included = useMemo(() => withTicker.filter((item) => item.includeInScreener && item.status !== "passed"), [withTicker]);
  const listed = useMemo(() => items.filter((item) => item.status === "listed"), [items]);

  function saveItem() {
    const companyName = form.companyName.trim();
    const symbol = normalizeSymbol(form.symbol);
    if (!companyName && !symbol) {
      setStatus("Introduce al menos empresa o ticker.");
      return;
    }
    const payload = {
      ...form,
      id: editingId || uid(),
      companyName: companyName || symbol,
      symbol,
      country: symbol ? countryCode(symbol) : form.country,
      updatedAt: new Date().toISOString(),
      createdAt: editingId ? items.find((item) => item.id === editingId)?.createdAt || new Date().toISOString() : new Date().toISOString(),
    };
    const next = editingId ? items.map((item) => item.id === editingId ? payload : item) : [payload, ...items];
    persist(next);
    setForm(EMPTY_FORM);
    setEditingId("");
    setStatus(editingId ? "IPO actualizada." : "IPO anadida al radar.");
  }

  function editItem(item) {
    setEditingId(item.id);
    setForm({ ...EMPTY_FORM, ...item });
    setStatus(`Editando ${item.companyName || item.symbol}.`);
  }

  function updateItem(id, patch) {
    persist(items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item));
  }

  function removeItem(id) {
    persist(items.filter((item) => item.id !== id));
    if (editingId === id) {
      setEditingId("");
      setForm(EMPTY_FORM);
    }
  }

  function importJson() {
    const raw = prompt("Pega un JSON con IPOs. Puede ser un array o { items: [...] }.");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : parsed.items || [];
      const normalized = rows.map((row) => ({
        ...EMPTY_FORM,
        ...row,
        id: row.id || uid(),
        companyName: row.companyName || row.name || row.symbol || "IPO sin nombre",
        symbol: normalizeSymbol(row.symbol),
        country: row.country || (row.symbol ? countryCode(row.symbol) : "US"),
        createdAt: row.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      persist([...normalized, ...items]);
      setStatus(`${normalized.length} IPOs importadas.`);
    } catch {
      setStatus("JSON no válido.");
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), items }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stageradar-ipo-radar.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importRecentIposFromScan() {
    const rows = latestScanRows().filter((row) => {
      const date = dateOnly(row.ipoDate);
      const age = date ? daysUntil(date) : null;
      return date && Number.isFinite(age) && age <= 0 && age >= -365 && row.symbol;
    });
    const existing = new Set(items.map((item) => normalizeSymbol(item.symbol)).filter(Boolean));
    const nextRows = rows.filter((row) => !existing.has(normalizeSymbol(row.symbol))).map((row) => ({
      ...EMPTY_FORM,
      id: uid(),
      companyName: row.companyName || row.symbol,
      symbol: normalizeSymbol(row.symbol),
      country: row.country || countryCode(row.symbol),
      exchange: row.exchange || "",
      sector: row.sector || "",
      industry: row.industry || "",
      expectedTradeDate: row.ipoDate || "",
      status: "listed",
      includeInScreener: true,
      notes: "Importada desde el último snapshot por fecha IPO reciente.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    persist([...nextRows, ...items]);
    setStatus(nextRows.length ? `${nextRows.length} IPOs recientes importadas desde el último scan.` : "No hay IPOs recientes nuevas en el último scan.");
  }

  async function notifyDue() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setStatus("Este navegador no soporta notificaciones locales.");
      return;
    }
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("Notificaciones no autorizadas. Se mantienen avisos dentro de la app.");
      return;
    }
    due.slice(0, 5).forEach((item) => {
      new Notification(`StatsEdge IPO: ${item.companyName || item.symbol}`, {
        body: `${STATUS_LABELS[item.status] || item.status} · ${dateLabel(alertDate(item))}`,
      });
    });
    const now = new Date().toISOString();
    persist(items.map((item) => due.some((x) => x.id === item.id) ? { ...item, alertAcknowledgedAt: now } : item));
    setStatus(`${due.length} avisos lanzados y marcados.`);
  }

  return <main className="page ipoRadarPage">
    <section className="card hero ipoHero">
      <div className="heroTop">
        <div>
          <div className="badge">StatsEdge · IPO Radar</div>
          <h1>Radar de IPOs</h1>
          <p className="muted">Lista local de candidatas pre-IPO, fechas estimadas y tickers que entraran al screener cuando empiecen a cotizar.</p>
        </div>
        <div className="mobileActions">
          <a className="btn" href="/">Screener</a>
          <a className="btn" href="/lists">Listas</a>
          <a className="btn" href="/research-desk">Research</a>
          <button className="btn btnPrimary" onClick={notifyDue} disabled={!due.length}>Avisar pendientes</button>
        </div>
      </div>
    </section>

    <section className="card">
      <div className="kpis">
        <div className="kpi"><b>{items.length}</b><span>IPOs vigiladas</span></div>
        <div className="kpi"><b>{due.length}</b><span>avisos 14d</span></div>
        <div className="kpi"><b>{withTicker.length}</b><span>con ticker</span></div>
        <div className="kpi"><b>{included.length}</b><span>incluidas screener</span></div>
        <div className="kpi"><b>{listed.length}</b><span>ya cotizan</span></div>
      </div>
      <p className="fine" style={{ marginTop: 10 }}>{status}</p>
    </section>

    <section className="card status">
      <div className="sectionTitle"><h2>Avisos pre-IPO</h2><span className="fine">próximos {IPO_ALERT_WINDOW_DAYS} días</span></div>
      {due.length ? <div className="ipoAlertList">
        {due.map((item) => <div className="summaryRow" key={item.id}>
          <span><b>{item.companyName || item.symbol}</b><br /><span className="fine">{STATUS_LABELS[item.status] || item.status} · {item.exchange || item.country}</span></span>
          <span>{dateLabel(alertDate(item))}</span>
          <div className="controls">
            {item.symbol ? <>
              <a className="btn btnSmall" href={stockUrl(item.symbol)}>Ficha</a>
              <a className="btn btnSmall" href={buildReviewPageHref(item.symbol, "current")}>Revisar</a>
            </> : null}
            <button className="btn btnSmall" onClick={() => updateItem(item.id, { alertAcknowledgedAt: new Date().toISOString() })}>Marcar avisada</button>
          </div>
        </div>)}
      </div> : <p className="fine">Ninguna salida en los próximos {IPO_ALERT_WINDOW_DAYS} días.</p>}
    </section>

    <IpoForm form={form} setForm={setForm} onSubmit={saveItem} editing={Boolean(editingId)} />

    <section className="card">
      <div className="sectionTitle"><h2>Acciones rápidas</h2><span className="fine">control local</span></div>
      <div className="controls">
        <button className="btn" onClick={importRecentIposFromScan}>Importar IPOs recientes del último scan</button>
        <button className="btn" onClick={importJson}>Importar JSON</button>
        <button className="btn" onClick={exportJson} disabled={!items.length}>Exportar backup</button>
        {editingId && <button className="btn btnGhost" onClick={() => { setEditingId(""); setForm(EMPTY_FORM); }}>Cancelar edicion</button>}
      </div>
    </section>

    <section className="card">
      <div className="sectionTitle"><h2>IPOs seleccionadas</h2><span className="fine">las marcadas entran al screener cuando tengan ticker</span></div>
      <div className="tableWrap">
        <table className="table">
          <thead><tr>{["Empresa", "Ticker", "País", "Sector", "Estado", "Pricing", "Cotización", "Screener", "Acciones"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{items.map((item) => <tr key={item.id}>
            <td><b>{item.companyName || item.symbol}</b><br /><span className="fine">{item.notes || item.sourceUrl || "-"}</span></td>
            <td>{item.symbol ? <a className="ticker" href={stockUrl(item.symbol)}>{item.symbol}</a> : <span className="fine">Sin ticker</span>}</td>
            <td>{item.country}</td>
            <td>{[item.sector, item.industry].filter(Boolean).join(" · ") || "Sin dato"}</td>
            <td><span className={`signalStatMini ${statusTone(item.status)}`}>{STATUS_LABELS[item.status] || item.status}</span></td>
            <td>{dateLabel(item.expectedPricingDate)}</td>
            <td>{dateLabel(item.expectedTradeDate)}</td>
            <td>{item.symbol && item.includeInScreener && item.status !== "passed" ? "Sí" : "No"}</td>
            <td>
              <div className="controls">
                <button className="btn btnSmall" onClick={() => editItem(item)}>Editar</button>
                {item.symbol ? <>
                  <a className="btn btnSmall" href={stockUrl(item.symbol)}>Ficha</a>
                  <a className="btn btnSmall" href={buildReviewPageHref(item.symbol, "current")}>Revisar</a>
                  <a className="btn btnSmall" href="/lists">Listas</a>
                  <button className="btn btnSmall" onClick={() => updateItem(item.id, { includeInScreener: !item.includeInScreener })}>{item.includeInScreener ? "Quitar screener" : "Incluir"}</button>
                  <button className="btn btnSmall" onClick={() => updateItem(item.id, { status: "listed", includeInScreener: true })}>Ya cotiza</button>
                </> : null}
                <button className="btn btnSmall btnGhost" onClick={() => removeItem(item.id)}>Eliminar</button>
              </div>
            </td>
          </tr>)}{!items.length && <tr><td colSpan="9">Sin IPOs vigiladas todavía.</td></tr>}</tbody>
        </table>
      </div>
    </section>
  </main>;
}
