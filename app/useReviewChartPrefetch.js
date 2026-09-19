// app/useReviewChartPrefetch.js — dispara prefetch N+1 / N-1 tras estabilizar foco.

"use client";

import { useEffect, useRef } from "react";
import {
  buildReviewChartPrefetchPlan,
  runReviewChartPrefetchPlan,
} from "@/lib/reviewChartPrefetch";

function scheduleIdle(callback) {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(callback, { timeout: 500 });
    return () => {
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(id);
    };
  }
  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}

export function useReviewChartPrefetch({
  enabled = false,
  focusSymbol = "",
  visibleRows = [],
  currentIndex = 0,
  chartSettings = {},
}) {
  const generationRef = useRef(0);

  useEffect(() => {
    if (!enabled || !focusSymbol || !visibleRows.length) return undefined;

    generationRef.current += 1;
    const generation = generationRef.current;

    const cancelSchedule = scheduleIdle(() => {
      if (generationRef.current !== generation) return;
      const plan = buildReviewChartPrefetchPlan({
        focusSymbol,
        visibleRows,
        currentIndex,
        chartSettings,
        includePrev: visibleRows.length >= 2,
        includeFocus: visibleRows.length === 1,
      });
      runReviewChartPrefetchPlan(plan);
    });

    return () => {
      generationRef.current += 1;
      cancelSchedule();
    };
  }, [
    enabled,
    focusSymbol,
    currentIndex,
    visibleRows,
    chartSettings?.range,
    chartSettings?.dataRange,
    chartSettings?.interval,
    chartSettings?.style,
  ]);
}
