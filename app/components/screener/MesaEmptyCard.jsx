"use client";

import { useId } from "react";
import { buildMesaEmptyCopy } from "@/lib/mesaEmptyState";

/**
 * Tarjeta centrada cuando no hay escaneo/mesa (P1).
 * CTAs: Reintentar · Buscar ticker · Detalle técnico colapsado.
 */
export default function MesaEmptyCard({
  markets = [],
  snapshotNotice = null,
  err = null,
  onRetry,
  onFocusSearch,
  retrying = false,
}) {
  const detailId = useId();
  const copy = buildMesaEmptyCopy({ markets, snapshotNotice, err });

  return (
    <section
      className={`mesaEmptyCard mesaEmptyCard--${copy.kind}`}
      role="status"
      aria-live="polite"
      aria-labelledby={`${detailId}-title`}
    >
      <div className="mesaEmptyCardInner">
        <p className="mesaEmptyCardEyebrow">Mesa</p>
        <h2 id={`${detailId}-title`} className="mesaEmptyCardTitle">
          {copy.title}
        </h2>
        <p className="mesaEmptyCardCause">{copy.cause}</p>
        <div className="mesaEmptyCardActions">
          {onRetry ? (
            <button
              type="button"
              className="btn btnPrimary"
              onClick={onRetry}
              disabled={retrying}
            >
              {retrying ? "Reintentando…" : copy.primaryRetryLabel}
            </button>
          ) : null}
          {onFocusSearch ? (
            <button
              type="button"
              className="btn btnGhost"
              onClick={onFocusSearch}
            >
              Buscar ticker
            </button>
          ) : null}
        </div>
        {copy.technicalDetail ? (
          <details className="mesaEmptyCardTech">
            <summary>Detalle técnico</summary>
            <p>{copy.technicalDetail}</p>
          </details>
        ) : null}
      </div>
    </section>
  );
}
