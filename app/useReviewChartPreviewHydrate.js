// app/useReviewChartPreviewHydrate.js — hidrata chartPreview del foco en /review.

"use client";

import { useEffect, useMemo, useRef } from "react";
import { safeRead, STORAGE_KEYS } from "@/lib/localState";
import { applyChartPreviewsToRows } from "@/lib/scansChartPreviewHydrate";
import {
  buildReviewChartPreviewHydratePlan,
  runReviewChartPreviewHydrate,
} from "@/lib/reviewChartPreviewHydrate";

/**
 * Cuando el foco (activo + vecinos) no tiene chartPreview, lo pide al endpoint
 * de miniaturas del scan. No bloquea métricas ni llama company-brief.
 */
export function useReviewChartPreviewHydrate({
  enabled = false,
  visibleRows = [],
  currentIndex = 0,
  setRows = null,
}) {
  const generationRef = useRef(0);

  const plan = useMemo(() => {
    if (!enabled || typeof setRows !== "function") return null;
    const scans = safeRead(STORAGE_KEYS.scans, []);
    return buildReviewChartPreviewHydratePlan({
      enabled: true,
      scans,
      visibleRows,
      currentIndex,
    });
  }, [enabled, visibleRows, currentIndex, setRows]);

  useEffect(() => {
    if (!plan?.signature) return undefined;

    generationRef.current += 1;
    const generation = generationRef.current;
    let cancelled = false;

    runReviewChartPreviewHydrate(plan, {
      onChunk: (chunkPreviews) => {
        if (cancelled || generationRef.current !== generation) return;
        if (!chunkPreviews || !Object.keys(chunkPreviews).length) return;
        setRows((current) => applyChartPreviewsToRows(current, chunkPreviews));
      },
    }).catch((error) => {
      if (!cancelled && generationRef.current === generation) {
        console.warn("[review chartPreview] hidratación fallida:", error);
      }
    });

    return () => {
      cancelled = true;
      generationRef.current += 1;
    };
  }, [plan?.signature, plan?.cloudId, setRows]);
}
