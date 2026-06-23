"use client";

import { useEffect, useState } from "react";
import { buildReviewProfileSummary, prepareReviewQueueRows } from "@/lib/decisionProfile";
import { safeRead, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { buildReviewStockOpenContext } from "@/lib/reviewStockContext";
import { buildDecisionQueueItem } from "@/lib/screenerExplainability";
import { compactRowForSession, compactRowsForSession } from "@/lib/screenerPipeline";
import {
  applyStockDecisionResolution,
  decisionResolutionForSymbol,
  reopenStockDecisionResolution,
  reviewDecisionStateForRows,
} from "@/lib/stockDecisionResolution";

export function useQuickReviewSession({
  activeSettings = {},
  presetKey = "",
  searchResult = null,
  rows = [],
  analyzedRows = [],
  setStatus = () => {},
  persistScreenerSession = () => {},
  buildScreenerStockOpenContext = () => null,
  saveSessionBeforeStockOpen = () => {},
} = {}) {
  const [activeModalRow, setActiveModalRow] = useState(null);
  const [quickReviewRows, setQuickReviewRows] = useState([]);
  const [quickReviewIndex, setQuickReviewIndex] = useState(0);
  const [quickReviewResolutionRevision, setQuickReviewResolutionRevision] = useState(0);

  const modalReviewRows = quickReviewRows.length ? quickReviewRows : (activeModalRow ? [activeModalRow] : []);
  const modalReviewIndex = activeModalRow ? modalReviewRows.findIndex((row) => row.symbol === activeModalRow.symbol) : -1;
  const modalReviewPosition = modalReviewIndex >= 0 ? modalReviewIndex : quickReviewIndex;

  function restoreQuickReviewSession(nextRows = [], nextIndex = 0) {
    setQuickReviewRows(Array.isArray(nextRows) ? nextRows : []);
    setQuickReviewIndex(Number.isFinite(nextIndex) ? nextIndex : 0);
  }

  function resetQuickReview() {
    setActiveModalRow(null);
    setQuickReviewRows([]);
    setQuickReviewIndex(0);
  }

  function quickReviewContext(row = activeModalRow, index = modalReviewPosition) {
    const list = modalReviewRows.length ? modalReviewRows : row ? [row] : [];
    const fallbackIndex = row?.symbol ? list.findIndex((item) => item.symbol === row.symbol) : 0;
    const resolvedIndex = Number.isFinite(index) ? index : Math.max(0, fallbackIndex);
    return {
      list,
      index: Math.max(0, resolvedIndex),
      rank: resolvedIndex >= 0 ? resolvedIndex + 1 : 1,
    };
  }

  function quickReviewPayload(row = activeModalRow, index = modalReviewPosition, previousReview = safeRead(STORAGE_KEYS.review, {})) {
    const context = quickReviewContext(row, index);
    const decisionState = reviewDecisionStateForRows(previousReview, context.list);
    return {
      ...previousReview,
      source: "current",
      rows: context.list,
      activeSettings,
      presetKey,
      currentIndex: context.index,
      reviewedSymbols: decisionState.reviewedSymbols,
      hiddenSymbols: decisionState.hiddenSymbols,
      decisionResolutions: decisionState.decisionResolutions,
      decisionResolutionLog: decisionState.decisionResolutionLog,
      selectedSymbol: row?.symbol || context.list[context.index]?.symbol || "",
      updatedAt: new Date().toISOString(),
    };
  }

  function saveQuickReviewStockOpen(row = activeModalRow, index = modalReviewPosition) {
    if (!row?.symbol) {
      saveSessionBeforeStockOpen(row);
      return;
    }
    const contextMeta = quickReviewContext(row, index);
    const openedAt = new Date().toISOString();
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    const digestFilter = previousReview.digestFilter || "all";
    const resolutionFilter = previousReview.resolutionFilter || "all";
    const reviewSourceLabel = previousReview.sourceLabel || "Screener actual";
    const reviewSourceDetail = String(previousReview.sourceDetail || "").trim();
    const reviewQueueMode = String(previousReview.queueMode || "screener-review").trim() || "screener-review";
    const reviewPayload = { ...quickReviewPayload(row, index, previousReview), updatedAt: openedAt };
    safeWrite(STORAGE_KEYS.review, reviewPayload);
    const context = buildReviewStockOpenContext(row, {
      settings: activeSettings,
      source: "current",
      sourceLabel: reviewSourceLabel,
      sourceDetail: reviewSourceDetail,
      queueMode: reviewQueueMode,
      digestFilter,
      resolutionFilter,
      rank: contextMeta.rank,
      queueSize: contextMeta.list.length,
      rowsCount: contextMeta.list.length,
      visibleCount: contextMeta.list.length,
      hiddenCount: 0,
      openedAt,
    });
    persistScreenerSession({
      lastOpenedStockSymbol: row.symbol,
      lastOpenedStockAt: openedAt,
      lastOpenedStockContext: context,
      scrollY: typeof window !== "undefined" ? window.scrollY : 0,
      quickReviewRows: compactRowsForSession(contextMeta.list),
      quickReviewIndex: contextMeta.index,
      searchResult: compactRowForSession(searchResult),
      rows: compactRowsForSession(rows),
      analyzedRows: compactRowsForSession(analyzedRows),
    });
  }

  function resolveQuickReviewDecision(actionKey, row = activeModalRow, index = modalReviewPosition, queueItems = []) {
    if (!row?.symbol) return;
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    const decisionQueueItems = Array.isArray(queueItems) ? queueItems : [];
    const decision = decisionQueueItems[index] || buildDecisionQueueItem(row, activeSettings);
    const note = [
      decision?.nextAction?.value || "",
      decision?.risk?.value || "",
    ].filter(Boolean).join(" · ");
    const nextReview = applyStockDecisionResolution(quickReviewPayload(row, index, previousReview), {
      symbol: row.symbol,
      actionKey,
      source: "screener-review",
      note,
    });
    safeWrite(STORAGE_KEYS.review, nextReview);
    setQuickReviewResolutionRevision((value) => value + 1);
    const resolution = decisionResolutionForSymbol(nextReview, row.symbol);
    setStatus(`${row.symbol}: ${resolution?.label || "resuelta"} desde Vista rápida`);
  }

  function reopenQuickReviewDecision(row = activeModalRow, index = modalReviewPosition) {
    if (!row?.symbol) return;
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    const resolution = decisionResolutionForSymbol(previousReview, row.symbol);
    const nextReview = reopenStockDecisionResolution(quickReviewPayload(row, index, previousReview), {
      symbol: row.symbol,
      source: "screener-review",
      note: resolution?.label ? `Antes: ${resolution.label}` : "",
    });
    safeWrite(STORAGE_KEYS.review, nextReview);
    setQuickReviewResolutionRevision((value) => value + 1);
    setStatus(`${row.symbol}: reabierta desde Vista rápida`);
  }

  function openReview(currentRows, startSymbol = "", options = {}) {
    const reviewRows = prepareReviewQueueRows(currentRows, activeSettings);
    if (!reviewRows.length) {
      setStatus("Sin filas actuales para abrir vista rapida.");
      return;
    }
    const reviewSourceLabel = options.sourceLabel || "Screener actual";
    const reviewSourceDetail = options.sourceDetail || "";
    const queueMode = options.queueMode || "screener-review";
    const nextResolutionFilter = options.resolutionFilter || "all";
    const nextDigestFilter = options.digestFilter || "all";
    const currentIndex = Math.max(0, reviewRows.findIndex((row) => row.symbol === startSymbol));
    const profileSummary = buildReviewProfileSummary(reviewRows, activeSettings);
    const cleanCount = profileSummary.find((group) => group.key === "operable-clean")?.count || 0;
    const fragileCount = profileSummary.find((group) => group.key === "operable-fragile")?.count || 0;
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    const decisionState = reviewDecisionStateForRows(previousReview, reviewRows);
    setQuickReviewRows(reviewRows);
    setQuickReviewIndex(currentIndex);
    setActiveModalRow(reviewRows[currentIndex]);
    safeWrite(STORAGE_KEYS.review, {
      source: "current",
      sourceLabel: reviewSourceLabel,
      sourceDetail: reviewSourceDetail,
      queueMode,
      rows: reviewRows,
      activeSettings,
      presetKey,
      currentIndex,
      contractContext: buildScreenerStockOpenContext(reviewRows[currentIndex], { rank: currentIndex + 1, queueSize: reviewRows.length, sourceLabel: reviewSourceLabel === "Screener actual" ? "Revisión Screener" : reviewSourceLabel }),
      reviewedSymbols: decisionState.reviewedSymbols,
      hiddenSymbols: decisionState.hiddenSymbols,
      decisionResolutions: decisionState.decisionResolutions,
      decisionResolutionLog: decisionState.decisionResolutionLog,
      resolutionFilter: nextResolutionFilter,
      digestFilter: nextDigestFilter,
      selectedSymbol: startSymbol || reviewRows[0]?.symbol || "",
      updatedAt: new Date().toISOString(),
    });
    setStatus(`${reviewSourceLabel}: ${reviewRows.length} acciones en cola · ${cleanCount} limpias · ${fragileCount} fragiles.`);
  }

  function selectQuickReview(index, list = quickReviewRows) {
    if (!list.length) return;
    const nextIndex = ((index % list.length) + list.length) % list.length;
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    const decisionState = reviewDecisionStateForRows(previousReview, list);
    setQuickReviewIndex(nextIndex);
    setActiveModalRow(list[nextIndex]);
    safeWrite(STORAGE_KEYS.review, {
      source: previousReview.source || "current",
      sourceLabel: previousReview.sourceLabel || "Screener actual",
      sourceDetail: previousReview.sourceDetail || "",
      queueMode: previousReview.queueMode || "screener-review",
      rows: list,
      activeSettings,
      presetKey,
      currentIndex: nextIndex,
      contractContext: buildScreenerStockOpenContext(list[nextIndex], { rank: nextIndex + 1, queueSize: list.length, sourceLabel: previousReview.sourceLabel && previousReview.sourceLabel !== "Screener actual" ? previousReview.sourceLabel : "Revisión Screener" }),
      reviewedSymbols: decisionState.reviewedSymbols,
      hiddenSymbols: decisionState.hiddenSymbols,
      decisionResolutions: decisionState.decisionResolutions,
      decisionResolutionLog: decisionState.decisionResolutionLog,
      resolutionFilter: previousReview.resolutionFilter || "all",
      digestFilter: previousReview.digestFilter || "all",
      selectedSymbol: list[nextIndex]?.symbol || "",
      updatedAt: new Date().toISOString(),
    });
  }

  function moveQuickReview(delta) {
    selectQuickReview(quickReviewIndex + delta);
  }

  function closeQuickReview() {
    setActiveModalRow(null);
  }

  useEffect(() => {
    if (!activeModalRow) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeQuickReview();
      if (event.key === "ArrowRight" || event.key === "ArrowDown") moveQuickReview(1);
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") moveQuickReview(-1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeModalRow, quickReviewIndex, quickReviewRows]);

  return {
    activeModalRow,
    quickReviewRows,
    quickReviewIndex,
    quickReviewResolutionRevision,
    modalReviewRows,
    modalReviewPosition,
    restoreQuickReviewSession,
    resetQuickReview,
    openReview,
    selectQuickReview,
    moveQuickReview,
    closeQuickReview,
    saveQuickReviewStockOpen,
    resolveQuickReviewDecision,
    reopenQuickReviewDecision,
  };
}
