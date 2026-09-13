"use client";

import { useEffect, useState } from "react";
import { prepareReviewQueueRows } from "@/lib/decisionProfile";
import { safeRead, STORAGE_KEYS } from "@/lib/localState";
import { buildReviewStockOpenContext } from "@/lib/reviewStockContext";
import {
  isStoredReviewSessionValid,
  resolveReviewFocus,
  reviewFocusStatusMessage,
} from "@/lib/reviewSession";
import { buildReviewPageHref } from "@/lib/screenerReviewLaunch";
import { persistReviewQueue } from "@/lib/screenerPipeline";
import {
  applyStockDecisionResolution,
  decisionResolutionForSymbol,
  reopenStockDecisionResolution,
  reviewDecisionStateForRows,
} from "@/lib/stockDecisionResolution";

export function useQuickReviewSession({
  activeSettings = {},
  presetKey = "",
  setStatus = () => {},
  persistScreenerSession = () => {},
  buildScreenerStockOpenContext = () => null,
  saveSessionBeforeStockOpen = () => {},
  buildReviewSessionIdentity = () => ({}),
  getScreenerSession = () => ({}),
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
    persistReviewQueue(reviewPayload);
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
      quickReviewIndex: contextMeta.index,
    });
  }

  function resolveQuickReviewDecision(actionKey, row = activeModalRow, index = modalReviewPosition) {
    if (!row?.symbol) return;
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    const nextReview = applyStockDecisionResolution(quickReviewPayload(row, index, previousReview), {
      symbol: row.symbol,
      actionKey,
      source: "screener-review",
      note: "",
    });
    persistReviewQueue(nextReview);
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
    persistReviewQueue(nextReview);
    setQuickReviewResolutionRevision((value) => value + 1);
    setStatus(`${row.symbol}: reabierta desde Vista rápida`);
  }

  function wantsFreshReviewQueue(options = {}) {
    if (options.forceNew) return true;
    const queueMode = String(options.queueMode || "screener-review").trim() || "screener-review";
    if (queueMode !== "screener-review") return true;
    const sourceLabel = String(options.sourceLabel || "Screener actual").trim() || "Screener actual";
    if (sourceLabel !== "Screener actual") return true;
    if (options.resolutionFilter && options.resolutionFilter !== "all") return true;
    return false;
  }

  function canResumeStoredReviewSession(options = {}) {
    if (wantsFreshReviewQueue(options)) return false;
    const storedReview = safeRead(STORAGE_KEYS.review, {});
    const storedQueueMode = String(storedReview.queueMode || "screener-review").trim() || "screener-review";
    if (storedQueueMode !== "screener-review") return false;
    return isStoredReviewSessionValid(storedReview, {
      sessionIdentity: buildReviewSessionIdentity(),
      screenerSession: getScreenerSession(),
    });
  }

  function resumeStoredReviewSession(startSymbol = "", options = {}) {
    const storedReview = safeRead(STORAGE_KEYS.review, {});
    if (!canResumeStoredReviewSession(options)) return null;
    const focus = resolveReviewFocus(storedReview, startSymbol);
    if (!focus.inQueue || !focus.symbol) return null;
    const reviewRows = storedReview.rows;
    const reviewSourceLabel = storedReview.sourceLabel || "Screener actual";
    const nextPayload = {
      ...storedReview,
      selectedSymbol: focus.symbol,
      currentIndex: focus.index,
      updatedAt: new Date().toISOString(),
    };
    persistReviewQueue(nextPayload);
    setQuickReviewRows(reviewRows);
    setQuickReviewIndex(focus.index);
    setActiveModalRow(reviewRows[focus.index]);
    const focusMessage = reviewFocusStatusMessage(focus, reviewRows.length);
    setStatus(focusMessage || `${reviewSourceLabel}: ${reviewRows.length} acciones en cola (sesión restaurada).`);
    return {
      reviewRows,
      payload: nextPayload,
      currentIndex: focus.index,
      reviewSourceLabel,
      focus,
      href: buildReviewPageHref(focus.symbol, storedReview.source || "current"),
    };
  }

  function persistScreenerReviewQueue(currentRows, startSymbol = "", options = {}) {
    const reviewRows = prepareReviewQueueRows(currentRows, activeSettings);
    if (!reviewRows.length) return null;
    const reviewSourceLabel = options.sourceLabel || "Screener actual";
    const reviewSourceDetail = options.sourceDetail || "";
    const queueMode = options.queueMode || "screener-review";
    const nextResolutionFilter = options.resolutionFilter || "all";
    const nextDigestFilter = options.digestFilter || "all";
    const resolvedSymbol = startSymbol || reviewRows[0]?.symbol || "";
    const currentIndex = Math.max(0, reviewRows.findIndex((row) => row.symbol === resolvedSymbol));
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    const decisionState = reviewDecisionStateForRows(previousReview, reviewRows);
    const sessionIdentity = buildReviewSessionIdentity();
    const payload = {
      source: "current",
      sourceLabel: reviewSourceLabel,
      sourceDetail: reviewSourceDetail,
      queueMode,
      rows: reviewRows,
      activeSettings,
      presetKey,
      sessionIdentity,
      currentIndex,
      contractContext: buildScreenerStockOpenContext(reviewRows[currentIndex], { rank: currentIndex + 1, queueSize: reviewRows.length, sourceLabel: reviewSourceLabel === "Screener actual" ? "Revisión Screener" : reviewSourceLabel }),
      reviewedSymbols: decisionState.reviewedSymbols,
      hiddenSymbols: decisionState.hiddenSymbols,
      decisionResolutions: decisionState.decisionResolutions,
      decisionResolutionLog: decisionState.decisionResolutionLog,
      resolutionFilter: nextResolutionFilter,
      digestFilter: nextDigestFilter,
      selectedSymbol: resolvedSymbol,
      updatedAt: new Date().toISOString(),
    };
    persistReviewQueue(payload);
    return { reviewRows, payload, currentIndex, reviewSourceLabel };
  }

  function openReview(currentRows, startSymbol = "", options = {}) {
    const resumed = resumeStoredReviewSession(startSymbol, options);
    if (resumed) return;
    const persisted = persistScreenerReviewQueue(currentRows, startSymbol, options);
    if (!persisted) {
      setStatus("Sin filas actuales para abrir vista rápida.");
      return;
    }
    const { reviewRows, currentIndex, reviewSourceLabel } = persisted;
    setQuickReviewRows(reviewRows);
    setQuickReviewIndex(currentIndex);
    setActiveModalRow(reviewRows[currentIndex]);
    setStatus(`${reviewSourceLabel}: ${reviewRows.length} acciones en cola.`);
  }

  function openReviewPage(currentRows, startSymbol = "", options = {}) {
    const resumeStartSymbol = canResumeStoredReviewSession(options) ? "" : startSymbol;
    const resumed = resumeStoredReviewSession(resumeStartSymbol, options);
    if (resumed) return resumed.href;
    const persisted = persistScreenerReviewQueue(currentRows, startSymbol, options);
    if (!persisted) {
      setStatus("Sin filas actuales para abrir revisión.");
      return "";
    }
    const { reviewRows, payload, reviewSourceLabel } = persisted;
    setStatus(`${reviewSourceLabel}: ${reviewRows.length} acciones en cola.`);
    return buildReviewPageHref(payload.selectedSymbol, payload.source);
  }

  function selectQuickReview(index, list = quickReviewRows) {
    if (!list.length) return;
    const nextIndex = ((index % list.length) + list.length) % list.length;
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    const decisionState = reviewDecisionStateForRows(previousReview, list);
    setQuickReviewIndex(nextIndex);
    setActiveModalRow(list[nextIndex]);
    persistReviewQueue({
      ...previousReview,
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
    openReviewPage,
    canResumeStoredReviewSession,
    resumeStoredReviewSession,
    selectQuickReview,
    moveQuickReview,
    closeQuickReview,
    saveQuickReviewStockOpen,
    resolveQuickReviewDecision,
    reopenQuickReviewDecision,
  };
}
