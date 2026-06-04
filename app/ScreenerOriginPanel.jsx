"use client";

function originMeta(origin = {}) {
  const items = [
    { key: "preset", label: "base", value: origin.presetName },
    { key: "setup", label: "modo", value: origin.setupName },
    Number.isFinite(origin.rank) && Number.isFinite(origin.queueSize)
      ? { key: "rank", label: "cola", value: `${origin.rank}/${origin.queueSize}` }
      : null,
    origin.row?.score && origin.row.score !== "-" ? { key: "score", label: "score", value: origin.row.score } : null,
    origin.key === "bearish" && origin.row?.weakness && origin.row.weakness !== "-"
      ? { key: "weakness", label: "deterioro", value: origin.row.weakness }
      : null,
  ].filter(Boolean);
  return items.slice(0, 5);
}

export default function ScreenerOriginPanel({ origin, variant = "" }) {
  if (!origin) return null;
  const meta = originMeta(origin);
  return <section className={`screenerOriginPanel ${origin.tone || "exploratory"} ${variant}`.trim()} data-origin-contract={origin.key || ""}>
    <div className="screenerOriginIntro">
      <span>{origin.label || "Screener"}</span>
      <div>
        <h2>{origin.sourceLabel || "Origen Screener"}</h2>
        <p>{origin.title ? `${origin.title}. ` : ""}{origin.text || ""}</p>
      </div>
    </div>
    {meta.length ? <div className="screenerOriginMeta">
      {meta.map((item) => <span key={item.key}><b>{item.value}</b><em>{item.label}</em></span>)}
    </div> : null}
    {origin.statusText ? <div className={`screenerOriginStatus ${origin.statusTone || "ok"}`}>
      {origin.statusText}
    </div> : null}
  </section>;
}
