export const STOCK_DECISION_ACTIONS = [
  {
    key: "candidate",
    label: "Candidata",
    detail: "Mantener en seguimiento activo",
    tone: "good",
    reviewState: "reviewed",
  },
  {
    key: "watch",
    label: "Vigilar",
    detail: "No es entrada limpia todavía",
    tone: "warn",
    reviewState: "reviewed",
  },
  {
    key: "reject",
    label: "Descartar",
    detail: "Sacar de la cola visible",
    tone: "bad",
    reviewState: "hidden",
  },
];

export const STOCK_DECISION_RESOLUTION_FILTERS = [
  { key: "all", label: "Todas", tone: "neutral" },
  { key: "pending", label: "Pendientes", tone: "neutral" },
  ...STOCK_DECISION_ACTIONS.map(({ key, label, tone }) => ({ key, label, tone })),
];

export const STOCK_DECISION_RESOLUTION_LOG_LIMIT = 200;

export const STOCK_DECISION_REOPEN_ACTION = {
  key: "reopen",
  label: "Reabierta",
  detail: "Vuelve a pendiente",
  tone: "neutral",
};

export const STOCK_DECISION_VALIDATION_STATES = [
  { key: "validated", label: "Validado", tone: "good", detail: "La prueba de foco queda confirmada en la ficha." },
  { key: "pending", label: "Pendiente", tone: "warn", detail: "La prueba sigue sin confirmar o necesita más espera." },
  { key: "blocked", label: "Bloquea", tone: "bad", detail: "La prueba invalida o bloquea la decisión." },
];

export function stockDecisionAction(key = "") {
  return STOCK_DECISION_ACTIONS.find((item) => item.key === key) || null;
}

export function stockDecisionLogAction(key = "") {
  return stockDecisionAction(key) || (key === STOCK_DECISION_REOPEN_ACTION.key ? STOCK_DECISION_REOPEN_ACTION : null);
}

export function stockDecisionValidationState(key = "") {
  return STOCK_DECISION_VALIDATION_STATES.find((item) => item.key === key)
    || STOCK_DECISION_VALIDATION_STATES[1];
}

export function stockDecisionResolutionFilter(key = "") {
  return STOCK_DECISION_RESOLUTION_FILTERS.find((item) => item.key === key)
    || STOCK_DECISION_RESOLUTION_FILTERS[0];
}

function cleanNoteText(value = "", limit = 220) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function buildStockDecisionResolutionNote({
  validationKey = "pending",
  focusLabel = "",
  comment = "",
  fallback = "",
} = {}) {
  const validation = stockDecisionValidationState(validationKey);
  const label = cleanNoteText(focusLabel, 120);
  const note = cleanNoteText(comment, 120);
  const parts = [
    validation?.label || "Pendiente",
    label,
  ].filter(Boolean);
  const base = parts.length ? parts.join(": ") : cleanNoteText(fallback, 180);
  return cleanNoteText([base, note].filter(Boolean).join(" · "), 220);
}

function uniqueSymbols(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean))];
}

function cleanResolutionEntry(entry = {}) {
  const symbol = String(entry?.symbol || "").trim().toUpperCase();
  const action = stockDecisionLogAction(entry?.key);
  if (!symbol || !action) return null;
  return {
    symbol,
    key: action.key,
    label: entry.label || action.label,
    detail: entry.detail || action.detail,
    tone: entry.tone || action.tone,
    source: String(entry.source || "stock"),
    note: String(entry.note || "").slice(0, 220),
    updatedAt: String(entry.updatedAt || ""),
  };
}

function resolutionLogEntries(values = []) {
  return (Array.isArray(values) ? values : []).map(cleanResolutionEntry).filter(Boolean);
}

export function decisionResolutionForSymbol(review = {}, symbol = "") {
  const key = String(symbol || "").trim().toUpperCase();
  if (!key) return null;
  return review?.decisionResolutions?.[key] || null;
}

export function decisionResolutionKeyForSymbol(review = {}, symbol = "") {
  const resolution = decisionResolutionForSymbol(review, symbol);
  return stockDecisionAction(resolution?.key) ? resolution.key : "pending";
}

function incrementSummaryItem(item, symbol, index) {
  item.count += 1;
  if (item.firstIndex < 0) item.firstIndex = index;
  if (symbol && item.sampleSymbols.length < 5) item.sampleSymbols.push(symbol);
}

export function buildStockDecisionResolutionSummary(rows = [], review = {}) {
  const summary = new Map(STOCK_DECISION_RESOLUTION_FILTERS.map((item) => [
    item.key,
    { ...item, count: 0, firstIndex: -1, sampleSymbols: [] },
  ]));

  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    if (!symbol) return;
    incrementSummaryItem(summary.get("all"), symbol, index);
    const key = decisionResolutionKeyForSymbol(review, symbol);
    incrementSummaryItem(summary.get(key) || summary.get("pending"), symbol, index);
  });

  return STOCK_DECISION_RESOLUTION_FILTERS
    .map((item) => summary.get(item.key))
    .filter((item) => item.key === "all" || item.count > 0);
}

export function filterRowsByDecisionResolution(rows = [], review = {}, filterKey = "all") {
  const filter = stockDecisionResolutionFilter(filterKey);
  if (filter.key === "all") return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => decisionResolutionKeyForSymbol(review, row?.symbol) === filter.key);
}

function rowSymbolSet(rows = []) {
  return new Set((Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.symbol || "").trim().toUpperCase())
    .filter(Boolean));
}

export function reviewDecisionStateForRows(review = {}, rows = []) {
  const symbols = rowSymbolSet(rows);
  const reviewedSymbols = new Set(uniqueSymbols(review.reviewedSymbols).filter((symbol) => symbols.has(symbol)));
  const hiddenSymbols = new Set(uniqueSymbols(review.hiddenSymbols).filter((symbol) => symbols.has(symbol)));
  const decisionResolutions = {};
  for (const symbol of symbols) {
    const resolution = decisionResolutionForSymbol(review, symbol);
    const entry = cleanResolutionEntry({ ...(resolution || {}), symbol });
    if (!entry || !stockDecisionAction(entry.key)) continue;
    reviewedSymbols.add(symbol);
    if (stockDecisionAction(entry.key)?.reviewState === "hidden") hiddenSymbols.add(symbol);
    decisionResolutions[symbol] = {
      key: entry.key,
      label: entry.label,
      detail: entry.detail,
      tone: entry.tone,
      source: entry.source,
      note: entry.note,
      updatedAt: entry.updatedAt,
    };
  }

  return {
    reviewedSymbols: [...reviewedSymbols],
    hiddenSymbols: [...hiddenSymbols],
    decisionResolutions,
    decisionResolutionLog: decisionResolutionHistory(review, { limit: STOCK_DECISION_RESOLUTION_LOG_LIMIT })
      .filter((entry) => symbols.has(entry.symbol)),
  };
}

export function decisionResolutionHistory(review = {}, {
  symbol = "",
  limit = 5,
} = {}) {
  const cleanSymbol = String(symbol || "").trim().toUpperCase();
  const logEntries = resolutionLogEntries(review?.decisionResolutionLog);
  const fallbackEntries = Object.entries(review?.decisionResolutions || {})
    .map(([entrySymbol, resolution]) => cleanResolutionEntry({ ...(resolution || {}), symbol: entrySymbol }));
  const entries = logEntries.length ? logEntries : fallbackEntries.filter(Boolean);
  const filtered = cleanSymbol ? entries.filter((entry) => entry.symbol === cleanSymbol) : entries;
  return filtered
    .slice()
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, Math.max(0, Number.isFinite(limit) ? limit : 5));
}

export function applyStockDecisionResolution(review = {}, {
  symbol = "",
  actionKey = "",
  source = "stock",
  note = "",
  at = "",
} = {}) {
  const cleanSymbol = String(symbol || "").trim().toUpperCase();
  const action = stockDecisionAction(actionKey);
  if (!cleanSymbol || !action) return review || {};
  const updatedAt = at || new Date().toISOString();

  const reviewedSymbols = new Set(uniqueSymbols(review.reviewedSymbols));
  const hiddenSymbols = new Set(uniqueSymbols(review.hiddenSymbols));
  reviewedSymbols.add(cleanSymbol);
  if (action.reviewState === "hidden") hiddenSymbols.add(cleanSymbol);
  else hiddenSymbols.delete(cleanSymbol);

  const resolution = {
    key: action.key,
    label: action.label,
    detail: action.detail,
    tone: action.tone,
    source,
    note: String(note || "").slice(0, 220),
    updatedAt,
  };
  const logEntry = { symbol: cleanSymbol, ...resolution };
  const previousLog = resolutionLogEntries(review?.decisionResolutionLog);
  const decisionResolutionLog = [
    logEntry,
    ...previousLog.filter((entry) => !(entry.symbol === cleanSymbol && entry.key === action.key && entry.updatedAt === updatedAt)),
  ].slice(0, STOCK_DECISION_RESOLUTION_LOG_LIMIT);

  return {
    ...(review || {}),
    reviewedSymbols: [...reviewedSymbols],
    hiddenSymbols: [...hiddenSymbols],
    decisionResolutions: {
      ...(review?.decisionResolutions || {}),
      [cleanSymbol]: resolution,
    },
    decisionResolutionLog,
    selectedSymbol: cleanSymbol,
    updatedAt,
  };
}

export function reopenStockDecisionResolution(review = {}, {
  symbol = "",
  source = "review",
  note = "",
  at = "",
} = {}) {
  const cleanSymbol = String(symbol || "").trim().toUpperCase();
  if (!cleanSymbol) return review || {};
  const updatedAt = at || new Date().toISOString();

  const reviewedSymbols = new Set(uniqueSymbols(review.reviewedSymbols));
  const hiddenSymbols = new Set(uniqueSymbols(review.hiddenSymbols));
  reviewedSymbols.delete(cleanSymbol);
  hiddenSymbols.delete(cleanSymbol);

  const decisionResolutions = { ...(review?.decisionResolutions || {}) };
  delete decisionResolutions[cleanSymbol];

  const logEntry = {
    symbol: cleanSymbol,
    key: STOCK_DECISION_REOPEN_ACTION.key,
    label: STOCK_DECISION_REOPEN_ACTION.label,
    detail: STOCK_DECISION_REOPEN_ACTION.detail,
    tone: STOCK_DECISION_REOPEN_ACTION.tone,
    source,
    note: String(note || "").slice(0, 220),
    updatedAt,
  };
  const previousLog = resolutionLogEntries(review?.decisionResolutionLog);
  const decisionResolutionLog = [
    logEntry,
    ...previousLog.filter((entry) => !(entry.symbol === cleanSymbol && entry.key === logEntry.key && entry.updatedAt === updatedAt)),
  ].slice(0, STOCK_DECISION_RESOLUTION_LOG_LIMIT);

  return {
    ...(review || {}),
    reviewedSymbols: [...reviewedSymbols],
    hiddenSymbols: [...hiddenSymbols],
    decisionResolutions,
    decisionResolutionLog,
    selectedSymbol: cleanSymbol,
    updatedAt,
  };
}
