const MARKET_SOURCE_POLICIES = {
  US: {
    target: 5500,
    mode: "official_public",
    officialSources: ["NasdaqTrader symbol directories", "universe"],
    minOfficialCount: 1000,
    completeLabel: "Fuente oficial activa",
    fallbackLabel: "Fuente oficial ausente",
    sourceClaim: "Directorio publico NasdaqTrader",
  },
  HK: {
    target: 2500,
    mode: "official_public",
    officialSources: ["HKEX Full List of Securities"],
    minOfficialCount: 500,
    completeLabel: "Fuente oficial activa",
    fallbackLabel: "Fuente oficial ausente",
    sourceClaim: "HKEX oficial",
  },
  TW: {
    target: 900,
    mode: "official_public",
    officialSources: ["TWSE ISIN listed equities"],
    minOfficialCount: 800,
    completeLabel: "Fuente oficial activa",
    fallbackLabel: "Fuente oficial ausente",
    sourceClaim: "TWSE oficial",
  },
  JP: {
    target: 1500,
    mode: "provider_when_configured",
    officialSources: ["J-Quants"],
    minOfficialCount: 800,
    completeLabel: "Proveedor oficial activo",
    fallbackLabel: "Proveedor oficial no configurado",
    sourceClaim: "J-Quants",
  },
  CA: { target: 1000, mode: "curated_core", sourceClaim: "Core curado legal-safe" },
  SG: { target: 350, mode: "curated_core", sourceClaim: "Core curado legal-safe" },
  ZA: { target: 250, mode: "curated_core", sourceClaim: "Core curado legal-safe" },
  IN: { target: 1200, mode: "deferred_curated", sourceClaim: "Core curado diferido" },
  IL: { target: 450, mode: "deferred_curated", sourceClaim: "Core curado diferido" },
  AU: { target: 1200, mode: "partial_provider", sourceClaim: "ASIC proxy + core curado" },
};

function clampPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function sourceCount(bySource = {}, names = []) {
  return names.reduce((sum, name) => sum + Number(bySource[name] || 0), 0);
}

function curatedCount(bySource = {}) {
  return Object.entries(bySource).reduce((sum, [source, count]) => {
    return /curated/i.test(source) ? sum + Number(count || 0) : sum;
  }, 0);
}

function policyForMarket(market = "") {
  return MARKET_SOURCE_POLICIES[String(market || "").toUpperCase()] || null;
}

function providerIssueDetail(provider = null) {
  if (!provider || provider.status === "ok" || provider.status === "unknown") return "";
  if (provider.status === "not_configured") {
    return `${provider.label || "Proveedor"} no configurado; se mantiene fallback curado hasta activar credenciales/flag.`;
  }
  const reason = provider.reason ? ` (${provider.reason})` : "";
  const retry = provider.retryAfter ? ` Proximo reintento: ${provider.retryAfter}.` : "";
  return `${provider.label || "Proveedor"} en estado degradado${reason}.${retry}`;
}

function withProviderDetail(detail = "", provider = null) {
  const issue = providerIssueDetail(provider);
  return issue ? `${detail} ${issue}` : detail;
}

export function coverageReadinessForMarket({ market = "", byMarket = {}, bySource = {}, target = null, scan = null, provider = null } = {}) {
  const code = String(market || "").toUpperCase();
  const policy = policyForMarket(code);
  const current = Number(byMarket[code] || 0);
  const targetCount = Number(target || policy?.target || current || 1);
  const coveragePct = clampPct((current / Math.max(targetCount, 1)) * 100);
  const officialCount = sourceCount(bySource, policy?.officialSources || []);
  const curated = curatedCount(bySource);
  const hasScan = Boolean(scan) && (Number.isFinite(Number(scan.activationPct)) || Number.isFinite(Number(scan.uniqueSymbols)));
  const activationPct = hasScan ? (scan?.activationPct ?? clampPct((Number(scan?.uniqueSymbols || 0) / Math.max(current, 1)) * 100)) : null;

  if (policy?.officialSources?.length && officialCount < Number(policy.minOfficialCount || 1)) {
    return {
      state: "official_source_missing",
      label: policy.fallbackLabel || "Fuente oficial ausente",
      tone: "warn",
      sourceClaim: curated ? "Fallback curado parcial" : "Sin fuente operativa",
      detail: withProviderDetail(`${policy.sourceClaim || "Fuente oficial"} no alcanzo el mínimo esperado (${officialCount}/${policy.minOfficialCount || 1}); no presentar este mercado como cobertura oficial.`, provider),
      operational: false,
      officialCount,
      curatedCount: curated,
      coveragePct,
      activationPct,
      providerStatus: provider,
      blocksCoverageClaim: true,
    };
  }

  if (policy?.mode === "curated_core" || policy?.mode === "deferred_curated") {
    return {
      state: policy.mode,
      label: policy.mode === "deferred_curated" ? "Mercado diferido" : "Core curado",
      tone: "warn",
      sourceClaim: policy.sourceClaim,
      detail: withProviderDetail(policy.mode === "deferred_curated"
        ? "Disponible para uso manual; fuera del core operativo hasta que haya demanda o proveedor/licencia."
        : "Cobertura útil por liquidez, pero no equivale a universo completo de exchange.", provider),
      operational: false,
      officialCount,
      curatedCount: curated,
      coveragePct,
      activationPct,
      providerStatus: provider,
      blocksCoverageClaim: true,
    };
  }

  if (policy?.mode === "partial_provider") {
    return {
      state: "partial_provider",
      label: "Datos limitados",
      tone: "warn",
      sourceClaim: policy.sourceClaim,
      detail: withProviderDetail("La fuente actual ayuda a descubrir candidatos, pero no es master list completa del exchange.", provider),
      operational: coveragePct >= 40,
      officialCount,
      curatedCount: curated,
      coveragePct,
      activationPct,
      providerStatus: provider,
      blocksCoverageClaim: true,
    };
  }

  if (coveragePct < 25) {
    return {
      state: "coverage_gap",
      label: "Cobertura baja",
      tone: "warn",
      sourceClaim: policy?.sourceClaim || "Core curado / proveedor pendiente",
      detail: withProviderDetail("Inventario insuficiente frente al objetivo operativo; usar solo como muestra parcial.", provider),
      operational: false,
      officialCount,
      curatedCount: curated,
      coveragePct,
      activationPct,
      providerStatus: provider,
      blocksCoverageClaim: true,
    };
  }

  if (hasScan && activationPct < 20) {
    return {
      state: "inventory_not_materialized",
      label: "Datos de este mercado aún no están listos",
      tone: "warn",
      sourceClaim: policy?.sourceClaim || "Inventario disponible",
      detail: withProviderDetail("Hay inventario, pero pocos símbolos estan escaneados/frescos; no usar como cobertura operativa plena.", provider),
      operational: false,
      officialCount,
      curatedCount: curated,
      coveragePct,
      activationPct,
      providerStatus: provider,
      blocksCoverageClaim: true,
    };
  }

  return {
    state: "operational",
    label: policy?.completeLabel || "Cobertura operativa",
    tone: "pass",
    sourceClaim: policy?.sourceClaim || "Inventario operativo",
    detail: withProviderDetail("Fuente e inventario suficientes para lectura operativa derivada.", provider),
    operational: true,
    officialCount,
    curatedCount: curated,
    coveragePct,
    activationPct,
    providerStatus: provider,
    blocksCoverageClaim: false,
  };
}

export function coverageReadinessForSnapshot(snapshot = {}, options = {}) {
  const byMarket = snapshot.coverage?.byMarket || {};
  const bySource = snapshot.coverage?.bySource || {};
  const bySourceByMarket = snapshot.coverage?.bySourceByMarket || {};
  const markets = Array.isArray(snapshot.markets) ? snapshot.markets : Object.keys(byMarket);
  const scanByMarket = options.scanByMarket || {};
  const rows = {};
  const issues = [];
  for (const market of markets) {
    const readiness = coverageReadinessForMarket({
      market,
      byMarket,
      bySource: bySourceByMarket[market] || bySource,
      target: options.targets?.[market],
      scan: scanByMarket[market],
      provider: snapshot.providerDiagnostics?.byMarket?.[market] || options.providerByMarket?.[market] || null,
    });
    rows[market] = readiness;
    if (readiness.blocksCoverageClaim) {
      issues.push({
        market,
        state: readiness.state,
        label: readiness.label,
        detail: readiness.detail,
        tone: readiness.tone,
      });
    }
  }
  return {
    byMarket: rows,
    issues,
    summary: {
      markets: markets.length,
      operational: Object.values(rows).filter((row) => row.operational).length,
      partial: Object.values(rows).filter((row) => !row.operational).length,
      officialSourceMissing: Object.values(rows).filter((row) => row.state === "official_source_missing").length,
      curatedOrDeferred: Object.values(rows).filter((row) => /curated|deferred/.test(row.state)).length,
    },
  };
}
