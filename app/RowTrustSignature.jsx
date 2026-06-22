"use client";

export default function RowTrustSignature({ signature = null, className = "" }) {
  if (!signature?.items?.length) return null;
  return <div className={`rowTrustSignature ${signature.tone || "neutral"} ${className}`.trim()} title={signature.title} aria-label={signature.ariaLabel}>
    {signature.items.map((item) => <span key={item.key} className={`rowTrustChip ${item.key} ${item.tone || "neutral"}`} title={item.detail || undefined}>
      <em>{item.label}</em>
      <b>{item.value}</b>
    </span>)}
  </div>;
}
