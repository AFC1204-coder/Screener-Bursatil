const MAX_SAVED_LIST_VIEWS = 12;
const VALID_GROUP_TYPES = new Set(["theme", "sector", "industry", "country"]);

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dimensionLabel(groupType = "") {
  return {
    theme: "Tematica",
    sector: "Sector",
    industry: "Industria",
    country: "Pais",
  }[groupType] || "Global";
}

export function normalizeListScope(scope = {}) {
  const groupType = cleanText(scope.groupType);
  const group = cleanText(scope.group);
  if (!group || !VALID_GROUP_TYPES.has(groupType)) {
    return { groupType: "", group: "", label: "Global" };
  }
  return { groupType, group, label: `${dimensionLabel(groupType)} · ${group}` };
}

export function listViewSignature(scope = {}) {
  const normalized = normalizeListScope(scope);
  return normalized.group ? `${normalized.groupType}:${normalized.group}` : "global";
}

export function listViewHref(view = {}) {
  const scope = normalizeListScope(view.scope || view);
  if (!scope.group) return "/lists";
  const params = new URLSearchParams({ groupType: scope.groupType, group: scope.group });
  return `/lists?${params.toString()}`;
}

export function defaultListViewName(scope = {}) {
  const normalized = normalizeListScope(scope);
  return normalized.group ? normalized.label : "Discovery global";
}

export function normalizeSavedListView(view = {}) {
  const scope = normalizeListScope(view.scope || view);
  const signature = listViewSignature(scope);
  const savedAt = cleanText(view.savedAt || view.createdAt || "");
  const updatedAt = cleanText(view.updatedAt || savedAt || new Date().toISOString());
  const generatedAt = cleanText(view.generatedAt || "");
  const source = cleanText(view.source || "local");
  return {
    id: cleanText(view.id) || signature || uid(),
    name: cleanText(view.name) || defaultListViewName(scope),
    signature,
    scope,
    source,
    generatedAt,
    savedAt: savedAt || updatedAt,
    updatedAt,
    href: listViewHref(scope),
    counts: {
      rows: finiteOrNull(view.counts?.rows ?? view.rows),
      lists: finiteOrNull(view.counts?.lists ?? view.lists),
      scopeRows: finiteOrNull(view.counts?.scopeRows ?? view.scopeRows),
      staleRows: finiteOrNull(view.counts?.staleRows ?? view.staleRows),
      planClaims: finiteOrNull(view.counts?.planClaims ?? view.planClaims),
    },
    criteria: {
      derivedOnly: view.criteria?.derivedOnly === true,
      maxPriceFreshnessDays: finiteOrNull(view.criteria?.maxPriceFreshnessDays),
      minCoverageScore: finiteOrNull(view.criteria?.minCoverageScore),
    },
  };
}

export function savedListViewMetaLine(view = {}) {
  const normalized = normalizeSavedListView(view);
  const generatedDate = normalized.generatedAt ? new Date(normalized.generatedAt) : null;
  const generated = generatedDate && Number.isFinite(generatedDate.getTime()) ? generatedDate.toLocaleString() : "sin fecha API";
  const source = normalized.source === "discovery-api" ? "API" : "Local";
  const rows = normalized.counts.rows;
  const scopeRows = normalized.counts.scopeRows;
  const parts = [source];

  if (Number.isFinite(scopeRows) && scopeRows > 0 && scopeRows !== rows) {
    parts.push(`${scopeRows} en grupo`);
    if (Number.isFinite(rows) && rows > 0) parts.push(`top ${rows}`);
  } else if (normalized.source === "discovery-api" && normalized.scope.group && Number.isFinite(rows)) {
    parts.push(`${rows} alcance`);
  } else if (Number.isFinite(rows)) {
    parts.push(`${rows} filas`);
  } else {
    parts.push("filas -");
  }

  parts.push(generated);
  return parts.join(" · ");
}

export function normalizeSavedListViews(views = []) {
  const bySignature = new Map();
  for (const view of Array.isArray(views) ? views : []) {
    const normalized = normalizeSavedListView(view);
    const previous = bySignature.get(normalized.signature);
    if (!previous || Date.parse(normalized.updatedAt || "") >= Date.parse(previous.updatedAt || "")) {
      bySignature.set(normalized.signature, normalized);
    }
  }
  return [...bySignature.values()]
    .sort((a, b) => (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0))
    .slice(0, MAX_SAVED_LIST_VIEWS);
}

export function buildSavedListView({ filter = {}, discovery = null, usingDiscovery = false, localRows = 0, now = new Date().toISOString(), id = "" } = {}) {
  const scope = normalizeListScope(filter);
  const health = discovery?.health || {};
  const criteria = discovery?.criteria || {};
  return normalizeSavedListView({
    id: id || `${listViewSignature(scope)}:${now}`,
    name: defaultListViewName(scope),
    scope,
    source: usingDiscovery ? "discovery-api" : "local-snapshot",
    generatedAt: usingDiscovery ? cleanText(discovery?.generatedAt) : "",
    savedAt: now,
    updatedAt: now,
    counts: {
      rows: usingDiscovery ? health.rows : localRows,
      lists: usingDiscovery ? health.listItemCount : null,
      scopeRows: usingDiscovery ? health.scopeRows : null,
      staleRows: usingDiscovery ? health.staleRows : null,
      planClaims: usingDiscovery ? health.planClaims : null,
    },
    criteria: {
      derivedOnly: usingDiscovery,
      maxPriceFreshnessDays: criteria.maxPriceFreshnessDays,
      minCoverageScore: criteria.minCoverageScore,
    },
  });
}
