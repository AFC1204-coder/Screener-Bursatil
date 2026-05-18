"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import ChartPreferences from "@/app/ChartPreferences";
import UniversalPriceChart from "@/app/UniversalPriceChart";
import { chartRangeBars, DEFAULT_CHART_SETTINGS, readChartSettings, writeChartSettings } from "@/lib/chartSettings";
import { syncAlertsToCloud, syncFavoriteToCloud, syncScanToCloud } from "@/lib/cloudSyncClient";
import { assetDomainForName, assetDomainForSymbol } from "@/lib/companyAssets";
import { pct } from "@/lib/formatters";
import { safeRead, safeRemove, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { alertsFromScan, mergeAlerts } from "@/lib/methodologyAlerts";
import { compactMethodologySnapshot, enrichRowsWithMethodology, findCompatiblePreviousScan, snapshotCompatibilityKey, summarizeMethodology } from "@/lib/methodologyEngine";
import { qualityGateForResearchRow } from "@/lib/qualityGate";
import { countryCode, countryName, externalLinks, isTradingViewWidgetBlocked, marketFlag, stockUrl } from "@/lib/symbols";

const MARKET_META = {
  US: { name: "Estados Unidos", exchange: "NYSE / Nasdaq", region: "Norteamerica" },
  ES: { name: "España", exchange: "BME", region: "Europa" },
  DE: { name: "Alemania", exchange: "Xetra", region: "Europa" },
  FR: { name: "Francia", exchange: "Euronext Paris", region: "Europa" },
  NL: { name: "Países Bajos", exchange: "Euronext Amsterdam", region: "Europa" },
  GB: { name: "Reino Unido", exchange: "LSE", region: "Europa" },
  CH: { name: "Suiza", exchange: "SIX", region: "Europa" },
  SE: { name: "Suecia", exchange: "Nasdaq Stockholm", region: "Europa" },
  DK: { name: "Dinamarca", exchange: "Nasdaq Copenhagen", region: "Europa" },
  NO: { name: "Noruega", exchange: "Oslo Bors", region: "Europa" },
  FI: { name: "Finlandia", exchange: "Nasdaq Helsinki", region: "Europa" },
  IT: { name: "Italia", exchange: "Borsa Italiana", region: "Europa" },
  BE: { name: "Bélgica", exchange: "Euronext Brussels", region: "Europa" },
  PT: { name: "Portugal", exchange: "Euronext Lisbon", region: "Europa" },
  AT: { name: "Austria", exchange: "Vienna", region: "Europa" },
  IE: { name: "Irlanda", exchange: "Euronext Dublin", region: "Europa" },
  CA: { name: "Canadá", exchange: "TSX", region: "Norteamérica" },
  JP: { name: "Japón", exchange: "TSE", region: "Asia" },
  HK: { name: "Hong Kong", exchange: "HKEX", region: "Asia" },
  SG: { name: "Singapur", exchange: "SGX", region: "Asia" },
  AU: { name: "Australia", exchange: "ASX", region: "Oceania" },
  TW: { name: "Taiwán", exchange: "TWSE", region: "Asia" },
  KR: { name: "Corea del Sur", exchange: "KRX / KOSDAQ", region: "Asia" },
  IN: { name: "India", exchange: "NSE / BSE", region: "Asia" },
  CN: { name: "China A", exchange: "Shanghai / Shenzhen", region: "Asia" },
  BR: { name: "Brasil", exchange: "B3", region: "LatAm" },
  MX: { name: "México", exchange: "BMV", region: "LatAm" },
};
const MARKET_ORDER = ["US", "ES", "DE", "FR", "NL", "GB", "CH", "SE", "DK", "NO", "FI", "IT", "BE", "PT", "AT", "IE", "CA", "JP", "HK", "SG", "TW", "KR", "IN", "CN", "AU", "BR", "MX"];
const MARKETS = MARKET_ORDER.map((code) => [code, MARKET_META[code].name]);
const EUROPE = ["ES", "DE", "FR", "NL", "GB", "CH", "SE", "DK", "NO", "FI", "IT", "BE", "PT", "AT", "IE"];
const ASIA = ["JP", "HK", "SG", "TW", "KR", "IN", "CN"];
const DEFAULT_MARKETS = ["US", ...EUROPE, "CA", ...ASIA, "AU", "BR", "MX"];
const ALL_SYMBOLS_LIMIT = 999999;
const SCREENER_SESSION_VERSION = 1;
const RESULT_PAGE_SIZES = [50, 100];
const DEFAULT_RESULT_PAGE_SIZE = 50;
const SCAN_BATCH_SIZES = [50, 100];
const DEFAULT_SCAN_BATCH_SIZE = 100;
const DEFAULT_STATUS = "Listo · Universo por defecto: EEUU + Europa + Asia/HK + Canadá + Australia/LatAm";
const QUALITY_DEFAULTS = { setupMode: "leader", requireStage2: true, requireSma200Up: false, requirePriceAboveSma50: false, requireRecentIpo: false, requireUpVolume: false, maxIpoAgeMonths: 60, minWeinsteinScore: 55, minMinerviniScore: 45, minMomentumScore: 25, minRiskScore: 30, minVolumeScore: 15, minLiquidityScore: 15, minRsRating: 55, minRsQualityScore: 0, minAdProxyScore: 0, minEpsGrowthProxyScore: 0, minWeaknessScore: 50, minSectorScore: 0, minTotalScore: 0, minDataCoverageScore: 50, minTechnicalCoverageScore: 70, minFundamentalCoverageScore: 0, minAvgTurnover: 5000000, minLatestVolume: 100000, minLatestTurnover: 2000000, minRelativeVolume: 1.2, minVolumeSurgePct: 25, minUpDownVolRatio: .9, minVolumeEffectScore: 20, minShortFloatPct: 0, maxShortFloatPct: 999, minRiskRewardScore: 45, minReturnToVol3m: .35, minReturnToDrawdown3m: .8, maxDailyMove20dPct: 18, maxDailyRange20dPct: 22, maxRange63dPct: 85, maxVolatility63d: 85, maxDrawdown63d: 32 };
const PRESETS = {
  balanced: { name: "Balanceado", desc: "Weinstein + Minervini estandar", v: { ...QUALITY_DEFAULTS, minMarketCap: 300000000, minPrice: 3, minAvgVolume: 300000, maxDistance20dHigh: 10, maxDistance50dHigh: 18, maxDistance52w: 25, maxDistanceATH: 40, maxHighsSpreadPct: 15, minPerf3m: 10, minPerf6m: 20, minPerf12m: 30, maxExtensionSma50: 30, maxSymbols: ALL_SYMBOLS_LIMIT } },
  strict: { name: "Lideres estrictos", desc: "Muy selectivo", v: { ...QUALITY_DEFAULTS, setupMode: "leader", minMarketCap: 500000000, minPrice: 5, minAvgVolume: 500000, minAvgTurnover: 10000000, minLatestVolume: 250000, minLatestTurnover: 5000000, minUpDownVolRatio: 1, minVolumeEffectScore: 35, maxDistance20dHigh: 5, maxDistance50dHigh: 10, maxDistance52w: 15, maxDistanceATH: 25, maxHighsSpreadPct: 8, minPerf3m: 15, minPerf6m: 30, minPerf12m: 50, maxExtensionSma50: 25, maxDailyMove20dPct: 12, maxDailyRange20dPct: 16, maxRange63dPct: 55, maxVolatility63d: 60, maxDrawdown63d: 22, minWeinsteinScore: 75, minMinerviniScore: 65, minMomentumScore: 45, minRiskScore: 50, minVolumeScore: 30, minLiquidityScore: 35, minRsRating: 75, minSectorScore: 55, minTotalScore: 68, maxSymbols: ALL_SYMBOLS_LIMIT } },
  early: { name: "Etapa 2 temprana", desc: "Bases y lideres tempranos", v: { ...QUALITY_DEFAULTS, setupMode: "early", requireStage2: false, requireSma200Up: false, minMarketCap: 250000000, minPrice: 3, minAvgVolume: 200000, maxDistance20dHigh: 15, maxDistance50dHigh: 25, maxDistance52w: 30, maxDistanceATH: 45, maxHighsSpreadPct: 20, minPerf3m: 5, minPerf6m: 10, minPerf12m: 15, maxExtensionSma50: 22, maxDailyMove20dPct: 22, maxDailyRange20dPct: 28, maxRange63dPct: 100, maxVolatility63d: 100, minWeinsteinScore: 45, minMinerviniScore: 35, minMomentumScore: 15, maxSymbols: ALL_SYMBOLS_LIMIT } },
  broad: { name: "Exploratorio amplio", desc: "Mas candidatos / diagnostico", v: { ...QUALITY_DEFAULTS, setupMode: "any", requireStage2: false, requireSma200Up: false, minMarketCap: 150000000, minPrice: 2, minAvgVolume: 100000, minAvgTurnover: 1000000, minLatestVolume: 0, minLatestTurnover: 0, minUpDownVolRatio: 0, minVolumeEffectScore: 0, maxDistance20dHigh: 25, maxDistance50dHigh: 35, maxDistance52w: 40, maxDistanceATH: 60, maxHighsSpreadPct: 35, minPerf3m: 0, minPerf6m: 5, minPerf12m: 10, maxExtensionSma50: 45, maxDailyMove20dPct: 999, maxDailyRange20dPct: 999, maxRange63dPct: 999, maxVolatility63d: 999, maxDrawdown63d: 999, minWeinsteinScore: 25, minMinerviniScore: 20, minMomentumScore: 0, minRiskScore: 0, minVolumeScore: 0, minLiquidityScore: 0, minRsRating: 0, maxSymbols: ALL_SYMBOLS_LIMIT } },
  ipo: { name: "IPO / nuevos lideres", desc: "IPO reales recientes", v: { ...QUALITY_DEFAULTS, setupMode: "ipoRecent", requireStage2: false, requireSma200Up: false, requireRecentIpo: true, maxIpoAgeMonths: 60, minDataCoverageScore: 35, minTechnicalCoverageScore: 45, minFundamentalCoverageScore: 0, minMarketCap: 300000000, minPrice: 5, minAvgVolume: 200000, maxDistance20dHigh: 15, maxDistance50dHigh: 25, maxDistance52w: 30, maxDistanceATH: 40, maxHighsSpreadPct: 20, minPerf3m: 10, minPerf6m: 0, minPerf12m: -100, maxExtensionSma50: 35, maxDailyMove20dPct: 28, maxDailyRange20dPct: 34, maxRange63dPct: 120, maxVolatility63d: 140, minWeinsteinScore: 30, minMinerviniScore: 30, minMomentumScore: 35, maxSymbols: ALL_SYMBOLS_LIMIT } },
  nearPivot: { name: "Near Pivot", desc: "Fuerte, cerca de maximos y poco extendida", v: { ...QUALITY_DEFAULTS, setupMode: "nearPivot", minMarketCap: 300000000, minPrice: 3, minAvgVolume: 300000, maxDistance20dHigh: 5, maxDistance50dHigh: 10, maxDistance52w: 18, maxDistanceATH: 30, maxHighsSpreadPct: 8, minPerf3m: 8, minPerf6m: 15, minPerf12m: 20, maxExtensionSma50: 15, maxDailyMove20dPct: 10, maxDailyRange20dPct: 14, maxRange63dPct: 45, maxVolatility63d: 55, maxDrawdown63d: 18, minRiskScore: 55, minWeinsteinScore: 65, minMinerviniScore: 55, minRsRating: 62, minTotalScore: 58, maxSymbols: ALL_SYMBOLS_LIMIT } },
  weakness: { name: "Deterioro técnico", desc: "Debilidad para evitar largos", v: { ...QUALITY_DEFAULTS, setupMode: "weakness", requireStage2: false, requireSma200Up: false, requirePriceAboveSma50: false, requireRecentIpo: false, requireUpVolume: false, minMarketCap: 150000000, minPrice: 2, minAvgVolume: 100000, minAvgTurnover: 0, minLatestVolume: 0, minLatestTurnover: 0, maxDistance20dHigh: 999, maxDistance50dHigh: 999, maxDistance52w: 999, maxDistanceATH: 999, maxHighsSpreadPct: 999, minPerf3m: -100, minPerf6m: -100, minPerf12m: -100, maxExtensionSma50: 999, minWeinsteinScore: 0, minMinerviniScore: 0, minMomentumScore: 0, minRiskScore: 0, minVolumeScore: 0, minLiquidityScore: 0, minRsRating: 0, minRsQualityScore: 0, minWeaknessScore: 55, minSectorScore: 0, minTotalScore: 0, minRelativeVolume: 0, minVolumeSurgePct: -999, minUpDownVolRatio: 0, minVolumeEffectScore: 0, minRiskRewardScore: 0, minReturnToVol3m: -999, minReturnToDrawdown3m: -999, maxDailyMove20dPct: 999, maxDailyRange20dPct: 999, maxRange63dPct: 999, maxVolatility63d: 999, maxDrawdown63d: 999, maxSymbols: ALL_SYMBOLS_LIMIT } },
};
const SETUP_MODES = [
  ["leader", "Lider Stage 2"],
  ["nearPivot", "Near pivot"],
  ["pullback", "Pullback SMA50"],
  ["early", "Etapa 2 temprana"],
  ["ipoRecent", "IPO reciente real"],
  ["extended", "Extendida fuerte"],
  ["weakness", "Deterioro técnico"],
  ["any", "Exploratorio"],
];
const FILTER_GROUPS = [
  { title: "Liquidez", fields: [{ key: "minPrice", label: "Precio min", unit: "", step: 1 }, { key: "minMarketCap", label: "Market cap min", unit: "M", scale: 1000000, step: 50 }, { key: "minAvgVolume", label: "Acciones/día 20d min", unit: "k", scale: 1000, step: 25, hint: "Media de acciones negociadas en las últimas 20 sesiones." }, { key: "minAvgTurnover", label: "Importe 20d min", unit: "M", scale: 1000000, step: 1, hint: "Precio x volumen medio 20d en moneda de cotización. En mercados no USD no convierte divisa." }] },
  { title: "Volumen objetivo", fields: [{ key: "minLatestVolume", label: "Acciones sesion min", unit: "k", scale: 1000, step: 25, hint: "Volumen de la ultima vela diaria." }, { key: "minLatestTurnover", label: "Importe sesion min", unit: "M", scale: 1000000, step: 1, hint: "Precio actual x volumen de la ultima sesion." }, { key: "minRelativeVolume", label: "Volumen hoy / media 20d min", unit: "x", step: .1 }, { key: "minVolumeSurgePct", label: "Volumen 5d vs tramo previo min", unit: "%", step: 5 }, { key: "minUpDownVolRatio", label: "Up/Down volume 50d min", unit: "x", step: .1 }, { key: "minVolumeEffectScore", label: "Volume Effect min", unit: "", step: 5, hint: "Score 0-100 basado en importe negociado, volumen relativo, aceleracion 5d y up/down volume." }] },
  { title: "Short interest", fields: [{ key: "minShortFloatPct", label: "Short float min", unit: "%", step: 1, hint: "Porcentaje de la flota vendida en corto segun proveedor. Si no hay dato y esta regla esta activa, no pasa el filtro." }, { key: "maxShortFloatPct", label: "Short float max", unit: "%", step: 1, hint: "Util para evitar acciones con presion corta extrema si buscas largos mas limpios." }] },
  { title: "Momentum", fields: [{ key: "minPerf3m", label: "Perf 3M min", unit: "%", step: 1 }, { key: "minPerf6m", label: "Perf 6M min", unit: "%", step: 1 }, { key: "minPerf12m", label: "Perf 12M min", unit: "%", step: 1 }] },
  { title: "Cercania a maximos", fields: [{ key: "maxDistance20dHigh", label: "Max caida vs 20d", unit: "%", step: 1 }, { key: "maxDistance50dHigh", label: "Max caida vs 50d", unit: "%", step: 1 }, { key: "maxDistance52w", label: "Max caida vs 52w", unit: "%", step: 1 }, { key: "maxDistanceATH", label: "Max caida vs ATH", unit: "%", step: 1 }, { key: "maxHighsSpreadPct", label: "Highs spread max", unit: "%", step: 1 }, { key: "maxExtensionSma50", label: "Extension SMA50 max", unit: "%", step: 1 }] },
  { title: "Volatilidad / rango", fields: [{ key: "maxDailyMove20dPct", label: "Movimiento diario max 20d", unit: "%", step: 1, hint: "Mayor cambio absoluto cierre-cierre de las ultimas 20 sesiones." }, { key: "maxDailyRange20dPct", label: "Rango intradia max 20d", unit: "%", step: 1, hint: "Mayor rango high-low relativo al cierre en las ultimas 20 sesiones." }, { key: "maxRange63dPct", label: "Rango precio 63d max", unit: "%", step: 5, hint: "Amplitud high-low de los ultimos tres meses." }, { key: "maxVolatility63d", label: "Volatilidad anualizada max", unit: "%", step: 5 }, { key: "maxDrawdown63d", label: "Drawdown 3M max", unit: "%", step: 1 }] },
  { title: "Rentabilidad / riesgo", fields: [{ key: "minRsQualityScore", label: "RS Quality min", unit: "", step: 5 }, { key: "minRiskRewardScore", label: "Score rent/riesgo min", unit: "", step: 5 }, { key: "minReturnToVol3m", label: "Retorno 3M / volatilidad min", unit: "x", step: .1 }, { key: "minReturnToDrawdown3m", label: "Retorno 3M / drawdown min", unit: "x", step: .1 }] },
  { title: "Ratings proxy", fields: [{ key: "minAdProxyScore", label: "A/D proxy min", unit: "", step: 5, hint: "Proxy 0-100 de acumulacion/distribucion usando up/down volume, volumen relativo y cierre con volumen." }, { key: "minEpsGrowthProxyScore", label: "EPS/Growth proxy min", unit: "", step: 5, hint: "Proxy 0-100 de crecimiento/calidad con beneficios, ventas, margenes y ROE si el proveedor devuelve datos." }] },
  { title: "Cobertura de datos", fields: [{ key: "minDataCoverageScore", label: "Cobertura total min", unit: "", step: 5 }, { key: "minTechnicalCoverageScore", label: "Cobertura tecnica min", unit: "", step: 5 }, { key: "minFundamentalCoverageScore", label: "Cobertura fundamental min", unit: "", step: 5 }] },
  { title: "Calidad mínima", fields: [{ key: "minRsRating", label: "RS Global min", unit: "", step: 5 }, { key: "minWeinsteinScore", label: "Weinstein min", unit: "", step: 5 }, { key: "minMinerviniScore", label: "Minervini min", unit: "", step: 5 }, { key: "minMomentumScore", label: "Momentum score min", unit: "", step: 5 }, { key: "minRiskScore", label: "Risk score min", unit: "", step: 5 }, { key: "minVolumeScore", label: "Volume score min", unit: "", step: 5 }, { key: "minLiquidityScore", label: "Liquidity score min", unit: "", step: 5 }, { key: "minSectorScore", label: "Fuerza grupo min", unit: "", step: 5 }, { key: "minTotalScore", label: "Composite min", unit: "", step: 5 }] },
  { title: "Deterioro técnico", fields: [{ key: "minWeaknessScore", label: "Deterioro min", unit: "", step: 5 }] },
  { title: "IPO real", fields: [{ key: "maxIpoAgeMonths", label: "Edad IPO max", unit: "m", step: 6 }] },
];
const FILTER_FIELDS = FILTER_GROUPS.flatMap((group) => group.fields);
const DEFAULT_FIELD_RULES = Object.fromEntries(FILTER_FIELDS.map((field) => [field.key, true]));
const FILTER_FIELD_LAYERS = {
  minPrice: ["liquidity"],
  minMarketCap: ["liquidity"],
  minAvgVolume: ["liquidity"],
  minAvgTurnover: ["liquidity"],
  minLatestVolume: ["volumeSurge"],
  minLatestTurnover: ["volumeSurge"],
  minRelativeVolume: ["volumeSurge"],
  minVolumeSurgePct: ["volumeSurge"],
  minUpDownVolRatio: ["volumeSurge"],
  minVolumeEffectScore: ["volumeSurge"],
  minShortFloatPct: ["shortInterest"],
  maxShortFloatPct: ["shortInterest"],
  minPerf3m: ["momentum"],
  minPerf6m: ["momentum"],
  minPerf12m: ["momentum"],
  maxDistance20dHigh: ["proximity"],
  maxDistance50dHigh: ["proximity"],
  maxDistance52w: ["proximity"],
  maxDistanceATH: ["proximity"],
  maxHighsSpreadPct: ["proximity"],
  maxExtensionSma50: ["proximity"],
  minRiskRewardScore: ["riskReward"],
  minRsQualityScore: ["riskReward"],
  minAdProxyScore: ["volumeSurge"],
  minEpsGrowthProxyScore: ["score"],
  minWeaknessScore: ["score"],
  minReturnToVol3m: ["riskReward"],
  minReturnToDrawdown3m: ["riskReward"],
  maxDailyMove20dPct: ["volatility"],
  maxDailyRange20dPct: ["volatility"],
  maxRange63dPct: ["volatility"],
  maxVolatility63d: ["volatility"],
  maxDrawdown63d: ["volatility"],
  minDataCoverageScore: ["coverage"],
  minTechnicalCoverageScore: ["coverage"],
  minFundamentalCoverageScore: ["coverage"],
  minRsRating: ["momentum"],
  minWeinsteinScore: ["trend"],
  minMinerviniScore: ["trend"],
  minMomentumScore: ["momentum"],
  minRiskScore: ["proximity", "score"],
  minVolumeScore: ["score", "liquidity"],
  minLiquidityScore: ["liquidity"],
  minSectorScore: ["score"],
  minTotalScore: ["score"],
  maxIpoAgeMonths: ["ipo"],
};
const NEUTRAL_FIELD_VALUES = {
  minPrice: 0,
  minMarketCap: 0,
  minAvgVolume: 0,
  minAvgTurnover: 0,
  minLatestVolume: 0,
  minLatestTurnover: 0,
  minRelativeVolume: 0,
  minVolumeSurgePct: -999,
  minUpDownVolRatio: 0,
  minVolumeEffectScore: 0,
  minShortFloatPct: 0,
  maxShortFloatPct: 999,
  minPerf3m: -100,
  minPerf6m: -100,
  minPerf12m: -100,
  maxDistance20dHigh: 999,
  maxDistance50dHigh: 999,
  maxDistance52w: 999,
  maxDistanceATH: 999,
  maxHighsSpreadPct: 999,
  maxExtensionSma50: 999,
  minRiskRewardScore: 0,
  minRsQualityScore: 0,
  minAdProxyScore: 0,
  minEpsGrowthProxyScore: 0,
  minWeaknessScore: 0,
  minReturnToVol3m: -999,
  minReturnToDrawdown3m: -999,
  maxDailyMove20dPct: 999,
  maxDailyRange20dPct: 999,
  maxRange63dPct: 999,
  maxVolatility63d: 999,
  maxDrawdown63d: 999,
  minDataCoverageScore: 0,
  minTechnicalCoverageScore: 0,
  minFundamentalCoverageScore: 0,
  minRsRating: 0,
  minWeinsteinScore: 0,
  minMinerviniScore: 0,
  minMomentumScore: 0,
  minRiskScore: 0,
  minVolumeScore: 0,
  minLiquidityScore: 0,
  minSectorScore: 0,
  minTotalScore: 0,
  maxIpoAgeMonths: 999,
};
const DEFAULT_FILTER_LAYERS = { trend: true, momentum: true, proximity: true, volatility: true, score: true, liquidity: true, volumeSurge: false, shortInterest: false, riskReward: false, coverage: true, ipo: true };
const ALL_FILTER_LAYERS = { ...DEFAULT_FILTER_LAYERS, volumeSurge: true, riskReward: true };
const REGIME_LAYER = { label: "Régimen", detail: "salud de mercado", count: 1 };
const EXECUTION_LAYERS = [
  { key: "trend", label: "Trend", detail: "Stage / tendencia primaria", count: 3 },
  { key: "momentum", label: "Momentum", detail: "3M, 6M, 12M, RS", count: 5 },
  { key: "proximity", label: "Cercania", detail: "maximos y extension", count: 7 },
  { key: "volatility", label: "Volatilidad", detail: "movimiento y rango", count: 5 },
  { key: "score", label: "Scores", detail: "minimos composite", count: 6 },
  { key: "liquidity", label: "Liquidez", detail: "precio, cap, importe", count: 6 },
  { key: "volumeSurge", label: "Volumen+", detail: "actividad objetiva", count: 8 },
  { key: "shortInterest", label: "Short float", detail: "flota en corto", count: 2 },
  { key: "riskReward", label: "Rent/Riesgo", detail: "RS ajustado", count: 4 },
  { key: "coverage", label: "Cobertura", detail: "calidad minima de datos", count: 3 },
  { key: "ipo", label: "IPO", detail: "solo recientes reales", count: 2 },
];
const DEFAULT_VIEW_LAYERS = { country: true, theme: true, sector: true, industry: true, sectorStrength: true, ipo: true };
const VIEW_LAYERS = [
  { key: "country", label: "País", detail: "bolsa nacional" },
  { key: "theme", label: "Temática", detail: "clasificación operativa" },
  { key: "sector", label: "Sector", detail: "sector proveedor" },
  { key: "industry", label: "Subsector", detail: "industria proveedor" },
  { key: "sectorStrength", label: "Fuerza sector", detail: "fuerte / debil" },
  { key: "ipo", label: "IPO", detail: "categoria IPO" },
];
const BENCHMARK_SYMBOLS = ["SPY", "QQQ", "ACWI"];

const money = (n, currency = "") => Number.isFinite(n) ? `${n >= 100 ? n.toFixed(0) : n.toFixed(2)}${currency ? ` ${currency}` : ""}` : "-";
const cap = (n) => Number.isFinite(n) && n > 0 ? n >= 1000000000000 ? `${(n / 1000000000000).toFixed(2)}T` : n >= 1000000000 ? `${(n / 1000000000).toFixed(1)}B` : n >= 1000000 ? `${(n / 1000000).toFixed(0)}M` : `${n.toFixed(0)}` : "-";
const amount = (n, currency = "") => Number.isFinite(n) && n > 0 ? `${cap(n)}${currency ? ` ${currency}` : ""}` : "-";
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const clamp = (n, a = 0, b = 100) => Math.max(a, Math.min(b, n));
const searchText = (value = "") => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function InfoHint({ text, tone = "" }) {
  if (!text) return null;
  return <span className={`infoHint ${tone}`} tabIndex="0" aria-label={text}>
    <span>i</span>
    <em>{text}</em>
  </span>;
}
function marketName(code = "") { return MARKET_META[String(code || "").toUpperCase()]?.name || code || "Sin pais"; }
function marketExchange(code = "") { return MARKET_META[String(code || "").toUpperCase()]?.exchange || "Bolsa nacional"; }
const sma = (b, n, o = 0) => b.length >= n + o ? avg(b.slice(o, o + n).map((x) => x.close)) : null;
const perf = (b, n) => b.length > n && b[0].close && b[n].close ? ((b[0].close / b[n].close) - 1) * 100 : null;
const ratioLabel = (n) => Number.isFinite(n) ? `${n.toFixed(2)}x` : "-";
function hiLo(b, n) { const s = b.slice(0, Math.min(n, b.length)); return { hi: Math.max(...s.map((x) => x.high || x.close).filter(Number.isFinite)), lo: Math.min(...s.map((x) => x.low || x.close).filter(Number.isFinite)) }; }
function highValue(b, n) { return b.length ? hiLo(b, n).hi : null; }
function highDist(b, n) { if (b.length < 20) return null; const h = highValue(b, n); return h && b[0].close ? ((b[0].close / h) - 1) * 100 : null; }
function lowAdv(b, n) { if (b.length < 20) return null; const { lo } = hiLo(b, n); return lo && b[0].close ? ((b[0].close / lo) - 1) * 100 : null; }
function stdev(values = []) {
  const xs = values.filter(Number.isFinite);
  if (xs.length < 2) return null;
  const mean = avg(xs);
  return Math.sqrt(avg(xs.map((x) => (x - mean) ** 2)));
}
function dailyReturns(b, n = 63) {
  const out = [];
  for (let i = 0; i < Math.min(n, b.length - 1); i++) {
    const now = b[i]?.close;
    const prev = b[i + 1]?.close;
    if (Number.isFinite(now) && Number.isFinite(prev) && prev > 0) out.push((now / prev) - 1);
  }
  return out;
}
function annualizedVolatility(b, n = 63) {
  const sd = stdev(dailyReturns(b, n));
  return Number.isFinite(sd) ? sd * Math.sqrt(252) * 100 : null;
}
function downsideVolatility(b, n = 63) {
  const negatives = dailyReturns(b, n).map((x) => Math.min(0, x));
  const sd = stdev(negatives);
  return Number.isFinite(sd) ? sd * Math.sqrt(252) * 100 : null;
}
function maxDrawdown(b, n = 63) {
  const rows = b.slice(0, Math.min(n, b.length)).filter((x) => Number.isFinite(x.close)).reverse();
  if (rows.length < 2) return null;
  let peak = rows[0].close;
  let drawdown = 0;
  for (const row of rows) {
    peak = Math.max(peak, row.close);
    if (peak > 0) drawdown = Math.max(drawdown, ((peak - row.close) / peak) * 100);
  }
  return drawdown;
}
function maxDailyMovePct(b, n = 20) {
  const moves = dailyReturns(b, n).map((x) => Math.abs(x) * 100).filter(Number.isFinite);
  return moves.length ? Math.max(...moves) : null;
}
function dailyRangePcts(b, n = 20) {
  return b.slice(0, Math.min(n, b.length)).map((row) => {
    const high = firstFinite(row.high, row.close);
    const low = firstFinite(row.low, row.close);
    const close = firstFinite(row.close);
    return Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(close) && close > 0 ? ((high - low) / close) * 100 : null;
  }).filter(Number.isFinite);
}
function maxDailyRangePct(b, n = 20) {
  const ranges = dailyRangePcts(b, n);
  return ranges.length ? Math.max(...ranges) : null;
}
function avgDailyRangePct(b, n = 20) {
  const ranges = dailyRangePcts(b, n);
  return ranges.length ? avg(ranges) : null;
}
function priceRangePct(b, n = 63) {
  const rows = b.slice(0, Math.min(n, b.length)).filter((row) => Number.isFinite(row.high) && Number.isFinite(row.low) && row.low > 0);
  if (rows.length < Math.min(20, n)) return null;
  const high = Math.max(...rows.map((row) => row.high));
  const low = Math.min(...rows.map((row) => row.low));
  return low > 0 ? ((high / low) - 1) * 100 : null;
}
function riskAdjustedStats(b, perf3m) {
  const volatility63d = annualizedVolatility(b, 63);
  const downsideVolatility63d = downsideVolatility(b, 63);
  const maxDrawdown63d = maxDrawdown(b, 63);
  return {
    volatility63d,
    downsideVolatility63d,
    maxDrawdown63d,
    maxDailyMove20dPct: maxDailyMovePct(b, 20),
    maxDailyRange20dPct: maxDailyRangePct(b, 20),
    avgDailyRange20dPct: avgDailyRangePct(b, 20),
    range63dPct: priceRangePct(b, 63),
    returnToVol3m: Number.isFinite(perf3m) && volatility63d > 0 ? perf3m / volatility63d : null,
    returnToDownsideVol3m: Number.isFinite(perf3m) && downsideVolatility63d > 0 ? perf3m / downsideVolatility63d : null,
    returnToDrawdown3m: Number.isFinite(perf3m) && maxDrawdown63d > 0 ? perf3m / maxDrawdown63d : null,
  };
}
function monthsSince(d) { if (!d) return null; const x = new Date(d); if (Number.isNaN(x.getTime())) return null; const n = new Date(); return (n.getFullYear() - x.getFullYear()) * 12 + n.getMonth() - x.getMonth(); }
function isRecentIpoDate(d, maxMonths = 60) { const m = monthsSince(d); return Number.isFinite(m) && m >= 0 && m <= maxMonths; }
function ipoCat(d) {
  const m = monthsSince(d);
  if (m === null) return "Sin fecha IPO";
  if (m < 6) return "IPO reciente 0-6m";
  if (m < 18) return "IPO reciente 6-18m";
  if (m < 36) return "IPO reciente 18-36m";
  if (m <= 60) return "IPO reciente 3-5a";
  if (m < 120) return "Madura 5-10a";
  return "Madura +10a";
}
function normalizeWebsite(url = "") { if (!url) return ""; const value = /^https?:\/\//i.test(url) ? url : `https://${url}`; try { return new URL(value).toString(); } catch { return ""; } }
function domainFromUrl(url = "") { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
function initials(name = "", symbol = "") { return String(name || symbol).split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || String(symbol).slice(0, 2).toUpperCase() || "SE"; }
function theme(sector = "", industry = "") { const t = `${sector} ${industry}`.toLowerCase(); if (/semiconductor|chip|wafer|electronics|photon|optic|laser/.test(t)) return "Semis / fotonica"; if (/aerospace|defense|defence|military/.test(t)) return "Defensa / aeroespacial"; if (/\b(software|cloud|cyber|data|ai|artificial|applications?|infrastructure)\b/.test(t)) return "Software / IA"; if (/electrical|power|grid|energy|uranium|nuclear|utility/.test(t)) return "Energia / red"; if (/robot|automation|machinery|industrial|electrical equipment/.test(t)) return "Automatizacion"; if (/medical|diagnostic|device|biotech|health/.test(t)) return "Medtech / biotech"; if (/consumer|retail|apparel|restaurant|beverage|food|luxury|brand|e-commerce/.test(t)) return "Consumo / marca"; return sector || "General"; }
function actividadEs(name, sector, industry, themeName, summary) { const map = { "Semis / fotonica": "semiconductores / computacion", "Defensa / aeroespacial": "defensa / aeroespacial", "Software / IA": "software / IA", "Energia / red": "energia / red", Automatizacion: "automatizacion industrial", "Medtech / biotech": "salud / biotech", "Consumo / marca": "consumo / marca" }; const focus = map[themeName] || themeName || sector || "General"; const s = summary ? summary.split(".").slice(0, 1).join(".") : ""; return [name, sector || "sin sector", industry || "sin industria", focus, s].filter(Boolean).join(" · "); }
function shortBusiness(row = {}) {
  return [row.industry, row.sector, row.theme].filter((value, index, arr) => value && value !== "Sin industria" && value !== "Sin sector" && arr.indexOf(value) === index).slice(0, 3).join(" · ") || row.businessEs || row.exchange || "";
}
async function getJson(url) { const r = await fetch(url); const d = await r.json(); if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`); return d; }
function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function firstFinite(...values) {
  for (const value of values) {
    const n = finiteNumber(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function rsGlobalValue(row = {}) {
  return firstFinite(row.rsGlobalPct, row.rsRating);
}
function sortMetric(row = {}, key) {
  if (key === "rsGlobalPct" || key === "rsRating") return rsGlobalValue(row) ?? 0;
  return firstFinite(row[key]) ?? 0;
}
function gt(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value > threshold; }
function gte(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value >= threshold; }
function lt(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value < threshold; }
function lte(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value <= threshold; }
function between(value, min, max) { return gte(value, min) && lte(value, max); }
function udVol(b, n = 50) { let up = 0, down = 0; for (let i = 0; i < Math.min(n, b.length - 1); i++) { const v = b[i].volume || 0; if (b[i].close >= b[i + 1].close) up += v; else down += v; } return down ? up / down : null; }
function scoreWeinstein(r) { let s = 0; if (gt(r.price, r.sma150)) s += 18; if (gt(r.sma150, r.sma200)) s += 18; if (gt(r.sma200Slope, 0)) s += 18; if (gt(r.price, r.sma50)) s += 14; if (gt(r.sma50, r.sma150)) s += 14; if (gte(r.distance52w, -25)) s += 10; if (gt(r.perf6m, 0)) s += 8; return clamp(s); }
function scoreMinervini(r) { let s = 0; if (gt(r.price, r.sma150) && gt(r.price, r.sma200)) s += 14; if (gt(r.sma150, r.sma200)) s += 12; if (gt(r.sma200Slope, 0)) s += 12; if (gt(r.sma50, r.sma150) && gt(r.sma50, r.sma200)) s += 12; if (gt(r.price, r.sma50)) s += 10; if (gte(r.lowAdvance52w, 30)) s += 12; if (gte(r.distance52w, -25)) s += 8; if (gte(r.distance20d, -10)) s += 8; if (lte(r.highsSpreadPct, 12)) s += 6; if (gt(r.perf3m, 10)) s += 6; return clamp(s); }
function scoreMomentum(r) { let s = 0; if (gte(r.perf3m, 20)) s += 35; else if (gte(r.perf3m, 10)) s += 25; else if (gte(r.perf3m, 0)) s += 12; if (gte(r.perf6m, 40)) s += 35; else if (gte(r.perf6m, 20)) s += 25; else if (gte(r.perf6m, 5)) s += 12; if (gte(r.perf12m, 80)) s += 30; else if (gte(r.perf12m, 40)) s += 22; else if (gte(r.perf12m, 15)) s += 12; return clamp(s); }
function scoreRisk(r) { const e = r.extSma50; let s = 0; if (between(e, -3, 8)) s += 38; else if (between(e, -8, 15)) s += 30; else if (lte(e, 25)) s += 18; else if (lte(e, 35)) s += 8; if (gte(r.distance20d, -5)) s += 22; else if (gte(r.distance20d, -10)) s += 14; if (gte(r.distance50d, -10)) s += 18; else if (gte(r.distance50d, -18)) s += 10; if (gt(r.price, r.sma50)) s += 22; return clamp(s); }
function scoreRiskReward(r) {
  let s = 0;
  if (gte(r.returnToVol3m, 1.2)) s += 26;
  else if (gte(r.returnToVol3m, .8)) s += 20;
  else if (gte(r.returnToVol3m, .35)) s += 12;
  else if (gte(r.returnToVol3m, 0)) s += 4;
  if (gte(r.returnToDrawdown3m, 2.5)) s += 26;
  else if (gte(r.returnToDrawdown3m, 1.5)) s += 18;
  else if (gte(r.returnToDrawdown3m, .8)) s += 10;
  else if (gte(r.returnToDrawdown3m, 0)) s += 4;
  if (Number.isFinite(r.volatility63d)) {
    if (r.volatility63d <= 25) s += 18;
    else if (r.volatility63d <= 40) s += 12;
    else if (r.volatility63d <= 60) s += 6;
  }
  if (Number.isFinite(r.maxDrawdown63d)) {
    if (r.maxDrawdown63d <= 10) s += 20;
    else if (r.maxDrawdown63d <= 18) s += 14;
    else if (r.maxDrawdown63d <= 32) s += 7;
  }
  if (Number.isFinite(r.maxDailyMove20dPct)) {
    if (r.maxDailyMove20dPct <= 8) s += 8;
    else if (r.maxDailyMove20dPct <= 14) s += 4;
  }
  if (Number.isFinite(r.range63dPct)) {
    if (r.range63dPct <= 55) s += 6;
    else if (r.range63dPct <= 85) s += 3;
  }
  if (gt(r.perf3m, 0)) s += 10;
  return clamp(s);
}
function scoreRsQuality(r) {
  const rs = rsGlobalValue(r);
  if (!Number.isFinite(rs)) return null;
  let stability = 72;
  if (Number.isFinite(r.volatility63d)) {
    if (r.volatility63d <= 28) stability += 14;
    else if (r.volatility63d <= 45) stability += 7;
    else if (r.volatility63d <= 70) stability -= 3;
    else if (r.volatility63d <= 105) stability -= 10;
    else stability -= 17;
  }
  if (Number.isFinite(r.maxDrawdown63d)) {
    if (r.maxDrawdown63d <= 10) stability += 10;
    else if (r.maxDrawdown63d <= 18) stability += 4;
    else if (r.maxDrawdown63d <= 32) stability -= 4;
    else stability -= 12;
  }
  if (Number.isFinite(r.maxDailyMove20dPct)) {
    if (r.maxDailyMove20dPct <= 6) stability += 5;
    else if (r.maxDailyMove20dPct <= 10) stability += 2;
    else if (r.maxDailyMove20dPct > 28) stability -= 12;
    else if (r.maxDailyMove20dPct > 18) stability -= 6;
  }
  if (Number.isFinite(r.range63dPct)) {
    if (r.range63dPct <= 45) stability += 4;
    else if (r.range63dPct > 100) stability -= 8;
  }
  if (Number.isFinite(r.highsSpreadPct)) {
    if (r.highsSpreadPct <= 8) stability += 6;
    else if (r.highsSpreadPct > 22) stability -= 8;
  }
  if (Number.isFinite(r.extSma50) && r.extSma50 > 28) stability -= 8;
  const quality = clamp(rs * .62 + clamp(stability) * .28 + (Number.isFinite(r.riskRewardScore) ? r.riskRewardScore : 45) * .1);
  const speculationRiskScore = clamp(
    Math.max(0, (Number.isFinite(r.volatility63d) ? r.volatility63d : 35) - 35) * .62 +
    Math.max(0, Number.isFinite(r.maxDrawdown63d) ? r.maxDrawdown63d : 12) * .85 +
    Math.max(0, (Number.isFinite(r.maxDailyMove20dPct) ? r.maxDailyMove20dPct : 8) - 10) * 1.35 +
    Math.max(0, (Number.isFinite(r.range63dPct) ? r.range63dPct : 45) - 80) * .22 +
    Math.max(0, (Number.isFinite(r.extSma50) ? r.extSma50 : 0) - 18) * .85 -
    (Number.isFinite(r.liquidityScore) ? r.liquidityScore : 45) * .12
  );
  return {
    rsQualityScore: quality,
    rsStabilityScore: clamp(stability),
    speculationRiskScore,
    rsQualityLabel: rs >= 80 && quality >= 72 ? "RS limpio" : rs >= 80 && speculationRiskScore >= 55 ? "RS volátil" : rs >= 75 && quality >= 62 ? "RS eficiente" : speculationRiskScore >= 70 ? "Momentum especulativo" : rs >= 60 ? "RS constructivo" : "RS débil",
  };
}
function scoreWeakness(r = {}) {
  let s = 0;
  const reasons = [];
  const rs = rsGlobalValue(r) ?? 50;
  if (rs < 30) { s += 18; reasons.push("RS muy bajo"); }
  else if (rs < 45) { s += 13; reasons.push("RS bajo"); }
  else if (rs < 55) s += 6;
  if (Number.isFinite(r.price) && Number.isFinite(r.sma50) && r.price < r.sma50) { s += 12; reasons.push("bajo SMA50"); }
  if (Number.isFinite(r.price) && Number.isFinite(r.sma200) && r.price < r.sma200) { s += 18; reasons.push("bajo SMA200"); }
  if (Number.isFinite(r.sma200Slope) && r.sma200Slope < 0) { s += 12; reasons.push("SMA200 cae"); }
  if (Number.isFinite(r.sma50) && Number.isFinite(r.sma200) && r.sma50 < r.sma200) s += 7;
  if (Number.isFinite(r.perf3m) && r.perf3m < 0) { s += 8; reasons.push("3M negativo"); }
  if (Number.isFinite(r.perf6m) && r.perf6m < 0) s += 8;
  if (Number.isFinite(r.perf12m) && r.perf12m < 0) s += 8;
  if (Number.isFinite(r.distance52w)) {
    if (r.distance52w < -45) { s += 12; reasons.push("muy lejos de máximos"); }
    else if (r.distance52w < -30) { s += 8; reasons.push("lejos de máximos"); }
    else if (r.distance52w < -20) s += 4;
  }
  if (Number.isFinite(r.distance20d) && r.distance20d < -12) s += 5;
  if (Number.isFinite(r.maxDrawdown63d)) {
    if (r.maxDrawdown63d > 40) { s += 10; reasons.push("drawdown alto"); }
    else if (r.maxDrawdown63d > 28) s += 7;
  }
  if (Number.isFinite(r.upDownVolRatio)) {
    if (r.upDownVolRatio < .7) { s += 9; reasons.push("volumen vendedor"); }
    else if (r.upDownVolRatio < .9) s += 5;
  }
  if (r.upVolume === false && Number.isFinite(r.relativeVolume) && r.relativeVolume >= 1.15) { s += 7; reasons.push("caída con volumen"); }
  if (Number.isFinite(r.riskScore) && r.riskScore < 35) s += 7;
  if (Number.isFinite(r.extSma50) && r.extSma50 < -12) s += 5;
  if (Number.isFinite(r.speculationRiskScore) && r.speculationRiskScore >= 70) s += 4;
  const weaknessScore = clamp(s);
  return {
    weaknessScore,
    weaknessLabel: weaknessScore >= 78 ? "Deterioro severo" : weaknessScore >= 65 ? "Deterioro alto" : weaknessScore >= 50 ? "Deterioro visible" : weaknessScore >= 35 ? "Debilidad mixta" : "Sin deterioro claro",
    weaknessReasons: reasons.length ? reasons.slice(0, 4) : ["Sin evidencia fuerte"],
  };
}
function scoreVolumeEffect(r) {
  let s = 0;
  if (gte(r.latestTurnover, 25000000)) s += 24;
  else if (gte(r.latestTurnover, 10000000)) s += 18;
  else if (gte(r.latestTurnover, 3000000)) s += 10;
  else if (gte(r.latestTurnover, 1000000)) s += 5;
  if (gte(r.latestVolume, 2000000)) s += 15;
  else if (gte(r.latestVolume, 500000)) s += 11;
  else if (gte(r.latestVolume, 150000)) s += 6;
  if (gte(r.relativeVolume, 2.2)) s += 22;
  else if (gte(r.relativeVolume, 1.6)) s += 16;
  else if (gte(r.relativeVolume, 1.2)) s += 9;
  else if (gte(r.relativeVolume, 1)) s += 4;
  if (gte(r.volumeSurgePct, 80)) s += 17;
  else if (gte(r.volumeSurgePct, 35)) s += 12;
  else if (gte(r.volumeSurgePct, 15)) s += 6;
  if (gte(r.upDownVolRatio, 1.8)) s += 16;
  else if (gte(r.upDownVolRatio, 1.25)) s += 11;
  else if (gte(r.upDownVolRatio, 1)) s += 5;
  if (r.upVolume === true && gte(r.relativeVolume, 1.1)) s += 6;
  return clamp(s);
}
function volumeEvidence(r = {}) {
  const parts = [];
  if (gte(r.latestTurnover, 10000000)) parts.push("importe sesion >=10M");
  else if (gte(r.latestTurnover, 3000000)) parts.push("importe sesion >=3M");
  if (gte(r.relativeVolume, 1.6)) parts.push("relVol >=1.6x");
  else if (gte(r.relativeVolume, 1.2)) parts.push("relVol >=1.2x");
  if (gte(r.volumeSurgePct, 35)) parts.push("5d +35%");
  else if (gte(r.volumeSurgePct, 15)) parts.push("5d +15%");
  if (gte(r.upDownVolRatio, 1.25)) parts.push("up/down >=1.25x");
  return parts.length ? parts.slice(0, 4).join(" · ") : "sin efecto objetivo";
}
function scoreVolume(r) {
  let s = 0;
  if (gte(r.avgTurnover, 25000000)) s += 22;
  else if (gte(r.avgTurnover, 10000000)) s += 16;
  else if (gte(r.avgTurnover, 3000000)) s += 9;
  if (gte(r.avgVolume, 1000000)) s += 22;
  else if (gte(r.avgVolume, 300000)) s += 15;
  else if (gte(r.avgVolume, 100000)) s += 8;
  if (gte(r.upDownVolRatio, 1.5)) s += 20;
  else if (gte(r.upDownVolRatio, 1.1)) s += 14;
  else if (gte(r.upDownVolRatio, .9)) s += 7;
  if (gte(r.relativeVolume, 1.8)) s += 14;
  else if (gte(r.relativeVolume, 1.3)) s += 9;
  else if (gte(r.relativeVolume, 1.05)) s += 4;
  if (gte(r.volumeSurgePct, 50)) s += 12;
  else if (gte(r.volumeSurgePct, 25)) s += 8;
  else if (gte(r.volumeSurgePct, 10)) s += 4;
  s += (r.volumeEffectScore || 0) * .1;
  return clamp(s);
}
function scoreLiq(r) {
  let s = 0;
  if (gte(r.marketCap, 1000000000)) s += 35;
  else if (gte(r.marketCap, 300000000)) s += 24;
  else if (gte(r.marketCap, 150000000)) s += 12;
  if (gte(r.avgTurnover, 25000000)) s += 30;
  else if (gte(r.avgTurnover, 10000000)) s += 22;
  else if (gte(r.avgTurnover, 3000000)) s += 12;
  if (gte(r.avgVolume, 1000000)) s += 22;
  else if (gte(r.avgVolume, 300000)) s += 15;
  else if (gte(r.avgVolume, 100000)) s += 7;
  if (gte(r.price, 5)) s += 13;
  else if (gte(r.price, 3)) s += 7;
  return clamp(s);
}
function scoreIpo(r) {
  const m = monthsSince(r.ipoDate);
  if (!Number.isFinite(m) || m > 60) return 0;
  const age = m < 6 ? 25 : m < 18 ? 30 : m < 36 ? 24 : 16;
  const high = gte(r.distanceATH, -15) || gte(r.distance52w, -15) ? 25 : gte(r.distance52w, -25) ? 15 : 5;
  const liq = gte(r.avgVolume, 1000000) ? 15 : gte(r.avgVolume, 300000) ? 8 : 0;
  const st = gt(r.price, r.sma50) && gt(r.perf3m, 10) ? 20 : 8;
  return clamp(age + high + liq + st + (r.sectorScore ? r.sectorScore * .15 : 5));
}
function scoreSetupQuality(r) {
  let s = 0;
  if (isStage2(r)) s += 28;
  else if (gt(r.price, r.sma200) && gte(r.sma200Slope, 0)) s += 18;
  else if (gt(r.price, r.sma200)) s += 10;
  if (gt(r.price, r.sma50)) s += 10;
  if (gt(r.sma50, r.sma150)) s += 8;
  if (gte(r.distance52w, -5)) s += 16;
  else if (gte(r.distance52w, -15)) s += 11;
  else if (gte(r.distance52w, -25)) s += 6;
  if (gte(r.distance20d, -5)) s += 10;
  else if (gte(r.distance20d, -10)) s += 6;
  if (Number.isFinite(r.extSma50)) {
    if (r.extSma50 >= -4 && r.extSma50 <= 9) s += 16;
    else if (r.extSma50 <= 18) s += 11;
    else if (r.extSma50 <= 28) s += 4;
  }
  if (lte(r.highsSpreadPct, 8)) s += 7;
  else if (lte(r.highsSpreadPct, 15)) s += 4;
  return clamp(s);
}
function scoreDemandQuality(r) {
  let s = 0;
  const rs = firstFinite(r.rsGlobalPct, r.rsRating) ?? 50;
  if (rs >= 90) s += 34;
  else if (rs >= 80) s += 29;
  else if (rs >= 70) s += 22;
  else if (rs >= 55) s += 13;
  s += (r.volumeScore || 0) * .28;
  s += (r.volumeEffectScore || 0) * .12;
  s += (r.liquidityScore || 0) * .14;
  if (gte(r.upDownVolRatio, 1.8)) s += 18;
  else if (gte(r.upDownVolRatio, 1.3)) s += 13;
  else if (gte(r.upDownVolRatio, 1)) s += 7;
  if (gte(r.relativeVolume, 1.5)) s += 8;
  else if (gte(r.relativeVolume, 1.2)) s += 5;
  if (gte(r.volumeSurgePct, 35)) s += 6;
  else if (gte(r.volumeSurgePct, 15)) s += 3;
  if (gte(r.avgVolume, 1000000)) s += 6;
  else if (gte(r.avgVolume, 300000)) s += 3;
  return clamp(s);
}
function scoreGrowthQuality(metrics = {}) {
  const values = ["revenueGrowth", "earningsGrowth", "grossMargin", "operatingMargin", "profitMargin", "roe", "roa", "debtToEquity", "currentRatio"].map((k) => metrics[k]);
  if (!values.some(Number.isFinite)) return 45;
  let s = 28;
  const revenue = metrics.revenueGrowth;
  const earnings = metrics.earningsGrowth;
  const gross = metrics.grossMargin;
  const operating = metrics.operatingMargin;
  const profit = metrics.profitMargin;
  const roe = metrics.roe;
  const roa = metrics.roa;
  const debt = metrics.debtToEquity;
  const current = metrics.currentRatio;
  if (gte(revenue, 30)) s += 19; else if (gte(revenue, 15)) s += 15; else if (gte(revenue, 5)) s += 9; else if (gte(revenue, 0)) s += 4; else if (Number.isFinite(revenue)) s -= 6;
  if (gte(earnings, 35)) s += 19; else if (gte(earnings, 15)) s += 14; else if (gte(earnings, 0)) s += 7; else if (Number.isFinite(earnings)) s -= 8;
  if (gte(gross, 55)) s += 10; else if (gte(gross, 35)) s += 6; else if (lt(gross, 20)) s -= 4;
  if (gte(operating, 25)) s += 9; else if (gte(operating, 12)) s += 6; else if (lt(operating, 0)) s -= 5;
  if (gte(profit, 20)) s += 8; else if (gte(profit, 8)) s += 5; else if (lt(profit, 0)) s -= 7;
  if (gte(roe, 25)) s += 8; else if (gte(roe, 12)) s += 5;
  if (gte(roa, 10)) s += 5; else if (gte(roa, 5)) s += 3;
  if (Number.isFinite(debt)) {
    if (debt <= 60) s += 5;
    else if (debt > 180) s -= 6;
  }
  if (Number.isFinite(current)) {
    if (current >= 1.4) s += 4;
    else if (current < .9) s -= 4;
  }
  return clamp(s);
}
function scoreEpsGrowthProxy(metrics = {}) {
  const revenue = metrics.revenueGrowth;
  const earnings = metrics.earningsGrowth;
  const operating = metrics.operatingMargin;
  const profit = metrics.profitMargin;
  const roe = metrics.roe;
  const roa = metrics.roa;
  const debt = metrics.debtToEquity;
  const current = metrics.currentRatio;
  if (![revenue, earnings, operating, profit, roe, roa].some(Number.isFinite)) return null;
  let s = 35;
  if (gte(earnings, 50)) s += 24; else if (gte(earnings, 25)) s += 18; else if (gte(earnings, 10)) s += 11; else if (gte(earnings, 0)) s += 5; else if (Number.isFinite(earnings)) s -= 12;
  if (gte(revenue, 30)) s += 18; else if (gte(revenue, 15)) s += 13; else if (gte(revenue, 5)) s += 7; else if (gte(revenue, 0)) s += 3; else if (Number.isFinite(revenue)) s -= 8;
  if (gte(operating, 25)) s += 10; else if (gte(operating, 12)) s += 6; else if (lt(operating, 0)) s -= 7;
  if (gte(profit, 18)) s += 8; else if (gte(profit, 8)) s += 5; else if (lt(profit, 0)) s -= 8;
  if (gte(roe, 22)) s += 8; else if (gte(roe, 12)) s += 5;
  if (gte(roa, 10)) s += 5; else if (gte(roa, 5)) s += 3;
  if (Number.isFinite(debt)) {
    if (debt <= 60) s += 4;
    else if (debt > 180) s -= 5;
  }
  if (Number.isFinite(current) && current < .9) s -= 4;
  return Math.round(clamp(s));
}
function scoreAdProxy(r = {}) {
  let s = 45;
  if (gte(r.upDownVolRatio, 2)) s += 20;
  else if (gte(r.upDownVolRatio, 1.5)) s += 15;
  else if (gte(r.upDownVolRatio, 1.15)) s += 9;
  else if (Number.isFinite(r.upDownVolRatio) && r.upDownVolRatio < .75) s -= 15;
  else if (Number.isFinite(r.upDownVolRatio) && r.upDownVolRatio < .95) s -= 8;
  if (r.upVolume === true && gte(r.relativeVolume, 1.1)) s += 10;
  if (r.upVolume === false && gte(r.relativeVolume, 1.2)) s -= 10;
  if (gte(r.volumeSurgePct, 50) && gte(r.perf3m, 0)) s += 10;
  else if (gte(r.volumeSurgePct, 20) && gte(r.perf3m, 0)) s += 6;
  if (gte(r.relativeVolume, 1.5) && gte(r.distance20d, -8)) s += 8;
  if (gte(r.distance52w, -15)) s += 7;
  else if (Number.isFinite(r.distance52w) && r.distance52w < -35) s -= 7;
  if (gt(r.price, r.sma50)) s += 5;
  else if (Number.isFinite(r.price) && Number.isFinite(r.sma50)) s -= 5;
  if (gt(r.maxDrawdown63d, 32)) s -= 6;
  return Math.round(clamp(s));
}
function compositeLabel(score) {
  if (score >= 85) return "Elite";
  if (score >= 75) return "Leader";
  if (score >= 65) return "Accionable";
  if (score >= 55) return "Watchlist";
  return "Revisar";
}
function compositeNarrative(r) {
  const reasons = [];
  const risks = [];
  const rsGlobal = rsGlobalValue(r) ?? 0;
  if (isStage2(r)) reasons.push("Stage 2 confirmado");
  if (rsGlobal >= 85) reasons.push("RS global líder");
  else if (rsGlobal >= 80) reasons.push("RS líder");
  else if (rsGlobal >= 65) reasons.push("RS positivo");
  if ((r.rsQualityScore || 0) >= 72) reasons.push("RS calidad alta");
  if ((r.rsCountryPct || 0) >= 80) reasons.push("RS país fuerte");
  if ((r.rsSectorPct || 0) >= 80) reasons.push("RS sectorial fuerte");
  if ((r.sectorScore || 0) >= 70) reasons.push("Grupo fuerte");
  if ((r.growthScore || 0) >= 70) reasons.push("Crecimiento/calidad superior");
  if ((r.riskRewardScore || 0) >= 70) reasons.push("Rentabilidad/riesgo eficiente");
  if (gte(r.distance52w, -10)) reasons.push("Cerca de máximos");
  if ((r.demandScore || 0) >= 70) reasons.push("Demanda y liquidez sanas");
  if (gt(r.extSma50, 22)) risks.push("Extendida sobre SMA50");
  if ((r.riskScore || 0) < 45) risks.push("Riesgo técnico alto");
  if (rsGlobal < 40) risks.push("RS débil");
  if ((r.speculationRiskScore || 0) >= 70) risks.push("Volatilidad especulativa");
  else if ((r.speculationRiskScore || 0) >= 55) risks.push("RS volátil");
  if (gt(r.maxDrawdown63d, 30)) risks.push("Drawdown reciente elevado");
  if (gt(r.volatility63d, 70)) risks.push("Volatilidad elevada");
  if ((r.volumeScore || 0) < 35) risks.push("Volumen limitado");
  if ((r.growthScore || 0) < 45) risks.push("Fundamentales insuficientes/débiles");
  if (lt(r.distance52w, -25)) risks.push("Lejos de máximos");
  if (!reasons.length) reasons.push("Candidato exploratorio");
  if (!risks.length) risks.push("Sin alerta principal");
  return { reasons: reasons.slice(0, 4), risks: risks.slice(0, 3) };
}
function benchmarkSymbolForRow(row = {}) {
  const text = `${row.theme || ""} ${row.sector || ""} ${row.industry || ""}`.toLowerCase();
  if (/\b(software|semis?|semiconductor|semiconductors|fotonica|ia|ai|cloud|cyber|chip|chips|technology)\b/.test(text)) return "QQQ";
  if (row.country && row.country !== "US") return "ACWI";
  return "SPY";
}
function scoreRelativeStrength(row, benchmarkBars = []) {
  const bench3 = perf(benchmarkBars, 63);
  const bench6 = perf(benchmarkBars, 126);
  const bench12 = perf(benchmarkBars, 252);
  const rs3m = Number.isFinite(row.perf3m) && Number.isFinite(bench3) ? row.perf3m - bench3 : null;
  const rs6m = Number.isFinite(row.perf6m) && Number.isFinite(bench6) ? row.perf6m - bench6 : null;
  const rs12m = Number.isFinite(row.perf12m) && Number.isFinite(bench12) ? row.perf12m - bench12 : null;
  const nearHighBonus = gte(row.distance52w, -5) ? 8 : gte(row.distance52w, -15) ? 4 : gte(row.distance52w, -25) ? 1 : -6;
  const trendBonus = (gt(row.price, row.sma50) ? 4 : -4) + (gt(row.sma200Slope, 0) ? 4 : -2);
  const raw = 50 + (rs3m || 0) * .9 + (rs6m || 0) * .45 + (rs12m || 0) * .22 + nearHighBonus + trendBonus;
  return {
    rs3m,
    rs6m,
    rs12m,
    benchmarkPerf3m: bench3,
    benchmarkPerf6m: bench6,
    benchmarkPerf12m: bench12,
    rsRating: Math.round(clamp(raw, 1, 99)),
  };
}

function usefulValue(value) {
  if (Number.isFinite(value)) return value !== 0;
  return value !== undefined && value !== null && value !== "";
}

function coveragePct(values = []) {
  if (!values.length) return 0;
  return Math.round((values.filter(usefulValue).length / values.length) * 100);
}

function dataCoverageForRow(row = {}, profile = {}) {
  const gm = profile.growthMetrics || row.growthMetrics || {};
  const technicalCoverageScore = coveragePct([
    Number.isFinite(row.chartBarsCount) && row.chartBarsCount >= 180 ? row.chartBarsCount : null,
    row.price,
    row.sma50,
    row.sma150,
    row.sma200,
    row.sma200Slope,
    row.distance20d,
    row.distance50d,
    row.distance52w,
    row.distanceATH,
    row.highsSpreadPct,
    row.perf3m,
    row.perf6m,
    row.perf12m,
    row.extSma50,
    row.avgVolume,
    row.avgTurnover,
    row.latestVolume,
    row.latestTurnover,
    row.relativeVolume,
    row.volumeSurgePct,
    row.upDownVolRatio,
    row.volumeEffectScore,
    row.shortPercentOfFloat,
    row.maxDailyMove20dPct,
    row.maxDailyRange20dPct,
    row.range63dPct,
    row.volatility63d,
    row.maxDrawdown63d,
    row.rsRating,
    row.rs3m,
    row.rs6m,
    row.rs12m,
  ]);
  const profileCoverageScore = coveragePct([
    row.companyName && row.companyName !== row.symbol ? row.companyName : "",
    row.exchange && row.exchange !== "-" ? row.exchange : "",
    row.country,
    row.currency,
    row.marketCap,
    row.sector && row.sector !== "Sin sector" ? row.sector : "",
    row.industry && row.industry !== "Sin industria" ? row.industry : "",
    row.website,
    profile.businessSummary,
    row.ipoDate,
  ]);
  const fundamentalCoverageScore = coveragePct([
    gm.revenueGrowth,
    gm.earningsGrowth,
    gm.grossMargin,
    gm.operatingMargin,
    gm.profitMargin,
    gm.ebitdaMargin,
    gm.roe,
    gm.roa,
    gm.debtToEquity,
    gm.currentRatio,
    gm.institutionalOwnership,
    gm.insiderOwnership,
    gm.shortPercentOfFloat,
  ]);
  const dataCoverageScore = Math.round(technicalCoverageScore * .68 + profileCoverageScore * .22 + fundamentalCoverageScore * .1);
  const issues = [];
  if (technicalCoverageScore < 70) issues.push("técnico parcial");
  if (profileCoverageScore < 55) issues.push("perfil parcial");
  if (fundamentalCoverageScore < 35) issues.push("fundamental parcial");
  return {
    dataCoverageScore,
    technicalCoverageScore,
    profileCoverageScore,
    fundamentalCoverageScore,
    dataCoverageLabel: dataCoverageScore >= 80 ? "alta" : dataCoverageScore >= 60 ? "util" : dataCoverageScore >= 40 ? "parcial" : "baja",
    dataCoverageIssues: issues,
  };
}

function rsRawComposite(row = {}) {
  const p3 = Number.isFinite(row.perf3m) ? row.perf3m : 0;
  const p6 = Number.isFinite(row.perf6m) ? row.perf6m : 0;
  const p12 = Number.isFinite(row.perf12m) ? row.perf12m : 0;
  const rs3 = Number.isFinite(row.rs3m) ? row.rs3m : 0;
  const rs6 = Number.isFinite(row.rs6m) ? row.rs6m : 0;
  const rs12 = Number.isFinite(row.rs12m) ? row.rs12m : 0;
  const nearHigh = Number.isFinite(row.distance52w) ? row.distance52w : -50;
  const drawdown = Number.isFinite(row.maxDrawdown63d) ? row.maxDrawdown63d : 25;
  return p3 * .38 + p6 * .24 + p12 * .14 + rs3 * .34 + rs6 * .18 + rs12 * .08 + nearHigh * .16 - drawdown * .12;
}

function percentileFromSorted(value, sorted = []) {
  if (!Number.isFinite(value) || !sorted.length) return null;
  if (sorted.length === 1) return 50;
  let belowOrEqual = 0;
  for (const item of sorted) {
    if (item <= value) belowOrEqual += 1;
    else break;
  }
  return Math.round(clamp((belowOrEqual / sorted.length) * 99, 1, 99));
}

function addScopedPercentile(rows, scopeFn, valueKey, outKey, sampleKey, minSample = 3) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = scopeFn(row) || "Sin grupo";
    if (!groups.has(key)) groups.set(key, []);
    if (Number.isFinite(row[valueKey])) groups.get(key).push(row[valueKey]);
  });
  groups.forEach((values, key) => groups.set(key, values.sort((a, b) => a - b)));
  return rows.map((row) => {
    const key = scopeFn(row) || "Sin grupo";
    const sorted = groups.get(key) || [];
    const sample = sorted.length;
    return {
      ...row,
      [sampleKey]: sample,
      [outKey]: sample >= minSample ? percentileFromSorted(row[valueKey], sorted) : null,
    };
  });
}

function enrichRelativePercentiles(list = []) {
  if (!list.length) return list;
  const withRaw = list.map((row) => ({ ...row, rsCompositeRaw: rsRawComposite(row) }));
  const sortedGlobal = withRaw.map((row) => row.rsCompositeRaw).filter(Number.isFinite).sort((a, b) => a - b);
  let rows = withRaw.map((row) => ({
    ...row,
    rsGlobalSample: sortedGlobal.length,
    rsGlobalPct: percentileFromSorted(row.rsCompositeRaw, sortedGlobal),
  }));
  rows = addScopedPercentile(rows, (row) => row.country || countryCode(row.symbol), "rsCompositeRaw", "rsCountryPct", "rsCountrySample", 3);
  rows = addScopedPercentile(rows, (row) => row.theme || row.sector, "rsCompositeRaw", "rsSectorPct", "rsSectorSample", 3);
  return rows;
}

function regimeRejectReason(row, marketHealth, enabled, set = {}) {
  if (set.setupMode === "weakness" || !enabled || !marketHealth?.marketScore) return null;
  const s = marketHealth.marketScore;
  if (s >= 75) return null;
  if (s >= 55) return row.totalScore >= 60 && row.riskScore >= 45 && row.weinsteinScore >= 55 ? null : rejectReason("regime", "Régimen exige composite >= 60, risk >= 45 y Weinstein >= 55");
  if (s >= 40) return row.totalScore >= 72 && row.riskScore >= 55 && row.weinsteinScore >= 65 && row.minerviniScore >= 55 ? null : rejectReason("regime", "Régimen exige composite >= 72, risk >= 55, Weinstein >= 65 y Minervini >= 55");
  return row.totalScore >= 82 && row.riskScore >= 65 && row.weinsteinScore >= 75 && row.minerviniScore >= 65 ? null : rejectReason("regime", "Régimen exige composite >= 82, risk >= 65, Weinstein >= 75 y Minervini >= 65");
}
function regimeFiltered(list, marketHealth, enabled, set = {}) { return list.filter((r) => !regimeRejectReason(r, marketHealth, enabled, set)); }
function sortRowsForMode(list, set = {}, key = "") {
  const sortKey = key || (set.setupMode === "weakness" ? "weaknessScore" : "totalScore");
  return [...list].sort((a, b) => sortMetric(b, sortKey) - sortMetric(a, sortKey));
}
function ipoRadarUniverseRows() {
  return safeRead(STORAGE_KEYS.ipoRadar, [])
    .filter((item) => item?.includeInScreener && item?.symbol && item.status !== "passed")
    .map((item) => {
      const symbol = String(item.symbol || "").trim().toUpperCase();
      return { symbol, name: item.companyName || symbol, country: item.country || countryCode(symbol), source: "ipo-radar" };
    });
}
function uid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function compactChartPreview(chartPreview = []) {
  if (!Array.isArray(chartPreview)) return [];
  return chartPreview.slice(0, 48).map((bar) => ({
    date: bar.date,
    close: bar.close,
    sma50: bar.sma50,
    sma200: bar.sma200,
    volume: bar.volume,
  })).filter((bar) => bar.date && Number.isFinite(bar.close));
}
function compactRowForSession(row = null) {
  if (!row || typeof row !== "object") return row;
  return {
    ...row,
    chartPreview: compactChartPreview(row.chartPreview),
  };
}
function compactRowsForSession(rows = []) {
  return Array.isArray(rows) ? rows.map(compactRowForSession) : [];
}
function failureKind(reason = "") {
  const text = String(reason).toLowerCase();
  if (text.includes("historico insuficiente")) return { key: "history", title: "Histórico insuficiente", fix: "Reducir requisito de histórico, ampliar proveedor de precios o excluir tickers muy recientes del screener técnico largo." };
  if (text.includes("http 404") || text.includes("no found") || text.includes("not found") || text.includes("sin historico")) return { key: "symbol", title: "Ticker sin histórico", fix: "Revisar sufijo Yahoo/mercado, ticker delisted o mapping TradingView/Yahoo." };
  if (text.includes("429") || text.includes("too many") || text.includes("rate")) return { key: "rate", title: "Rate limit proveedor", fix: "Añadir cache persistente/Supabase y espaciar llamadas por lotes." };
  if (text.includes("provider") || text.includes("proveedor") || text.includes("http")) return { key: "provider", title: "Proveedor no disponible", fix: "Reintentar, cachear respuesta o cubrir con proveedor secundario." };
  return { key: "other", title: "Otros datos incompletos", fix: "Revisar caso manual y normalizar símbolo/perfil." };
}
function favoriteFromRow(row, marketHealth) {
  const methodologySnapshot = compactMethodologySnapshot(row);
  return {
    id: uid(),
    symbol: row.symbol,
    companyName: row.companyName || row.symbol,
    country: row.country,
    sector: row.sector,
    industry: row.industry,
    addedAt: new Date().toISOString(),
    entryPrice: Number.isFinite(row.price) ? row.price : null,
    lastPrice: Number.isFinite(row.price) ? row.price : null,
    lastDate: row.lastDate || null,
    source: "screener",
    notes: "",
    marketScore: marketHealth?.marketScore ?? null,
    marketRegime: marketHealth?.regime?.label || "sin dato",
    snapshot: {
      ...methodologySnapshot,
      totalScore: row.totalScore,
      compositeScore: row.compositeScore,
      compositeLabel: row.compositeLabel,
      setupQualityScore: row.setupQualityScore,
      demandScore: row.demandScore,
      growthScore: row.growthScore,
      adProxyScore: row.adProxyScore,
      epsGrowthProxyScore: row.epsGrowthProxyScore,
      ratingModel: row.ratingModel,
      weinsteinScore: row.weinsteinScore,
      minerviniScore: row.minerviniScore,
      momentumScore: row.momentumScore,
      riskScore: row.riskScore,
      riskRewardScore: row.riskRewardScore,
      volumeScore: row.volumeScore,
      volumeEffectScore: row.volumeEffectScore,
      volumeEvidence: row.volumeEvidence,
      avgVolume: row.avgVolume,
      latestVolume: row.latestVolume,
      avgTurnover: row.avgTurnover,
      latestTurnover: row.latestTurnover,
      relativeVolume: row.relativeVolume,
      volumeSurgePct: row.volumeSurgePct,
      upDownVolRatio: row.upDownVolRatio,
      shortPercentOfFloat: row.shortPercentOfFloat,
      sharesPercentSharesOut: row.sharesPercentSharesOut,
      shortRatio: row.shortRatio,
      sharesShort: row.sharesShort,
      floatShares: row.floatShares,
      liquidityScore: row.liquidityScore,
      rsRating: row.rsRating,
      rsGlobalPct: row.rsGlobalPct,
      rsCountryPct: row.rsCountryPct,
      rsSectorPct: row.rsSectorPct,
      rsQualityScore: row.rsQualityScore,
      rsStabilityScore: row.rsStabilityScore,
      speculationRiskScore: row.speculationRiskScore,
      rsQualityLabel: row.rsQualityLabel,
      dataCoverageScore: row.dataCoverageScore,
      technicalCoverageScore: row.technicalCoverageScore,
      fundamentalCoverageScore: row.fundamentalCoverageScore,
      dataCoverageLabel: row.dataCoverageLabel,
      dataCoverageIssues: row.dataCoverageIssues || [],
      weaknessScore: row.weaknessScore,
      weaknessLabel: row.weaknessLabel,
      weaknessReasons: row.weaknessReasons || [],
      rsGlobalSample: row.rsGlobalSample,
      rsCountrySample: row.rsCountrySample,
      rsSectorSample: row.rsSectorSample,
      rs3m: row.rs3m,
      rs6m: row.rs6m,
      rs12m: row.rs12m,
      benchmarkSymbol: row.benchmarkSymbol,
      sectorScore: row.sectorScore,
      stageState: methodologySnapshot.stageState,
      stageLabel: methodologySnapshot.stageLabel,
      riskState: methodologySnapshot.riskState,
      dataQualityState: methodologySnapshot.dataQualityState,
      ipoScore: row.ipoScore,
      compositeReasons: row.compositeReasons || [],
      compositeRisks: row.compositeRisks || [],
      perf3m: row.perf3m,
      perf6m: row.perf6m,
      perf12m: row.perf12m,
      volatility63d: row.volatility63d,
      downsideVolatility63d: row.downsideVolatility63d,
      maxDrawdown63d: row.maxDrawdown63d,
      returnToVol3m: row.returnToVol3m,
      returnToDrawdown3m: row.returnToDrawdown3m,
      price: row.price,
      sma50: row.sma50,
      sma150: row.sma150,
      sma200: row.sma200,
      sma200Slope: row.sma200Slope,
      distance20d: row.distance20d,
      distance52w: row.distance52w,
      extSma50: row.extSma50,
      highsSpreadPct: row.highsSpreadPct,
      theme: row.theme,
      businessEs: row.businessEs,
    },
  };
}

function chartPreviewBars(b, limit = 96) {
  const asc = [...b].filter((x) => Number.isFinite(x.close)).reverse();
  const enriched = asc.map((bar, i) => {
    const windowAvg = (n) => i >= n - 1 ? avg(asc.slice(i - n + 1, i + 1).map((x) => x.close)) : null;
    return {
      date: bar.date,
      open: Number.isFinite(bar.open) ? bar.open : bar.close,
      high: Number.isFinite(bar.high) ? bar.high : bar.close,
      low: Number.isFinite(bar.low) ? bar.low : bar.close,
      close: bar.close,
      volume: Number.isFinite(bar.volume) ? bar.volume : 0,
      sma50: windowAvg(50),
      sma200: windowAvg(200),
    };
  });
  return enriched.slice(-limit);
}

function chartPreviewForRange(bars = [], range = "1A") {
  return bars.slice(-Math.min(chartRangeBars(range), bars.length));
}

function stageLabel(r) {
  if (!r || !Number.isFinite(r.price) || !Number.isFinite(r.sma200)) return "Sin dato";
  if (gt(r.price, r.sma50) && gt(r.sma50, r.sma150) && gt(r.sma150, r.sma200) && gt(r.sma200Slope, 0)) return "Stage 2";
  if (lt(r.price, r.sma200) && lt(r.sma200Slope, 0)) return "Stage 4";
  if (gt(r.price, r.sma200)) return "Base / transicion";
  return "Debil / mixta";
}

function isStage2(row) {
  if (![row.price, row.sma50, row.sma150, row.sma200].every(Number.isFinite)) return false;
  return gt(row.price, row.sma50) && gt(row.price, row.sma150) && gt(row.price, row.sma200) && gt(row.sma50, row.sma150) && gt(row.sma150, row.sma200) && gt(row.sma200Slope, 0);
}

function setupModeLabel(value) {
  return SETUP_MODES.find(([key]) => key === value)?.[1] || "Exploratorio";
}

function applyRelativeStrength(row, benchmarks = {}) {
  const benchmarkSymbol = benchmarkSymbolForRow(row);
  const rs = scoreRelativeStrength(row, benchmarks[benchmarkSymbol]?.bars || []);
  return { ...row, ...rs, benchmarkSymbol };
}

function buildResearchRow(symbol, chart, profile = {}, requireLongHistory = false, benchmarks = {}) {
  const b = chart.bars || [];
  if (b.length < (requireLongHistory ? 180 : 20)) throw new Error("Historico insuficiente");
  const providerPrice = firstFinite(chart.meta?.regularMarketPrice, chart.meta?.regularMarketPreviousClose, chart.meta?.previousClose);
  const latestClose = firstFinite(b[0]?.close);
  const price = firstFinite(providerPrice, latestClose);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Precio no disponible");
  const calcBars = b.map((bar, index) => {
    if (index !== 0) return bar;
    const high = firstFinite(bar.high, bar.close, price);
    const low = firstFinite(bar.low, bar.close, price);
    return {
      ...bar,
      close: price,
      high: Number.isFinite(high) ? Math.max(high, price) : price,
      low: Number.isFinite(low) ? Math.min(low, price) : price,
    };
  });
  const s50 = sma(calcBars, 50), s150 = sma(calcBars, 150), s200 = sma(calcBars, 200), s200p = sma(calcBars, 200, 30);
  const h20 = highValue(calcBars, 20), h65 = highValue(calcBars, 65);
  const avgVol20 = avg(b.slice(0, 20).map((x) => x.volume || 0));
  const avgVol5 = avg(b.slice(0, 5).map((x) => x.volume || 0));
  const prevVol20 = avg(b.slice(5, 25).map((x) => x.volume || 0));
  const latestVolume = b[0]?.volume || 0;
  const perf3m = perf(calcBars, 63);
  const perf6m = perf(calcBars, 126);
  const perf12m = perf(calcBars, 252);
  const riskAdjusted = riskAdjustedStats(calcBars, perf3m);
  const row = {
    symbol,
    companyName: profile.name || chart.meta?.shortName || symbol,
    country: countryCode(symbol),
    exchange: profile.exchange || chart.meta?.exchangeName || "-",
    sector: profile.sector || "Sin sector",
    industry: profile.industry || "Sin industria",
    currency: profile.currency || chart.meta?.currency || "",
    ipoDate: profile.ipoDate || "",
    ipoAgeMonths: monthsSince(profile.ipoDate || ""),
    website: normalizeWebsite(profile.website || ""),
    growthMetrics: profile.growthMetrics || {},
    shortPercentOfFloat: Number.isFinite(profile.shortPercentOfFloat) ? profile.shortPercentOfFloat : profile.growthMetrics?.shortPercentOfFloat,
    sharesPercentSharesOut: Number.isFinite(profile.sharesPercentSharesOut) ? profile.sharesPercentSharesOut : profile.growthMetrics?.sharesPercentSharesOut,
    shortRatio: Number.isFinite(profile.shortRatio) ? profile.shortRatio : profile.growthMetrics?.shortRatio,
    sharesShort: Number.isFinite(profile.sharesShort) ? profile.sharesShort : profile.growthMetrics?.sharesShort,
    floatShares: Number.isFinite(profile.floatShares) ? profile.floatShares : profile.growthMetrics?.floatShares,
    price,
    priceSource: Number.isFinite(providerPrice) ? "proveedor" : "ultimo cierre",
    chartProvider: chart.meta?.dataProvider || "Yahoo Finance",
    chartFallbackReason: chart.meta?.fallbackReason || "",
    chartBarsCount: b.length,
    marketCap: firstFinite(profile.marketCap),
    avgVolume: avgVol20,
    avgVolume5: avgVol5,
    prevAvgVolume20: prevVol20,
    latestVolume,
    avgTurnover: Number.isFinite(avgVol20) && Number.isFinite(price) ? avgVol20 * price : null,
    latestTurnover: Number.isFinite(latestVolume) && Number.isFinite(price) ? latestVolume * price : null,
    relativeVolume: avgVol20 ? latestVolume / avgVol20 : null,
    volumeSurgePct: prevVol20 ? ((avgVol5 / prevVol20) - 1) * 100 : null,
    upVolume: calcBars[1] ? calcBars[0].close >= calcBars[1].close : null,
    sma50: s50,
    sma150: s150,
    sma200: s200,
    sma200Slope: s200 && s200p ? ((s200 / s200p) - 1) * 100 : null,
    distance20d: highDist(calcBars, 20),
    distance50d: highDist(calcBars, 50),
    distance52w: highDist(calcBars, 252),
    distanceATH: highDist(calcBars, calcBars.length),
    highsSpreadPct: h20 && h65 ? Math.abs((h20 / h65) - 1) * 100 : null,
    lowAdvance52w: lowAdv(calcBars, 252),
    perf3m,
    perf6m,
    perf12m,
    ...riskAdjusted,
    extSma50: s50 ? ((price / s50) - 1) * 100 : null,
    upDownVolRatio: udVol(calcBars, 50),
    lastDate: b[0]?.date,
    chartPreview: chartPreviewBars(calcBars),
  };
  row.theme = theme(row.sector, row.industry);
  row.logoDomain = domainFromUrl(row.website);
  row.businessEs = actividadEs(row.companyName, row.sector, row.industry, row.theme, profile.businessSummary);
  row.weinsteinScore = scoreWeinstein(row);
  row.minerviniScore = scoreMinervini(row);
  row.momentumScore = scoreMomentum(row);
  row.riskScore = scoreRisk(row);
  row.riskRewardScore = scoreRiskReward(row);
  row.volumeEffectScore = scoreVolumeEffect(row);
  row.volumeEvidence = volumeEvidence(row);
  row.adProxyScore = scoreAdProxy(row);
  row.epsGrowthProxyScore = scoreEpsGrowthProxy(row.growthMetrics || {});
  row.volumeScore = scoreVolume(row);
  row.liquidityScore = scoreLiq(row);
  row.ipoCategory = ipoCat(row.ipoDate);
  const withRs = applyRelativeStrength(row, benchmarks);
  const withQuality = { ...withRs, ...scoreRsQuality(withRs) };
  const withCoverage = { ...withQuality, ...dataCoverageForRow(withQuality, profile) };
  return { ...withCoverage, ...scoreWeakness(withCoverage) };
}

const REJECTION_META = {
  provider: { label: "Datos proveedor", stage: "Datos" },
  liquidity: { label: "Liquidez", stage: "Puerta" },
  coverage: { label: "Cobertura", stage: "Puerta" },
  volumeSurge: { label: "Volumen objetivo", stage: "Opcional" },
  shortInterest: { label: "Short float", stage: "Opcional" },
  riskReward: { label: "Rentabilidad/riesgo", stage: "Opcional" },
  volatility: { label: "Volatilidad/rango", stage: "Puerta" },
  trend: { label: "Tendencia", stage: "Puerta" },
  proximity: { label: "Cercania a maximos", stage: "Puerta" },
  momentum: { label: "Momentum", stage: "Puerta" },
  score: { label: "Calidad minima", stage: "Score" },
  ipo: { label: "IPO real", stage: "Opcional" },
  mode: { label: "Setup", stage: "Modo" },
  weakness: { label: "Deterioro", stage: "Modo" },
  regime: { label: "Regimen de mercado", stage: "Contexto" },
  post: { label: "Post filtro", stage: "Score" },
};

function rejectReason(key, detail, field = "") {
  const meta = REJECTION_META[key] || { label: key || "Filtro", stage: "Filtro" };
  return { key, label: meta.label, stage: meta.stage, detail, field };
}

function below(value, minimum) {
  return Number.isFinite(minimum) && Number.isFinite(value) && value < minimum;
}

function above(value, maximum) {
  return Number.isFinite(maximum) && Number.isFinite(value) && value > maximum;
}

function filterRejectReason(row, set) {
  const mode = set.setupMode || "leader";
  const minBars = mode === "ipoRecent" ? 20 : 180;
  const minReturnToVol3m = Number.isFinite(set.minReturnToVol3m) ? set.minReturnToVol3m : -999;
  const minReturnToDrawdown3m = Number.isFinite(set.minReturnToDrawdown3m) ? set.minReturnToDrawdown3m : -999;
  const maxDailyMove20dPct = Number.isFinite(set.maxDailyMove20dPct) ? set.maxDailyMove20dPct : 999;
  const maxDailyRange20dPct = Number.isFinite(set.maxDailyRange20dPct) ? set.maxDailyRange20dPct : 999;
  const maxRange63dPct = Number.isFinite(set.maxRange63dPct) ? set.maxRange63dPct : 999;
  const maxVolatility63d = Number.isFinite(set.maxVolatility63d) ? set.maxVolatility63d : 999;
  const maxDrawdown63d = Number.isFinite(set.maxDrawdown63d) ? set.maxDrawdown63d : 999;
  const minRsQualityScore = Number.isFinite(set.minRsQualityScore) ? set.minRsQualityScore : 0;
  const minWeaknessScore = Number.isFinite(set.minWeaknessScore) ? set.minWeaknessScore : 0;
  const minDataCoverageScore = Number.isFinite(set.minDataCoverageScore) ? set.minDataCoverageScore : 0;
  const minTechnicalCoverageScore = Number.isFinite(set.minTechnicalCoverageScore) ? set.minTechnicalCoverageScore : 0;
  const minFundamentalCoverageScore = Number.isFinite(set.minFundamentalCoverageScore) ? set.minFundamentalCoverageScore : 0;
  const minVolumeSurgePct = Number.isFinite(set.minVolumeSurgePct) ? set.minVolumeSurgePct : -999;
  const minShortFloatPct = Number.isFinite(set.minShortFloatPct) ? set.minShortFloatPct : 0;
  const maxShortFloatPct = Number.isFinite(set.maxShortFloatPct) ? set.maxShortFloatPct : 999;
  const minAdProxyScore = Number.isFinite(set.minAdProxyScore) ? set.minAdProxyScore : 0;
  const minEpsGrowthProxyScore = Number.isFinite(set.minEpsGrowthProxyScore) ? set.minEpsGrowthProxyScore : 0;
  if (!Number.isFinite(row.price) || row.price <= 0) return rejectReason("provider", "Precio no disponible", "price");
  if (!Number.isFinite(row.chartBarsCount) || row.chartBarsCount < minBars) return rejectReason("provider", `Historico insuficiente: ${Number.isFinite(row.chartBarsCount) ? row.chartBarsCount : 0}/${minBars} sesiones`, "chartBarsCount");
  if ((set.minPrice || 0) > 0 && lt(row.price, set.minPrice)) return rejectReason("liquidity", `Precio ${money(row.price, row.currency)} por debajo de ${money(set.minPrice, row.currency)}`, "minPrice");
  if ((set.minMarketCap || 0) > 0 && (!Number.isFinite(row.marketCap) || row.marketCap <= 0 || row.marketCap < set.minMarketCap)) return rejectReason("liquidity", `Capitalizacion ${cap(row.marketCap)} por debajo de ${cap(set.minMarketCap)}`, "minMarketCap");
  if ((set.minAvgVolume || 0) > 0 && (!Number.isFinite(row.avgVolume) || row.avgVolume < set.minAvgVolume)) return rejectReason("liquidity", `Volumen medio ${cap(row.avgVolume)} por debajo de ${cap(set.minAvgVolume)}`, "minAvgVolume");
  if ((set.minAvgTurnover || 0) > 0 && (!Number.isFinite(row.avgTurnover) || row.avgTurnover < set.minAvgTurnover)) return rejectReason("liquidity", `Importe medio ${amount(row.avgTurnover, row.currency)} por debajo de ${amount(set.minAvgTurnover, row.currency)}`, "minAvgTurnover");
  if (minDataCoverageScore > 0 && (!Number.isFinite(row.dataCoverageScore) || row.dataCoverageScore < minDataCoverageScore)) return rejectReason("coverage", `Cobertura total ${row.dataCoverageScore?.toFixed?.(0) || "sin dato"} < ${minDataCoverageScore}`, "minDataCoverageScore");
  if (minTechnicalCoverageScore > 0 && (!Number.isFinite(row.technicalCoverageScore) || row.technicalCoverageScore < minTechnicalCoverageScore)) return rejectReason("coverage", `Cobertura tecnica ${row.technicalCoverageScore?.toFixed?.(0) || "sin dato"} < ${minTechnicalCoverageScore}`, "minTechnicalCoverageScore");
  if (minFundamentalCoverageScore > 0 && (!Number.isFinite(row.fundamentalCoverageScore) || row.fundamentalCoverageScore < minFundamentalCoverageScore)) return rejectReason("coverage", `Cobertura fundamental ${row.fundamentalCoverageScore?.toFixed?.(0) || "sin dato"} < ${minFundamentalCoverageScore}`, "minFundamentalCoverageScore");
  if ((set.minLatestVolume || 0) > 0 && (!Number.isFinite(row.latestVolume) || row.latestVolume < set.minLatestVolume)) return rejectReason("volumeSurge", `Volumen sesion ${cap(row.latestVolume)} < ${cap(set.minLatestVolume)}`, "minLatestVolume");
  if ((set.minLatestTurnover || 0) > 0 && (!Number.isFinite(row.latestTurnover) || row.latestTurnover < set.minLatestTurnover)) return rejectReason("volumeSurge", `Importe sesion ${amount(row.latestTurnover, row.currency)} < ${amount(set.minLatestTurnover, row.currency)}`, "minLatestTurnover");
  if ((set.minRelativeVolume || 0) > 0 && (!Number.isFinite(row.relativeVolume) || row.relativeVolume < set.minRelativeVolume)) return rejectReason("volumeSurge", `Volumen relativo ${ratioLabel(row.relativeVolume)} < ${ratioLabel(set.minRelativeVolume)}`, "minRelativeVolume");
  if (minVolumeSurgePct > -999 && (!Number.isFinite(row.volumeSurgePct) || row.volumeSurgePct < minVolumeSurgePct)) return rejectReason("volumeSurge", `Volumen 5d ${pct(row.volumeSurgePct)} < ${pct(minVolumeSurgePct)}`, "minVolumeSurgePct");
  if ((set.minUpDownVolRatio || 0) > 0 && (!Number.isFinite(row.upDownVolRatio) || row.upDownVolRatio < set.minUpDownVolRatio)) return rejectReason("volumeSurge", `Up/Down volume ${ratioLabel(row.upDownVolRatio)} < ${ratioLabel(set.minUpDownVolRatio)}`, "minUpDownVolRatio");
  if ((set.minVolumeEffectScore || 0) > 0 && (!Number.isFinite(row.volumeEffectScore) || row.volumeEffectScore < set.minVolumeEffectScore)) return rejectReason("volumeSurge", `Volume Effect ${row.volumeEffectScore?.toFixed?.(0) || "sin dato"} < ${set.minVolumeEffectScore}`, "minVolumeEffectScore");
  if (minAdProxyScore > 0 && (!Number.isFinite(row.adProxyScore) || row.adProxyScore < minAdProxyScore)) return rejectReason("volumeSurge", `A/D proxy ${row.adProxyScore?.toFixed?.(0) || "sin dato"} < ${minAdProxyScore}`, "minAdProxyScore");
  if (minEpsGrowthProxyScore > 0 && (!Number.isFinite(row.epsGrowthProxyScore) || row.epsGrowthProxyScore < minEpsGrowthProxyScore)) return rejectReason("score", `EPS/Growth proxy ${row.epsGrowthProxyScore?.toFixed?.(0) || "sin dato"} < ${minEpsGrowthProxyScore}`, "minEpsGrowthProxyScore");
  if (minShortFloatPct > 0 && (!Number.isFinite(row.shortPercentOfFloat) || row.shortPercentOfFloat < minShortFloatPct)) return rejectReason("shortInterest", `Short float ${pct(row.shortPercentOfFloat)} < ${pct(minShortFloatPct)}`, "minShortFloatPct");
  if (maxShortFloatPct < 999 && (!Number.isFinite(row.shortPercentOfFloat) || row.shortPercentOfFloat > maxShortFloatPct)) return rejectReason("shortInterest", `Short float ${pct(row.shortPercentOfFloat)} > ${pct(maxShortFloatPct)}`, "maxShortFloatPct");
  if (set.requireUpVolume && row.upVolume !== true) return rejectReason("volumeSurge", "La ultima vela no cumple volumen en vela alcista", "requireUpVolume");
  if (mode === "weakness") {
    const weak = Number.isFinite(row.weaknessScore) ? row.weaknessScore : scoreWeakness(row).weaknessScore;
    return weak >= Math.max(35, minWeaknessScore) ? null : rejectReason("weakness", `Deterioro ${weak?.toFixed?.(0) || "sin dato"} < ${Math.max(35, minWeaknessScore)}`, "minWeaknessScore");
  }
  if ((set.minRiskRewardScore || 0) > 0 && (!Number.isFinite(row.riskRewardScore) || row.riskRewardScore < set.minRiskRewardScore)) return rejectReason("riskReward", `Score rent/riesgo ${row.riskRewardScore?.toFixed?.(0) || "sin dato"} < ${set.minRiskRewardScore}`, "minRiskRewardScore");
  if (minRsQualityScore > 0 && (!Number.isFinite(row.rsQualityScore) || row.rsQualityScore < minRsQualityScore)) return rejectReason("riskReward", `RS Quality ${row.rsQualityScore?.toFixed?.(0) || "sin dato"} < ${minRsQualityScore}`, "minRsQualityScore");
  if (minReturnToVol3m > -999 && (!Number.isFinite(row.returnToVol3m) || row.returnToVol3m < minReturnToVol3m)) return rejectReason("riskReward", `Retorno/vol ${ratioLabel(row.returnToVol3m)} < ${ratioLabel(minReturnToVol3m)}`, "minReturnToVol3m");
  if (minReturnToDrawdown3m > -999 && (!Number.isFinite(row.returnToDrawdown3m) || row.returnToDrawdown3m < minReturnToDrawdown3m)) return rejectReason("riskReward", `Retorno/drawdown ${ratioLabel(row.returnToDrawdown3m)} < ${ratioLabel(minReturnToDrawdown3m)}`, "minReturnToDrawdown3m");
  if (maxDailyMove20dPct < 999 && (!Number.isFinite(row.maxDailyMove20dPct) || row.maxDailyMove20dPct > maxDailyMove20dPct)) return rejectReason("volatility", `Movimiento diario max 20d ${pct(row.maxDailyMove20dPct)} > ${pct(maxDailyMove20dPct)}`, "maxDailyMove20dPct");
  if (maxDailyRange20dPct < 999 && (!Number.isFinite(row.maxDailyRange20dPct) || row.maxDailyRange20dPct > maxDailyRange20dPct)) return rejectReason("volatility", `Rango intradia max 20d ${pct(row.maxDailyRange20dPct)} > ${pct(maxDailyRange20dPct)}`, "maxDailyRange20dPct");
  if (maxRange63dPct < 999 && (!Number.isFinite(row.range63dPct) || row.range63dPct > maxRange63dPct)) return rejectReason("volatility", `Rango 63d ${pct(row.range63dPct)} > ${pct(maxRange63dPct)}`, "maxRange63dPct");
  if (maxVolatility63d < 999 && (!Number.isFinite(row.volatility63d) || row.volatility63d > maxVolatility63d)) return rejectReason("volatility", `Volatilidad ${pct(row.volatility63d)} > ${pct(maxVolatility63d)}`, "maxVolatility63d");
  if (maxDrawdown63d < 999 && (!Number.isFinite(row.maxDrawdown63d) || row.maxDrawdown63d > maxDrawdown63d)) return rejectReason("volatility", `Drawdown ${pct(row.maxDrawdown63d)} > ${pct(maxDrawdown63d)}`, "maxDrawdown63d");
  if (set.requireStage2 && !isStage2(row)) return rejectReason("trend", "No cumple Stage 2 completo: precio y medias 50/150/200 alineadas con SMA200 ascendente", "requireStage2");
  if (set.requireSma200Up && !gt(row.sma200Slope, 0)) return rejectReason("trend", `Pendiente SMA200 ${pct(row.sma200Slope)} no es positiva`, "requireSma200Up");
  if (set.requirePriceAboveSma50 && !gt(row.price, row.sma50)) return rejectReason("trend", "Precio no esta por encima de SMA50", "requirePriceAboveSma50");
  if (!set.requireStage2 && !(gt(row.price, row.sma200) || gte(row.perf3m, set.minPerf3m))) return rejectReason("trend", "Sin Stage 2 estricto necesita precio sobre SMA200 o momentum 3M suficiente", "requireStage2");
  if ((set.maxDistance20dHigh ?? 999) < 999 && (!Number.isFinite(row.distance20d) || row.distance20d < -set.maxDistance20dHigh)) return rejectReason("proximity", `Distancia 20d ${pct(row.distance20d)} supera caida maxima ${pct(set.maxDistance20dHigh)}`, "maxDistance20dHigh");
  if ((set.maxDistance50dHigh ?? 999) < 999 && (!Number.isFinite(row.distance50d) || row.distance50d < -set.maxDistance50dHigh)) return rejectReason("proximity", `Distancia 50d ${pct(row.distance50d)} supera caida maxima ${pct(set.maxDistance50dHigh)}`, "maxDistance50dHigh");
  if ((set.maxDistance52w ?? 999) < 999 && (!Number.isFinite(row.distance52w) || row.distance52w < -set.maxDistance52w)) return rejectReason("proximity", `Distancia 52w ${pct(row.distance52w)} supera caida maxima ${pct(set.maxDistance52w)}`, "maxDistance52w");
  if ((set.maxDistanceATH ?? 999) < 999 && (!Number.isFinite(row.distanceATH) || row.distanceATH < -set.maxDistanceATH)) return rejectReason("proximity", `Distancia ATH ${pct(row.distanceATH)} supera caida maxima ${pct(set.maxDistanceATH)}`, "maxDistanceATH");
  if ((set.maxHighsSpreadPct ?? 999) < 999 && (!Number.isFinite(row.highsSpreadPct) || row.highsSpreadPct > set.maxHighsSpreadPct)) return rejectReason("proximity", `Highs spread ${pct(row.highsSpreadPct)} > ${pct(set.maxHighsSpreadPct)}`, "maxHighsSpreadPct");
  if ((set.minPerf3m ?? -100) > -100 && (!Number.isFinite(row.perf3m) || row.perf3m < set.minPerf3m)) return rejectReason("momentum", `Perf 3M ${pct(row.perf3m)} < ${pct(set.minPerf3m)}`, "minPerf3m");
  if ((set.minPerf6m ?? -100) > -100 && (!Number.isFinite(row.perf6m) || row.perf6m < set.minPerf6m)) return rejectReason("momentum", `Perf 6M ${pct(row.perf6m)} < ${pct(set.minPerf6m)}`, "minPerf6m");
  if ((set.minPerf12m ?? -100) > -100 && (!Number.isFinite(row.perf12m) || row.perf12m < set.minPerf12m)) return rejectReason("momentum", `Perf 12M ${pct(row.perf12m)} < ${pct(set.minPerf12m)}`, "minPerf12m");
  if ((set.maxExtensionSma50 ?? 999) < 999 && (!Number.isFinite(row.extSma50) || row.extSma50 > set.maxExtensionSma50)) return rejectReason("proximity", `Extension SMA50 ${pct(row.extSma50)} > ${pct(set.maxExtensionSma50)}`, "maxExtensionSma50");
  if (below(row.weinsteinScore, set.minWeinsteinScore)) return rejectReason("trend", `Weinstein ${row.weinsteinScore?.toFixed?.(0)} < ${set.minWeinsteinScore}`, "minWeinsteinScore");
  if (below(row.minerviniScore, set.minMinerviniScore)) return rejectReason("trend", `Minervini ${row.minerviniScore?.toFixed?.(0)} < ${set.minMinerviniScore}`, "minMinerviniScore");
  if (below(row.momentumScore, set.minMomentumScore)) return rejectReason("score", `Momentum score ${row.momentumScore?.toFixed?.(0)} < ${set.minMomentumScore}`, "minMomentumScore");
  if (below(row.riskScore, set.minRiskScore)) return rejectReason("score", `Risk score ${row.riskScore?.toFixed?.(0)} < ${set.minRiskScore}`, "minRiskScore");
  if (below(row.volumeScore, set.minVolumeScore)) return rejectReason("score", `Volume score ${row.volumeScore?.toFixed?.(0)} < ${set.minVolumeScore}`, "minVolumeScore");
  if (below(row.liquidityScore, set.minLiquidityScore)) return rejectReason("score", `Liquidity score ${row.liquidityScore?.toFixed?.(0)} < ${set.minLiquidityScore}`, "minLiquidityScore");
  const rsPrimary = firstFinite(row.rsGlobalPct, row.rsRating);
  if ((set.minRsRating || 0) > 0 && (!Number.isFinite(rsPrimary) || rsPrimary < (set.minRsRating || 0))) return rejectReason("momentum", `RS Global ${Number.isFinite(rsPrimary) ? rsPrimary.toFixed(0) : "sin dato"} < ${set.minRsRating || 0}`, "minRsRating");
  if (set.requireRecentIpo && !isRecentIpoDate(row.ipoDate, set.maxIpoAgeMonths || 60)) return rejectReason("ipo", `IPO no confirmada dentro de ${set.maxIpoAgeMonths || 60} meses`, "requireRecentIpo");
  if (mode === "nearPivot" && !(gte(row.distance20d, -set.maxDistance20dHigh) && lte(row.highsSpreadPct, set.maxHighsSpreadPct) && lte(row.extSma50, Math.min(set.maxExtensionSma50, 18)))) return rejectReason("mode", "No encaja en Near Pivot", "setupMode");
  if (mode === "pullback" && !(gt(row.price, row.sma200) && between(row.extSma50, -4, 9) && gte(row.distance52w, -30) && gte(row.perf6m, Math.max(8, set.minPerf6m * 0.7)))) return rejectReason("mode", "No encaja en Pullback SMA50", "setupMode");
  if (mode === "early" && !(gt(row.price, row.sma200) && gte(row.distance52w, -35) && gte(row.perf3m, set.minPerf3m) && lte(row.extSma50, set.maxExtensionSma50))) return rejectReason("mode", "No encaja en Etapa 2 temprana", "setupMode");
  if (mode === "ipoRecent" && !(isRecentIpoDate(row.ipoDate, set.maxIpoAgeMonths || 60) && gte(row.distance52w, -35) && lte(row.extSma50, set.maxExtensionSma50) && gte(row.momentumScore, set.minMomentumScore))) return rejectReason("ipo", "No encaja en IPO reciente real", "setupMode");
  if (mode === "extended" && !(between(row.extSma50, 12, set.maxExtensionSma50) && gte(row.momentumScore, Math.max(65, set.minMomentumScore)))) return rejectReason("mode", "No encaja en Extendida fuerte", "setupMode");
  return null;
}

function passesFilter(row, set) {
  return !filterRejectReason(row, set);
}

function splitByFilter(rows, set) {
  const passed = [];
  const rejections = [];
  rows.forEach((row) => {
    const reason = filterRejectReason(row, set);
    if (reason) rejections.push({ symbol: row.symbol, ...reason });
    else passed.push(row);
  });
  return { passed, rejections };
}

function applyPostFilters(list, set) {
  return list.filter((row) => !postFilterRejectReason(row, set));
}

function postFilterRejectReason(row, set) {
  if (set.setupMode === "weakness") return (row.weaknessScore || 0) >= (set.minWeaknessScore || 0) ? null : rejectReason("weakness", `Deterioro ${(row.weaknessScore || 0).toFixed(0)} < ${set.minWeaknessScore || 0}`, "minWeaknessScore");
  if ((set.minSectorScore || 0) > 0 && (!Number.isFinite(row.sectorScore) || row.sectorScore < set.minSectorScore)) return rejectReason("post", `Fuerza grupo ${row.sectorScore?.toFixed?.(0) || "sin dato"} < ${set.minSectorScore || 0}`, "minSectorScore");
  if ((set.minTotalScore || 0) > 0 && (!Number.isFinite(row.totalScore) || row.totalScore < set.minTotalScore)) return rejectReason("post", `Composite ${row.totalScore?.toFixed?.(0) || "sin dato"} < ${set.minTotalScore || 0}`, "minTotalScore");
  if ((set.minRsQualityScore || 0) > 0 && (!Number.isFinite(row.rsQualityScore) || row.rsQualityScore < set.minRsQualityScore)) return rejectReason("post", `RS Quality ${row.rsQualityScore?.toFixed?.(0) || "sin dato"} < ${set.minRsQualityScore || 0}`, "minRsQualityScore");
  return null;
}

async function analyze(symbol, set, benchmarks = {}) {
  const result = await analyzeCandidate(symbol, set, benchmarks);
  return result.row;
}

async function analyzeRawCandidate(symbol, set, benchmarks = {}) {
  const [chart, profile] = await Promise.all([
    getJson(`/api/chart?symbol=${encodeURIComponent(symbol)}`),
    getJson(`/api/profile?symbol=${encodeURIComponent(symbol)}`).catch(() => ({})),
  ]);
  return buildResearchRow(symbol, chart, profile, set.setupMode !== "ipoRecent", benchmarks);
}

async function analyzeCandidate(symbol, set, benchmarks = {}) {
  const row = await analyzeRawCandidate(symbol, set, benchmarks);
  const reason = filterRejectReason(row, set);
  if (reason) return { row: null, rejection: { symbol, ...reason } };
  return { row, rejection: null };
}

function summarizeRejections(items = []) {
  const map = new Map();
  items.forEach((item) => {
    const key = item.key || "provider";
    const meta = REJECTION_META[key] || {};
    const bucket = map.get(key) || { key, label: item.label || meta.label || key, stage: item.stage || meta.stage || "Filtro", count: 0, examples: [] };
    bucket.count += 1;
    if (bucket.examples.length < 4) bucket.examples.push({ symbol: item.symbol, detail: item.detail || item.reason || "Sin detalle" });
    map.set(key, bucket);
  });
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function scanDiagnosticsSummary({ symbols = [], base = [], filterRejections = [], providerErrors = [], regimeRejections = [], postRejections = [], passedBeforeContext = 0, finalRows = [] }) {
  const providerItems = providerErrors.map((x) => ({ key: "provider", label: "Datos proveedor", stage: "Datos", symbol: x.symbol, detail: x.reason || "Proveedor no disponible" }));
  const all = [...filterRejections, ...providerItems, ...regimeRejections, ...postRejections];
  return {
    analyzed: symbols.length,
    universeTotal: base.length,
    candidatesBeforeContext: passedBeforeContext,
    finalCount: finalRows.length,
    hardRejected: filterRejections.length,
    providerRejected: providerItems.length,
    regimeRejected: regimeRejections.length,
    postRejected: postRejections.length,
    blocks: summarizeRejections(all),
  };
}

function sectorize(list) {
  const groups = {};
  for (const r of list) (groups[r.theme] ??= []).push(r);
  const sectorScores = {};
  Object.entries(groups).forEach(([k, a]) => {
    const avg3 = avg(a.map((x) => x.perf3m || 0));
    const avg6 = avg(a.map((x) => x.perf6m || 0));
    const leaders = a.filter((x) => x.weinsteinScore >= 80 || x.minerviniScore >= 80).length;
    sectorScores[k] = clamp(clamp(a.length * 10, 0, 25) + clamp(avg3, 0, 20) + clamp(avg6 / 2, 0, 20) + clamp(leaders * 7, 0, 15) + (/Semis|fotonica|Defensa|Software|Energia|Automatizacion/.test(k) ? 20 : 10));
  });
  return enrichRelativePercentiles(list).map((r) => {
    const sectorScore = sectorScores[r.theme] || 40;
    const ipoScore = scoreIpo({ ...r, sectorScore });
    const setupQualityScore = scoreSetupQuality(r);
    const demandScore = scoreDemandQuality(r);
    const growthScore = scoreGrowthQuality(r.growthMetrics || {});
    const adProxyScore = Number.isFinite(r.adProxyScore) ? r.adProxyScore : scoreAdProxy(r);
    const epsGrowthProxyScore = Number.isFinite(r.epsGrowthProxyScore) ? r.epsGrowthProxyScore : scoreEpsGrowthProxy(r.growthMetrics || {});
    const riskRewardScore = Number.isFinite(r.riskRewardScore) ? r.riskRewardScore : 45;
    const rsAnchor = Number.isFinite(r.rsGlobalPct) ? r.rsGlobalPct : (r.rsRating || 50);
    const rsQuality = scoreRsQuality({ ...r, riskRewardScore });
    const rsQualityScore = Number.isFinite(rsQuality?.rsQualityScore) ? rsQuality.rsQualityScore : rsAnchor;
    const epsAnchor = Number.isFinite(epsGrowthProxyScore) ? epsGrowthProxyScore : growthScore;
    const legacyTotalScore = r.weinsteinScore * .15 + r.minerviniScore * .17 + rsAnchor * .15 + rsQualityScore * .04 + r.momentumScore * .1 + sectorScore * .1 + r.riskScore * .05 + riskRewardScore * .06 + r.volumeScore * .04 + adProxyScore * .05 + epsAnchor * .07 + r.liquidityScore * .04 + ipoScore * .02;
    const compositeScore = setupQualityScore * .17 + rsAnchor * .16 + rsQualityScore * .06 + demandScore * .1 + adProxyScore * .08 + growthScore * .08 + epsAnchor * .08 + sectorScore * .1 + riskRewardScore * .08 + r.riskScore * .05 + r.momentumScore * .02 + ipoScore * .02;
    const ratingModel = {
      version: "statsedge-transparent-v2",
      rs: "Percentil global del universo analizado; fallback a RS benchmark si no hay muestra suficiente.",
      adProxy: "Up/down volume, volumen relativo, volumen 5d y cierre con volumen.",
      epsGrowthProxy: "Crecimiento de beneficios/ventas, margenes, ROE/ROA y balance si el proveedor devuelve datos.",
      composite: "Setup + RS + demanda + crecimiento + grupo + rentabilidad/riesgo.",
    };
    const scoredBase = { ...r, ...rsQuality, sectorScore, groupStrengthScore: sectorScore, ipoScore, setupQualityScore, demandScore, growthScore, adProxyScore, epsGrowthProxyScore, ratingModel, legacyTotalScore, compositeScore, totalScore: compositeScore, compositeLabel: compositeLabel(compositeScore) };
    const scored = { ...scoredBase, ...scoreWeakness(scoredBase) };
    const story = compositeNarrative(scored);
    return { ...scored, compositeReasons: story.reasons, compositeRisks: story.risks };
  });
}
function shuffle(a) { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; }
function spreadByInitial(list) {
  const groups = new Map();
  for (const item of list) {
    const symbol = item.symbol || item;
    const key = /^[A-Z]/.test(symbol?.[0]) ? symbol[0] : "#";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const buckets = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, items]) => items);
  const out = [];
  let index = 0;
  while (out.length < list.length) {
    let added = false;
    for (const bucket of buckets) {
      if (bucket[index]) {
        out.push(bucket[index]);
        added = true;
      }
    }
    if (!added) break;
    index += 1;
  }
  return out;
}

function chartPath(points, key, x, y) {
  let open = false;
  return points.map((p, i) => {
    const value = p[key];
    if (!Number.isFinite(value)) {
      open = false;
      return "";
    }
    const cmd = open ? "L" : "M";
    open = true;
    return `${cmd}${x(i).toFixed(1)},${y(value).toFixed(1)}`;
  }).filter(Boolean).join(" ");
}

function MiniSparkline({ bars = [] }) {
  const points = bars.filter((x) => Number.isFinite(x.close));
  if (points.length < 2) return <div className="previewEmpty">Sin dato</div>;
  const w = 260, h = 118, pad = 10;
  const values = points.flatMap((p) => [p.close, p.sma50, p.sma200].filter(Number.isFinite));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(1, max * 0.02);
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v) => pad + (1 - ((v - min) / range)) * (h - pad * 2);
  const first = points[0]?.close;
  const last = points[points.length - 1]?.close;
  const trendClass = last >= first ? "up" : "down";
  const volumeMax = Math.max(...points.map((p) => p.volume || 0), 1);
  const barW = Math.max(1.2, (w - pad * 2) / points.length - 1);
  return <svg className={`miniSparkline ${trendClass}`} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Grafico tecnico compacto">
    <line x1={pad} x2={w - pad} y1={y(max)} y2={y(max)} className="sparkGuide" />
    <line x1={pad} x2={w - pad} y1={y(min)} y2={y(min)} className="sparkGuide" />
    {points.map((p, i) => {
      const vh = Math.max(1, ((p.volume || 0) / volumeMax) * 20);
      return <rect key={`${p.date}-${i}`} x={x(i) - barW / 2} y={h - pad - vh} width={barW} height={vh} className="sparkVolume" />;
    })}
    <path d={chartPath(points, "sma200", x, y)} className="sparkMa sparkMa200" />
    <path d={chartPath(points, "sma50", x, y)} className="sparkMa sparkMa50" />
    <path d={chartPath(points, "close", x, y)} className="sparkPrice" />
    <circle cx={x(points.length - 1)} cy={y(last)} r="3.4" className="sparkLast" />
  </svg>;
}

function TradingViewPreviewChart({ row, chartSettings = DEFAULT_CHART_SETTINGS }) {
  const ref = useRef(null);
  const tvSymbol = row ? externalLinks(row.symbol, row.exchange).tradingViewSymbol : "";
  const blockedEmbed = row ? isTradingViewWidgetBlocked(row.symbol, tvSymbol) : false;
  const nativeBars = row?.chartPreview || [];
  const hasNativeChart = nativeBars.filter((bar) => Number.isFinite(bar?.close)).length >= 2;
  const interval = chartSettings?.interval || DEFAULT_CHART_SETTINGS.interval;
  const range = chartSettings?.range || DEFAULT_CHART_SETTINGS.range;
  const style = chartSettings?.style || DEFAULT_CHART_SETTINGS.style;
  useEffect(() => {
    if (!ref.current || !tvSymbol || blockedEmbed || hasNativeChart) return;
    const container = ref.current;
    container.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval,
      range,
      timezone: "Etc/UTC",
      theme: "dark",
      style,
      locale: "es",
      hide_side_toolbar: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    container.appendChild(script);
    return () => {
      script.remove();
      container.innerHTML = "";
    };
  }, [tvSymbol, blockedEmbed, hasNativeChart, interval, range, style]);
  if (!row) return <div className="tvPreviewBox"><div className="previewEmpty">Sin dato</div></div>;
  const links = externalLinks(row.symbol, row.exchange);
  if (hasNativeChart || blockedEmbed) {
    return <div className="tvPreviewBox tvPreviewFallback tvPreviewNative">
      <UniversalPriceChart bars={nativeBars} symbol={row.symbol} currency={row.currency} tradingViewUrl={links.tradingView} settings={chartSettings} height={520} />
    </div>;
  }
  return <div className="tvPreviewBox"><div className="tradingview-widget-container" ref={ref} /></div>;
}

function companyLogoDomain(row = {}) {
  return row.logoDomain || domainFromUrl(row.website || "") || assetDomainForSymbol(row.symbol) || assetDomainForName(row.companyName || row.name);
}

function CompanyMark({ row = {}, size = "md" }) {
  const domain = companyLogoDomain(row);
  const logo = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : "";
  const [failedLogo, setFailedLogo] = useState("");
  const canShowLogo = logo && failedLogo !== logo;
  return <span className={`companyMark companyMark-${size}`}>
    {canShowLogo ? <img src={logo} alt="" loading="lazy" onError={() => setFailedLogo(logo)} /> : <b>{initials(row.companyName || row.name, row.symbol)}</b>}
  </span>;
}

function quickSetup(row) {
  if (!row) return "Sin dato";
  if (stageLabel(row) === "Stage 2" && gte(row.distance20d, -5) && lte(row.extSma50, 15)) return "Near pivot";
  if (stageLabel(row) === "Stage 2" && gte(row.extSma50, 18)) return "Fuerte extendida";
  if (gt(row.price, row.sma200) && between(row.extSma50, -4, 9)) return "Pullback SMA50";
  if (stageLabel(row) === "Stage 2") return "Leader";
  return stageLabel(row);
}

function LeaderTape({ rows = [], activeRow, onSelect, onFavorite, favoriteSymbols, mode = "leader" }) {
  const weaknessMode = mode === "weakness";
  const visible = rows.slice(0, 18);
  return <div className="leaderTape">
    <div className="leaderTapeHead">
      <span>Symbol</span><span>{weaknessMode ? "Deterioro" : "Composite"}</span><span>RS</span><span>RSQ</span><span>Setup</span><span>Vol eff</span>
    </div>
    {visible.map((row) => {
      const active = activeRow?.symbol === row.symbol;
      const rs = rsGlobalValue(row);
      return <div role="button" tabIndex={0} className={`leaderRow ${active ? "active" : ""}`} key={row.symbol} onClick={() => onSelect(row)} onKeyDown={(event) => { if (event.key === "Enter") onSelect(row); }}>
        <span className="leaderIdentity">
          <CompanyMark row={row} />
          <span><b>{row.symbol}</b><em>{row.companyName}</em></span>
        </span>
        <span><b className="miniRating">{weaknessMode ? row.weaknessScore?.toFixed(0) || "-" : row.compositeScore?.toFixed(0) || "-"}</b><small>{weaknessMode ? row.weaknessLabel || "Deterioro" : row.compositeLabel || "Watchlist"}</small></span>
        <span className={(rs ?? 0) >= 75 ? "scoreHot" : (rs ?? 0) >= 55 ? "scoreOk" : "scoreWeak"}>{Number.isFinite(rs) ? rs.toFixed(0) : "-"}</span>
        <span className={(row.rsQualityScore || 0) >= 70 ? "scoreHot" : (row.rsQualityScore || 0) >= 55 ? "scoreOk" : "scoreWeak"}>{row.rsQualityScore?.toFixed(0) || "-"}<small>{row.rsQualityLabel || "-"}</small></span>
        <span><i>{quickSetup(row)}</i><small>{row.theme}</small></span>
        <span>{Number.isFinite(row.volumeEffectScore) ? row.volumeEffectScore.toFixed(0) : "-"}<small>{Number.isFinite(row.relativeVolume) ? `${row.relativeVolume.toFixed(2)}x` : pct(row.volumeSurgePct)}</small></span>
        <span className="leaderActions" onClick={(event) => event.stopPropagation()}>
          {onFavorite && <button type="button" className={`starBtn ${favoriteSymbols?.has(row.symbol) ? "on" : ""}`} onClick={() => onFavorite(row)} aria-label={`Guardar favorito ${row.symbol}`}>★</button>}
        </span>
      </div>;
    })}
    {!visible.length && <div className="leaderEmpty">Sin resultados para la cinta.</div>}
  </div>;
}

function opportunityBuckets(rows = []) {
  const sorted = (check, key = "totalScore") => rows.filter(check).sort((a, b) => sortMetric(b, key) - sortMetric(a, key));
  const defs = [
    { key: "pivot", title: "Near Pivot", note: "Setup cercano", check: (r) => gte(r.distance20d, -5) && lte(r.extSma50, 15) && (rsGlobalValue(r) ?? 0) >= 60 && (r.riskScore || 0) >= 50 },
    { key: "stage2", title: "Stage 2 temprano", note: "Transición saludable", check: (r) => gt(r.price, r.sma200) && gte(r.sma200Slope, 0) && gte(r.distance52w, -35) && lte(r.extSma50, 18) && !isStage2(r) },
    { key: "pullback", title: "Pullback SMA50", note: "Descanso en tendencia", check: (r) => gt(r.price, r.sma200) && between(r.extSma50, -4, 9) && (rsGlobalValue(r) ?? 0) >= 55 },
    { key: "rs", title: "RS Global", note: "Fuerza relativa", check: (r) => (rsGlobalValue(r) ?? 0) >= 75 && gte(r.distance52w, -25) },
    { key: "growth", title: "Growth Quality", note: "Crecimiento + margen", check: (r) => (r.growthScore || 0) >= 70 && (r.totalScore || 0) >= 64 },
    { key: "ipo", title: "IPO reales", note: "Últimos 5 años", check: (r) => isRecentIpoDate(r.ipoDate, 60) },
    { key: "extended", title: "Extendidas fuertes", note: "Extensión alta", check: (r) => gte(r.extSma50, 15) && (r.totalScore || 0) >= 70 && (rsGlobalValue(r) ?? 0) >= 65 },
    { key: "risk", title: "Riesgo a revisar", note: "Volatilidad/extensión", check: (r) => (r.riskScore || 0) < 45 || gt(r.extSma50, 28) || (r.speculationRiskScore || 0) >= 70 },
    { key: "weakness", title: "Deterioro técnico", note: "Evitar largos / estudiar debilidad", sortKey: "weaknessScore", check: (r) => (r.weaknessScore || 0) >= 60 },
  ];
  return defs.map((def) => {
    const hits = sorted(def.check, def.sortKey);
    return { ...def, count: hits.length, leaders: hits.slice(0, 5) };
  });
}

function ScoreLine({ label, value }) {
  const n = Number.isFinite(value) ? value : 0;
  return <div className="scoreLine">
    <span>{label}</span>
    <b>{Number.isFinite(value) ? value.toFixed(0) : "-"}</b>
    <i style={{ width: `${clamp(n)}%` }} />
  </div>;
}

function OpportunityMap({ buckets = [], onSelect }) {
  return <div className="opportunityMap">
    {buckets.map((bucket) => <div className={`opportunityLane ${bucket.count ? "" : "empty"}`} key={bucket.key}>
      <div className="opportunityLaneHead">
        <span>{bucket.title}</span>
        <b>{bucket.count}</b>
      </div>
      <p>{bucket.note}</p>
      <div className="opportunityTickers">
        {bucket.leaders.map((row) => <button type="button" key={row.symbol} onClick={() => onSelect?.(row)}>
          <CompanyMark row={row} size="sm" />
          <span><strong>{row.symbol}</strong><em>{bucket.key === "weakness" ? row.weaknessScore?.toFixed(0) || "-" : row.totalScore?.toFixed(0) || "-"}</em></span>
        </button>)}
        {!bucket.leaders.length && <small>Sin candidatos</small>}
      </div>
    </div>)}
  </div>;
}

const SORT_LABELS = {
  totalScore: "Score",
  rsGlobalPct: "RS Global",
  rsRating: "RS Global",
  volumeEffectScore: "Volumen",
  avgTurnover: "Liquidez",
  shortPercentOfFloat: "Short %",
  dataCoverageScore: "Cobertura",
  weaknessScore: "Deterioro",
};

function MarketMiniTape({ marketHealth }) {
  const indexes = (marketHealth?.indexes || []).slice(0, 4);
  return <section className="mobileMarketTape">
    <div className="mobileIndexRail">
      {indexes.length ? indexes.map((item) => <span key={item.symbol}>
        <b>{item.name?.replace(" Composite", "").replace(" Industrial Average", "") || item.symbol}</b>
        <strong>{money(item.price)}</strong>
        <em className={(item.perf1m || 0) >= 0 ? "up" : "down"}>{pct(item.perf1m)}</em>
      </span>) : ["S&P 500", "NASDAQ", "ACWI"].map((name) => <span key={name}>
        <b>{name}</b>
        <strong>-</strong>
        <em>Sin dato</em>
      </span>)}
    </div>
  </section>;
}

function SetupChipRail({ rows = [], presetKey, setupMode, sort, onPreset, onMode, onSort }) {
  const counts = {
    stage2: rows.filter((row) => stageLabel(row) === "Stage 2").length,
    trend: rows.filter((row) => (row.minerviniScore || 0) >= 65 && (rsGlobalValue(row) ?? 0) >= 65).length,
    vcp: rows.filter((row) => gte(row.distance20d, -5) && lte(row.extSma50, 15) && lte(row.highsSpreadPct, 10)).length,
    rs: rows.filter((row) => (rsGlobalValue(row) ?? 0) >= 75).length,
  };
  const chips = [
    { key: "stage2", label: "Stage 2", count: counts.stage2, active: setupMode === "leader", action: () => onMode("leader") },
    { key: "trend", label: "Trend Template", count: counts.trend, active: presetKey === "strict", action: () => onPreset("strict") },
    { key: "vcp", label: "VCP", count: counts.vcp, active: setupMode === "nearPivot", action: () => onMode("nearPivot") },
    { key: "rs", label: "RS Global", count: counts.rs, active: sort === "rsGlobalPct" || sort === "rsRating", action: () => onSort("rsGlobalPct") },
  ];
  return <div className="mobileChipRail">
    {chips.map((chip) => <button type="button" key={chip.key} className={chip.active ? "active" : ""} onClick={chip.action}>
      {chip.label} <span>{chip.count}</span>
    </button>)}
  </div>;
}

function MobileMoverCard({ row, onSelect }) {
  const change = Number.isFinite(row.perf3m) ? row.perf3m : row.rs3m;
  return <button type="button" className="mobileMoverCard" onClick={() => onSelect(row)}>
    <CompanyMark row={row} size="sm" />
    <span className={(change || 0) >= 0 ? "up" : "down"}>{pct(change)}</span>
    <b>{row.symbol}</b>
    <em>{money(row.price, row.currency)}</em>
    <MiniSparkline bars={row.chartPreview || []} />
  </button>;
}

function MobileTopMovers({ rows = [], onSelect }) {
  const movers = [...rows].filter((row) => Number.isFinite(row.perf3m)).sort((a, b) => (b.perf3m || 0) - (a.perf3m || 0)).slice(0, 8);
  return <section className="mobileTopMovers">
    <div className="mobileSectionHead">
      <span>Top movers · scan</span>
      <button type="button" onClick={() => document.querySelector(".mobileResultList")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Ver mas</button>
    </div>
    <div className="mobileMoverRail">
      {movers.length ? movers.map((row) => <MobileMoverCard key={row.symbol} row={row} onSelect={onSelect} />) : <div className="mobileEmpty">Ejecuta un scan para llenar esta cinta.</div>}
    </div>
  </section>;
}

function MobileResultRow({ row, onReview, onFavorite, isFavorite }) {
  const change = Number.isFinite(row.perf3m) ? row.perf3m : row.rs3m;
  return <article className="mobileResultRow">
    <button type="button" className={`mobileResultLogo ${isFavorite ? "fav" : ""}`} onClick={() => onFavorite(row)} aria-label={`Guardar favorito ${row.symbol}`}>
      <CompanyMark row={row} size="lg" />
    </button>
    <a className="mobileResultIdentity" href={stockUrl(row.symbol)}>
      <b>{row.symbol}</b>
      <span>{row.companyName}</span>
    </a>
    <button type="button" className="mobileResultSpark" onClick={() => onReview(row.symbol)} aria-label={`Revisar ${row.symbol}`}>
      <MiniSparkline bars={row.chartPreview || []} />
    </button>
    <a className="mobileResultPrice" href={stockUrl(row.symbol)}>
      <b>{money(row.price, row.currency)}</b>
      <span className={(change || 0) >= 0 ? "up" : "down"}>{pct(change)}</span>
    </a>
  </article>;
}

function MobileResultList({ rows = [], totalRows = rows.length, sort, onSort, onReview, onFavorite, favoriteSymbols, onSave, onCsv, page = 1, pageSize = DEFAULT_RESULT_PAGE_SIZE, totalPages = 1, onPage, onPageSize }) {
  const start = totalRows ? ((page - 1) * pageSize) + 1 : 0;
  const end = totalRows ? Math.min(page * pageSize, totalRows) : 0;
  return <section className="mobileResultList">
    <div className="mobileResultListHead">
      <span>{totalRows} resultados · {start}-{end} · ordenados por {SORT_LABELS[sort] || sort}</span>
      <div>
        <select value={sort} onChange={(event) => onSort(event.target.value)} aria-label="Orden movil">
          <option value="totalScore">Score</option>
          <option value="rsRating">RS</option>
          <option value="volumeEffectScore">Volumen</option>
          <option value="avgTurnover">Liquidez</option>
          <option value="weaknessScore">Deterioro</option>
        </select>
        <button type="button" onClick={onCsv} disabled={!rows.length}>CSV</button>
        <button type="button" onClick={onSave} disabled={!rows.length} aria-label="Guardar snapshot de resultados">Guardar</button>
        <button type="button" onClick={() => onReview()} disabled={!rows.length}>Revisar</button>
      </div>
    </div>
    <div className="controls" style={{ marginBottom: 10 }}>
      <select value={pageSize} onChange={(event) => onPageSize?.(Number(event.target.value))} aria-label="Acciones por pagina">
        {RESULT_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} / página</option>)}
      </select>
      <button type="button" onClick={() => onPage?.(page - 1)} disabled={page <= 1}>Anterior</button>
      <button type="button" onClick={() => onPage?.(page + 1)} disabled={page >= totalPages}>Siguiente</button>
    </div>
    <div className="mobileRows">
      {rows.length ? rows.map((row) => <MobileResultRow key={row.symbol} row={row} onReview={onReview} onFavorite={onFavorite} isFavorite={favoriteSymbols?.has(row.symbol)} />) : <div className="mobileEmpty">Sin resultados todavia. Carga universo y ejecuta el screener.</div>}
    </div>
  </section>;
}

function RegimeStrip({ rows = [], marketHealth, presetName, setupName, mode = "leader" }) {
  const weaknessMode = mode === "weakness";
  const elite = rows.filter((r) => (r.totalScore || 0) >= 75).length;
  const actionable = rows.filter((r) => (r.totalScore || 0) >= 65 && (r.riskScore || 0) >= 45).length;
  const weaknessCount = rows.filter((r) => (r.weaknessScore || 0) >= 65).length;
  const marketScore = marketHealth?.marketScore;
  const regime = marketHealth?.regime?.label || "Sin regimen";
  return <div className="regimeStrip">
    <span><b>{Number.isFinite(marketScore) ? Math.round(marketScore) : "-"}</b><em>{regime}</em></span>
    <span><b>{rows.length}</b><em>pasan filtro</em></span>
    <span><b>{weaknessMode ? weaknessCount : elite}</b><em>{weaknessMode ? "deterioro alto" : "elite/leader"}</em></span>
    <span><b>{weaknessMode ? rows.filter((r) => (r.weaknessReasons || []).includes("bajo SMA200")).length : actionable}</b><em>{weaknessMode ? "bajo SMA200" : "accionables"}</em></span>
    <span><b>{presetName}</b><em>{setupName}</em></span>
  </div>;
}

function QuickPanel({ row }) {
  if (!row) return <div className="quickPanel"><p className="fine">Selecciona una accion para ver sus caracteristicas.</p></div>;
  return <aside className="quickPanel">
    <div className="quickPanelHead">
      <CompanyMark row={row} size="lg" />
      <div>
        <a className="ticker" href={stockUrl(row.symbol)}>{row.symbol}</a>
        <p>{row.companyName}</p>
      </div>
    </div>
    <div className="quickMetricGrid">
      <span><b>Composite</b>{row.totalScore?.toFixed(0) || "-"}</span>
      <span><b>RS Global</b>{row.rsGlobalPct?.toFixed(0) || "-"}</span>
      <span><b>RS Quality</b>{row.rsQualityScore?.toFixed(0) || "-"}</span>
      <span><b>A/D proxy</b>{row.adProxyScore?.toFixed(0) || "-"}</span>
      <span><b>EPS proxy</b>{row.epsGrowthProxyScore?.toFixed(0) || "-"}</span>
      <span><b>Deterioro</b>{row.weaknessScore?.toFixed(0) || "-"}</span>
      <span><b>RS Pais</b>{row.rsCountryPct?.toFixed(0) || "-"}</span>
      <span><b>RS Sector</b>{row.rsSectorPct?.toFixed(0) || "-"}</span>
      <span><b>Setup</b>{row.setupQualityScore?.toFixed(0) || "-"}</span>
      <span><b>Growth</b>{row.growthScore?.toFixed(0) || "-"}</span>
      <span><b>Cobertura</b>{row.dataCoverageScore?.toFixed(0) || "-"}</span>
      <span><b>3M</b>{pct(row.perf3m)}</span>
      <span><b>52W</b>{pct(row.distance52w)}</span>
      <span><b>SMA50</b>{pct(row.extSma50)}</span>
      <span><b>RelVol</b>{Number.isFinite(row.relativeVolume) ? `${row.relativeVolume.toFixed(2)}x` : "-"}</span>
      <span><b>Vol 5d</b>{pct(row.volumeSurgePct)}</span>
      <span><b>Imp 20d</b>{amount(row.avgTurnover, row.currency)}</span>
      <span><b>Imp sesion</b>{amount(row.latestTurnover, row.currency)}</span>
      <span><b>Vol Effect</b>{row.volumeEffectScore?.toFixed(0) || "-"}</span>
      <span><b>Up/Down</b>{ratioLabel(row.upDownVolRatio)}</span>
      <span><b>Short float</b>{pct(row.shortPercentOfFloat)}</span>
      <span><b>Short ratio</b>{ratioLabel(row.shortRatio)}</span>
      <span><b>Spec Risk</b>{row.speculationRiskScore?.toFixed(0) || "-"}</span>
      <span><b>DD 3M</b>{Number.isFinite(row.maxDrawdown63d) ? `${row.maxDrawdown63d.toFixed(1)}%` : "-"}</span>
      <span><b>Rent/Risk</b>{row.riskRewardScore?.toFixed(0) || "-"}</span>
      <span><b>Bench</b>{row.benchmarkSymbol || "-"}</span>
    </div>
    <div className="labelRail compact">{[...(row.compositeReasons || []).slice(0, 2), row.weaknessLabel].filter(Boolean).map((x) => <span key={x}>{x}</span>)}</div>
    <div className="summaryRow"><span>Setup</span><span>{quickSetup(row)}</span></div>
    <div className="summaryRow"><span>Tema</span><span>{row.theme}</span></div>
    <div className="summaryRow"><span>IPO</span><span>{isRecentIpoDate(row.ipoDate, 60) ? `${row.ipoCategory} · ${row.ipoDate}` : "No reciente / sin fecha fiable"}</span></div>
    <div className="summaryRow"><span>Industria</span><span>{row.industry || "Sin dato"}</span></div>
    <div className="leaderPanelActions">
      <a className="btn btnSmall btnPrimary" href={stockUrl(row.symbol)}>Ficha</a>
      <a className="btn btnSmall" href={externalLinks(row.symbol, row.exchange).tradingView} target="_blank" rel="noreferrer">TradingView</a>
    </div>
  </aside>;
}

function PreviewCard({ row, variant = "grid", onFavorite, isFavorite = false, onSelectChart }) {
  const links = externalLinks(row.symbol, row.exchange);
  const compact = variant === "table";
  const summary = variant === "search";
  const showSparkline = !compact && !summary;
  const stage = stageLabel(row);
  const stageClass = stage === "Stage 2" ? "good" : stage === "Stage 4" ? "bad" : "neutral";
  const stats = compact
    ? [["Comp", row.totalScore?.toFixed(0) || "-"], ["RS G", row.rsGlobalPct?.toFixed(0) || row.rsRating?.toFixed(0) || "-"], ["Vol", row.volumeEffectScore?.toFixed(0) || "-"]]
    : summary
      ? [["Precio", money(row.price, row.currency)], ["Composite", row.totalScore?.toFixed(0) || "-"], ["RS G", row.rsGlobalPct?.toFixed(0) || row.rsRating?.toFixed(0) || "-"], ["A/D", row.adProxyScore?.toFixed(0) || "-"], ["EPS", row.epsGrowthProxyScore?.toFixed(0) || "-"], ["Bench", row.benchmarkSymbol || "-"]]
      : [["Precio", money(row.price, row.currency)], ["Composite", row.totalScore?.toFixed(0) || "-"], ["RS G", row.rsGlobalPct?.toFixed(0) || row.rsRating?.toFixed(0) || "-"], ["RSQ", row.rsQualityScore?.toFixed(0) || "-"], ["Vol eff", row.volumeEffectScore?.toFixed(0) || "-"], ["Short", pct(row.shortPercentOfFloat)], ["Imp 20d", amount(row.avgTurnover, row.currency)], ["Cob", row.dataCoverageScore?.toFixed(0) || "-"], ["Bench", row.benchmarkSymbol || "-"]];
  const summaryStats = [
    ["Comp", row.totalScore?.toFixed(0) || "-"],
    ["RS", row.rsGlobalPct?.toFixed(0) || row.rsRating?.toFixed(0) || "-"],
    ["A/D", row.adProxyScore?.toFixed(0) || "-"],
    ["EPS", row.epsGrowthProxyScore?.toFixed(0) || "-"],
    ["Bench", row.benchmarkSymbol || "-"],
  ];
  return <div className={`stockPreview stockPreview-${variant}`}>
    <div className="previewTop">
      <div className="previewIdentity">
        {!compact && <CompanyMark row={row} />}
        <span>
          <a className="ticker" href={stockUrl(row.symbol)}>{row.symbol}</a>
          {!compact && <span className="previewName">{row.companyName}</span>}
        </span>
      </div>
      {summary ? <div className="previewHeaderMeta">
        <strong>{money(row.price, row.currency)}</strong>
        <span className={`previewStage ${stageClass}`}>{stage}</span>
      </div> : <span className={`previewStage ${stageClass}`}>{stage}</span>}
    </div>
    {showSparkline && <MiniSparkline bars={row.chartPreview || []} />}
    {summary ? <div className="previewSummaryGrid">
      {summaryStats.map(([label, value]) => <span className="previewSummaryStat" key={label}><b>{label}</b><em>{value}</em></span>)}
    </div> : <div className="previewStats">
      {stats.map(([label, value]) => <span key={label}><b>{label}</b>{value}</span>)}
    </div>}
    {!compact && <div className="previewActions">
      {onSelectChart && <button type="button" className="btn btnSmall btnPrimary" onClick={() => onSelectChart(row)}>Grafico</button>}
      <a className="btn btnSmall" href={stockUrl(row.symbol)}>Ficha</a>
      <a className="btn btnSmall" href={links.tradingView} target="_blank" rel="noreferrer">TradingView</a>
      {onFavorite && <button type="button" className={`starBtn ${isFavorite ? "on" : ""}`} onClick={() => onFavorite(row)} aria-label={`Guardar favorito ${row.symbol}`}>{isFavorite ? "★ Guardada" : "★ Guardar"}</button>}
    </div>}
  </div>;
}

function SearchCandidateList({ candidates = [], activeSymbol = "", onPick }) {
  const secondary = candidates.filter((item) => !activeSymbol || item.symbol !== activeSymbol);
  if (!secondary.length) return null;
  return <div className="searchCandidates">
    <div className="sectionTitle"><h2>Coincidencias</h2></div>
    <div className="searchCandidateGrid">
      {secondary.map((item) => {
        return <button type="button" className="searchCandidate" key={item.symbol} onClick={() => onPick?.(item)}>
          <CompanyMark row={{ symbol: item.symbol, companyName: item.name, name: item.name, logoDomain: item.logoDomain, website: item.website }} />
          <span>
            <b>{item.symbol}</b>
            <em>{item.name}</em>
          </span>
          <small>{item.exchange || "-"} · {item.type || "Equity"} · {cap(item.marketCap)}</small>
        </button>;
      })}
    </div>
  </div>;
}

function SearchScopeList({ items = [], onPick }) {
  if (!items.length) return null;
  return <div className="searchCandidates searchScopePanel">
    <div className="sectionTitle"><h2>Busqueda asistida</h2><span className="fine">Activa vistas sin abrir mas filtros</span></div>
    <div className="searchScopeGrid">
      {items.map((item) => <button type="button" className="searchScopeChip" key={`${item.type}-${item.value}`} onClick={() => onPick?.(item)}>
        <span>{item.icon}</span>
        <b>{item.label}</b>
        <em>{item.detail}</em>
      </button>)}
    </div>
  </div>;
}

function compactTone(value, strongAt, weakBelow = null) {
  if (!Number.isFinite(value)) return "";
  if (value >= strongAt) return "good";
  if (Number.isFinite(weakBelow) && value < weakBelow) return "soft";
  return "";
}

function CompactMetric({ label, value, tone = "" }) {
  return <span className={`compactMetric ${tone}`}>
    <small>{label}</small>
    <b>{value ?? "-"}</b>
  </span>;
}

function CompactCountryFlag({ country }) {
  const code = String(country || "").toUpperCase();
  const safeCode = /^[A-Z]{2}$/.test(code) ? code : "XX";
  return <span
    className="compactCountryFlag"
    title={countryName(safeCode)}
    aria-label={countryName(safeCode)}
  >
    {marketFlag(safeCode)}
  </span>;
}

function CompactResultsTable({ rows = [], favoriteSymbols, onFavorite, onReview, rankOffset = 0 }) {
  const headers = ["★", "#", "Ticker", "Empresa", "Gráfico", "Setup", "RS", "Mom.", "Riesgo", "Volumen", "Score"];
  return <div className="tableWrap compactTableWrap">
    <table className="table compactResultsTable">
      <thead>
        <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const country = r.country || countryCode(r.symbol);
          const rsValue = Number.isFinite(r.rsGlobalPct) ? r.rsGlobalPct : r.rsRating;
          const onOpen = () => onReview?.(r.symbol);
          return <tr key={r.symbol} onClick={(e) => { if (!e.target.closest("button, a")) onOpen(); }}>
            <td>
              <button
                type="button"
                className={`starBtn ${favoriteSymbols?.has(r.symbol) ? "on" : ""}`}
                onClick={(e) => { e.stopPropagation(); onFavorite?.(r); }}
                aria-label={`Guardar favorito ${r.symbol}`}
              >
                ★
              </button>
            </td>
            <td className="rankCell">{rankOffset + i + 1}</td>
            <td className="compactSymbolCell">
              <a className="ticker" href={stockUrl(r.symbol)}>{r.symbol}</a>
              <CompactCountryFlag country={country} />
            </td>
            <td className="compactCompanyCell">
              <CompanyMark row={r} size="sm" />
              <span>
                <b>{r.companyName || r.symbol}</b>
              </span>
            </td>
            <td className="compactSparkCell">
              <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} aria-label={`Abrir grafico rapido de ${r.symbol}`}>
                <MiniSparkline bars={r.chartPreview || []} />
              </button>
              <span>
                <b>{money(r.price, r.currency)}</b>
                <em className={Number.isFinite(r.perf3m) && r.perf3m < 0 ? "down" : "up"}>{pct(r.perf3m)}</em>
              </span>
            </td>
            <td>
              <div className="compactStack">
                <b>{stageLabel(r)}</b>
                <span>{r.theme || r.sector || "-"}</span>
                <small>{r.ipoCategory || "Sin IPO"}</small>
              </div>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="RS" value={Number.isFinite(rsValue) ? rsValue.toFixed(0) : "-"} tone={compactTone(rsValue, 75, 45)} />
                <CompactMetric label="RSQ" value={Number.isFinite(r.rsQualityScore) ? r.rsQualityScore.toFixed(0) : "-"} tone={compactTone(r.rsQualityScore, 70, 40)} />
                <CompactMetric label="Pais" value={Number.isFinite(r.rsCountryPct) ? r.rsCountryPct.toFixed(0) : "-"} />
              </div>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="3M" value={pct(r.perf3m)} tone={compactTone(r.perf3m, 20, 0)} />
                <CompactMetric label="6M" value={pct(r.perf6m)} tone={compactTone(r.perf6m, 35, 0)} />
                <CompactMetric label="52w" value={pct(r.distance52w)} tone={compactTone(r.distance52w, -10, -35)} />
              </div>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="Ext." value={pct(r.extSma50)} />
                <CompactMetric label="DD63" value={Number.isFinite(r.maxDrawdown63d) ? `${r.maxDrawdown63d.toFixed(1)}%` : "-"} />
                <CompactMetric label="Short" value={pct(r.shortPercentOfFloat)} />
              </div>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="Rel." value={Number.isFinite(r.relativeVolume) ? `${r.relativeVolume.toFixed(2)}x` : "-"} tone={compactTone(r.relativeVolume, 1.5)} />
                <CompactMetric label="A/D" value={Number.isFinite(r.adProxyScore) ? r.adProxyScore.toFixed(0) : "-"} tone={compactTone(r.adProxyScore, 70, 40)} />
                <CompactMetric label="Efecto" value={Number.isFinite(r.volumeEffectScore) ? r.volumeEffectScore.toFixed(0) : "-"} />
              </div>
            </td>
            <td className="compactScoreCell">
              <b>{Number.isFinite(r.totalScore) ? r.totalScore.toFixed(0) : "-"}</b>
              <span>W {Number.isFinite(r.weinsteinScore) ? r.weinsteinScore.toFixed(0) : "-"} · EPS {Number.isFinite(r.epsGrowthProxyScore) ? r.epsGrowthProxyScore.toFixed(0) : "-"}</span>
            </td>
          </tr>;
        })}
        {!rows.length && <tr><td colSpan={headers.length} className="emptyResultsCell">Ejecuta un scan para ver resultados</td></tr>}
      </tbody>
    </table>
  </div>;
}

function FilterNumber({ field, value, onChange, active = true, inactiveReason = "", onToggle }) {
  const scale = field.scale || 1;
  const shown = Number.isFinite(value) ? value / scale : "";
  return <div className={`filterField ${active ? "isActive" : "isOff"}`}>
    <span className="filterFieldLabel">
      <button type="button" className={`ruleMiniToggle ${active ? "on" : "off"}`} aria-pressed={active} title={active ? "Quitar esta regla del filtro" : inactiveReason || "Activar esta regla"} onClick={onToggle}>
        {active ? "✓" : "X"}
      </button>
      <span>{field.label}</span>
      {field.hint && <InfoHint text={field.hint} />}
    </span>
    <div className="filterInputWrap">
      <input className="input" type="number" step={field.step || 1} value={shown} aria-label={field.label} onChange={(e) => onChange(field.key, (Number(e.target.value) || 0) * scale)} />
      {field.unit && <b>{field.unit}</b>}
    </div>
  </div>;
}

function FilterToggle({ active, onClick, children }) {
  return <label className="nativeCheckbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: active ? '#fafafa' : 'var(--muted)' }}>
    <input type="checkbox" checked={active} onChange={onClick} style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer', margin: 0 }} />
    {children}
  </label>;
}

function LayerControl({ active, onClick, label, detail, countLabel }) {
  return <button type="button" className={`layerToggle ${active ? "on" : "off"}`} aria-pressed={active} onClick={onClick}>
    <span className="layerToggleState"><i>{active ? "✓" : "X"}</i><b>{active ? "Activo" : "Quitado"}</b></span>
    <span className="layerToggleText"><strong>{label}</strong><small>{detail}</small></span>
    <span className="layerToggleCount">{countLabel}</span>
  </button>;
}

const CORE_LAYER_KEYS = ["liquidity", "trend", "momentum", "proximity", "volatility", "score", "coverage"];
const OPTIONAL_LAYER_KEYS = ["volumeSurge", "riskReward", "shortInterest", "ipo"];

function FilterArchitecturePanel({ filterLayers, viewLayers, useRegimeFilter, onToggleLayer, onToggleViewLayer, onToggleRegime, executionRuleActive, executionRuleTotal, viewFiltersActive }) {
  const layerByKey = Object.fromEntries(EXECUTION_LAYERS.map((layer) => [layer.key, layer]));
  return <section className="filterArchitecture">
    <div className="filterArchitectureHead">
      <div>
        <span>Filtro activo</span>
        <strong>{executionRuleActive} de {executionRuleTotal} reglas</strong>
      </div>
    </div>
    <div className="filterLayerBlock">
      <h3>Núcleo</h3>
      {CORE_LAYER_KEYS.map((key) => {
        const layer = layerByKey[key];
        return <LayerControl key={key} active={filterLayers[key]} onClick={() => onToggleLayer(key)} label={layer.label} detail={layer.detail} countLabel={ruleCountLabel(layer.count)} />;
      })}
    </div>
    <div className="filterLayerBlock">
      <h3>Adicionales</h3>
      {OPTIONAL_LAYER_KEYS.map((key) => {
        const layer = layerByKey[key];
        return <LayerControl key={key} active={filterLayers[key]} onClick={() => onToggleLayer(key)} label={layer.label} detail={layer.detail} countLabel={ruleCountLabel(layer.count)} />;
      })}
      <LayerControl active={useRegimeFilter} onClick={onToggleRegime} label={REGIME_LAYER.label} detail={REGIME_LAYER.detail} countLabel={ruleCountLabel(REGIME_LAYER.count)} />
    </div>
    <details className="viewLayerMini">
      <summary><span>Vista de resultados</span><em>{viewFiltersActive} activos</em></summary>
      <div className="viewLayerBar">
        {VIEW_LAYERS.map((layer) => <LayerControl key={layer.key} active={viewLayers[layer.key]} onClick={() => onToggleViewLayer(layer.key)} label={layer.label} detail={layer.detail} countLabel="vista" />)}
      </div>
    </details>
  </section>;
}

function FilterDiagnosticsPanel({ diagnostics, rowsCount, filteredCount, running }) {
  const viewHidden = Math.max(0, rowsCount - filteredCount);
  if (!diagnostics && !running) return <section className="scanDiagnostics empty">
    <div className="scanDiagnosticsHead">
      <span>Embudo del scan</span>
      <strong>Sin diagnostico</strong>
    </div>
    <div className="scanDiagnosticHint">Ejecuta un scan para ver que bloque corta acciones y que parte solo afecta a la vista.</div>
  </section>;
  const blocks = diagnostics?.blocks || [];
  return <section className="scanDiagnostics">
    <div className="scanDiagnosticsHead">
      <span>Embudo del scan</span>
      <strong>{running ? "Analizando..." : `${diagnostics.finalCount}/${diagnostics.analyzed} pasan`}</strong>
    </div>
    <div className="diagnosticStats">
      <span><b>{diagnostics?.analyzed ?? "-"}</b><em>analizadas</em></span>
      <span><b>{diagnostics?.hardRejected ?? "-"}</b><em>filtros duros</em></span>
      <span><b>{diagnostics?.providerRejected ?? "-"}</b><em>datos</em></span>
      <span><b>{diagnostics?.regimeRejected ?? "-"}</b><em>regimen</em></span>
      <span><b>{diagnostics?.postRejected ?? "-"}</b><em>post</em></span>
      <span><b>{viewHidden}</b><em>vista</em></span>
    </div>
    {blocks.length ? <div className="diagnosticBlocks">
      {blocks.slice(0, 7).map((block) => <article key={block.key} className="diagnosticBlock">
        <div><span>{block.stage}</span><strong>{block.label}</strong></div>
        <b>{block.count}</b>
        <ul>{block.examples.slice(0, 2).map((example, index) => <li key={`${block.key}-${example.symbol}-${index}`}><em>{example.symbol}</em>{example.detail}</li>)}</ul>
      </article>)}
    </div> : <div className="scanDiagnosticHint">No hay rechazos registrados en el ultimo scan.</div>}
  </section>;
}

function passesSectorStrength(row = {}, mode = "Todos") {
  const score = row.sectorScore ?? row.groupStrengthScore;
  if (!Number.isFinite(score) || mode === "Todos") return true;
  if (mode === "Fuertes") return score >= 70;
  if (mode === "Constructivos") return score >= 55 && score < 70;
  if (mode === "Debiles") return score < 55;
  if (mode === "Muy debiles") return score < 40;
  return true;
}

function activeLayerCount(layers = {}) {
  return Object.values(layers).filter(Boolean).length;
}

function ruleCountLabel(count = 0, singular = "regla", plural = "reglas") {
  return `${count} ${count === 1 ? singular : plural}`;
}

function layerStatusText(layers = DEFAULT_FILTER_LAYERS, useRegime = true) {
  const off = EXECUTION_LAYERS.filter((x) => !layers[x.key]).map((x) => x.label.toLowerCase());
  if (!useRegime) off.push("regimen");
  return off.length ? `capas off: ${off.join(", ")}` : "todas las capas activas";
}

function fieldLayerKeys(fieldOrKey) {
  const key = typeof fieldOrKey === "string" ? fieldOrKey : fieldOrKey?.key;
  return FILTER_FIELD_LAYERS[key] || [];
}

function isFieldRuleActive(field, rules = DEFAULT_FIELD_RULES, layers = DEFAULT_FILTER_LAYERS) {
  return rules[field.key] !== false && fieldLayerKeys(field).every((key) => layers[key] !== false);
}

function inactiveFieldReason(field, rules = DEFAULT_FIELD_RULES, layers = DEFAULT_FILTER_LAYERS) {
  if (rules[field.key] === false) return "Regla quitada: el valor se conserva";
  const off = fieldLayerKeys(field).filter((key) => layers[key] === false);
  return off.length ? `Capa apagada: ${off.join(", ")}` : "";
}

function effectiveSettingsFromLayers(set, layers = DEFAULT_FILTER_LAYERS, fieldRules = DEFAULT_FIELD_RULES) {
  const next = { ...set };
  if (!layers.trend) {
    next.requireStage2 = false;
    next.requireSma200Up = false;
    next.requirePriceAboveSma50 = false;
    next.minWeinsteinScore = 0;
    next.minMinerviniScore = 0;
  }
  if (!layers.momentum) {
    next.minPerf3m = -100;
    next.minPerf6m = -100;
    next.minPerf12m = -100;
    next.minMomentumScore = 0;
    next.minRsRating = 0;
  }
  if (!layers.proximity) {
    next.maxDistance20dHigh = 999;
    next.maxDistance50dHigh = 999;
    next.maxDistance52w = 999;
    next.maxDistanceATH = 999;
    next.maxHighsSpreadPct = 999;
    next.maxExtensionSma50 = 999;
    next.minRiskScore = 0;
  }
  if (!layers.volatility) {
    next.maxDailyMove20dPct = 999;
    next.maxDailyRange20dPct = 999;
    next.maxRange63dPct = 999;
    next.maxVolatility63d = 999;
    next.maxDrawdown63d = 999;
  }
  if (!layers.score) {
    next.minRiskScore = 0;
    next.minVolumeScore = 0;
    next.minSectorScore = 0;
    next.minTotalScore = 0;
  }
  if (!layers.liquidity) {
    next.minPrice = 0;
    next.minMarketCap = 0;
    next.minAvgVolume = 0;
    next.minAvgTurnover = 0;
    next.minVolumeScore = 0;
    next.minLiquidityScore = 0;
  }
  if (!layers.volumeSurge) {
    next.minLatestVolume = 0;
    next.minLatestTurnover = 0;
    next.minRelativeVolume = 0;
    next.minVolumeSurgePct = -999;
    next.minUpDownVolRatio = 0;
    next.minVolumeEffectScore = 0;
    next.requireUpVolume = false;
  }
  if (!layers.shortInterest) {
    next.minShortFloatPct = 0;
    next.maxShortFloatPct = 999;
  }
  if (!layers.riskReward) {
    next.minRsQualityScore = 0;
    next.minRiskRewardScore = 0;
    next.minReturnToVol3m = -999;
    next.minReturnToDrawdown3m = -999;
  }
  if (!layers.coverage) {
    next.minDataCoverageScore = 0;
    next.minTechnicalCoverageScore = 0;
    next.minFundamentalCoverageScore = 0;
  }
  if (!layers.ipo) {
    next.requireRecentIpo = false;
    next.maxIpoAgeMonths = 999;
  }
  if (!layers.ipo && next.setupMode === "ipoRecent") next.setupMode = "any";
  if (!layers.proximity && ["nearPivot", "pullback", "early", "ipoRecent", "extended"].includes(next.setupMode)) next.setupMode = "any";
  if (!layers.momentum && ["pullback", "early", "ipoRecent", "extended"].includes(next.setupMode)) next.setupMode = "any";
  if (!layers.trend && ["leader", "early", "pullback"].includes(next.setupMode)) next.setupMode = "any";
  for (const field of FILTER_FIELDS) {
    if (!isFieldRuleActive(field, fieldRules, layers)) next[field.key] = NEUTRAL_FIELD_VALUES[field.key] ?? next[field.key];
  }
  return next;
}

export default function Page() {
  const [markets, setMarkets] = useState(DEFAULT_MARKETS);
  const [manual, setManual] = useState("");
  const [settings, setSettings] = useState(PRESETS.balanced.v);
  const [presetKey, setPresetKey] = useState("balanced");
  const [universe, setUniverse] = useState([]);
  const [rows, setRows] = useState([]);
  const [fail, setFail] = useState([]);
  const [diagnostics, setDiagnostics] = useState(null);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [running, setRunning] = useState(false);
  const [themeFilter, setThemeFilter] = useState("Todos");
  const [sectorFilter, setSectorFilter] = useState("Todos");
  const [industryFilter, setIndustryFilter] = useState("Todos");
  const [countryFilter, setCountryFilter] = useState("Todos");
  const [sectorStrength, setSectorStrength] = useState("Todos");
  const [ipo, setIpo] = useState("Todos");
  const [sort, setSort] = useState("totalScore");
  const [err, setErr] = useState("");
  const [scanMode, setScanMode] = useState("batch");
  const [batchStart, setBatchStart] = useState(0);
  const [scanBatchSize, setScanBatchSize] = useState(DEFAULT_SCAN_BATCH_SIZE);
  const [resultPageSize, setResultPageSize] = useState(DEFAULT_RESULT_PAGE_SIZE);
  const [resultPage, setResultPage] = useState(1);
  const [marketHealth, setMarketHealth] = useState(null);
  const [useRegimeFilter, setUseRegimeFilter] = useState(true);
  const [filterLayers, setFilterLayers] = useState(DEFAULT_FILTER_LAYERS);
  const [fieldRules, setFieldRules] = useState(DEFAULT_FIELD_RULES);
  const [viewLayers, setViewLayers] = useState(DEFAULT_VIEW_LAYERS);
  const [favoriteSymbols, setFavoriteSymbols] = useState(new Set());
  const [searchSymbol, setSearchSymbol] = useState("");
  const [searchCandidates, setSearchCandidates] = useState([]);
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [activePreviewRow, setActivePreviewRow] = useState(null);
  const [activeModalRow, setActiveModalRow] = useState(null);
  const [quickReviewRows, setQuickReviewRows] = useState([]);
  const [quickReviewIndex, setQuickReviewIndex] = useState(0);
  const [chartSettings, setChartSettings] = useState(DEFAULT_CHART_SETTINGS);
  const [chartScope, setChartScope] = useState("global");
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    setFavoriteSymbols(new Set(safeRead(STORAGE_KEYS.favorites, []).map((x) => x.symbol)));
    setChartSettings(readChartSettings());
    const session = safeRead(STORAGE_KEYS.screenerSession, null);
    if (session?.version === SCREENER_SESSION_VERSION) {
      setMarkets(Array.isArray(session.markets) && session.markets.length ? session.markets : DEFAULT_MARKETS);
      setManual(session.manual || "");
      setSettings(session.settings || PRESETS.balanced.v);
      setPresetKey(session.presetKey || "balanced");
      setUniverse(Array.isArray(session.universe) ? session.universe : []);
      setRows(Array.isArray(session.rows) ? session.rows : []);
      setFail(Array.isArray(session.fail) ? session.fail : []);
      setDiagnostics(session.diagnostics || null);
      setThemeFilter(session.themeFilter || "Todos");
      setSectorFilter(session.sectorFilter || "Todos");
      setIndustryFilter(session.industryFilter || "Todos");
      setCountryFilter(session.countryFilter || "Todos");
      setSectorStrength(session.sectorStrength || "Todos");
      setIpo(session.ipo || "Todos");
      setSort(session.sort || "totalScore");
      setScanMode(session.scanMode || "batch");
      setBatchStart(Number.isFinite(session.batchStart) ? session.batchStart : 0);
      setScanBatchSize(SCAN_BATCH_SIZES.includes(session.scanBatchSize) ? session.scanBatchSize : DEFAULT_SCAN_BATCH_SIZE);
      setResultPageSize(RESULT_PAGE_SIZES.includes(session.resultPageSize) ? session.resultPageSize : DEFAULT_RESULT_PAGE_SIZE);
      setResultPage(Number.isFinite(session.resultPage) && session.resultPage > 0 ? session.resultPage : 1);
      setMarketHealth(session.marketHealth || null);
      setUseRegimeFilter(session.useRegimeFilter !== false);
      setFilterLayers(session.filterLayers || DEFAULT_FILTER_LAYERS);
      setFieldRules(session.fieldRules || DEFAULT_FIELD_RULES);
      setViewLayers(session.viewLayers || DEFAULT_VIEW_LAYERS);
      setSearchSymbol(session.searchSymbol || "");
      setSearchCandidates(Array.isArray(session.searchCandidates) ? session.searchCandidates : []);
      setSearchResult(session.searchResult || null);
      setQuickReviewRows(Array.isArray(session.quickReviewRows) ? session.quickReviewRows : []);
      setQuickReviewIndex(Number.isFinite(session.quickReviewIndex) ? session.quickReviewIndex : 0);
      setStatus(session.rows?.length ? `Sesión restaurada: ${session.rows.length} acciones en el screener.` : (session.status || DEFAULT_STATUS));
    }
    setSessionReady(true);
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const sessionPayload = {
      version: SCREENER_SESSION_VERSION,
      updatedAt: new Date().toISOString(),
      markets,
      manual,
      settings,
      presetKey,
      universe,
      rows,
      fail,
      diagnostics,
      status,
      themeFilter,
      sectorFilter,
      industryFilter,
      countryFilter,
      sectorStrength,
      ipo,
      sort,
      scanMode,
      batchStart,
      scanBatchSize,
      resultPageSize,
      resultPage,
      marketHealth,
      useRegimeFilter,
      filterLayers,
      fieldRules,
      viewLayers,
      searchSymbol,
      searchCandidates,
      searchResult,
      quickReviewRows,
      quickReviewIndex,
    };
    const saved = safeWrite(STORAGE_KEYS.screenerSession, sessionPayload);
    if (!saved) {
      safeWrite(STORAGE_KEYS.screenerSession, {
        ...sessionPayload,
        universe: [],
        fail: [],
        diagnostics: null,
        searchCandidates: [],
        searchResult: compactRowForSession(searchResult),
        quickReviewRows: compactRowsForSession(quickReviewRows),
        rows: compactRowsForSession(rows),
        storageNote: "Sesión compactada por límite de localStorage.",
      });
    }
  }, [sessionReady, markets, manual, settings, presetKey, universe, rows, fail, diagnostics, status, themeFilter, sectorFilter, industryFilter, countryFilter, sectorStrength, ipo, sort, scanMode, batchStart, scanBatchSize, resultPageSize, resultPage, marketHealth, useRegimeFilter, filterLayers, fieldRules, viewLayers, searchSymbol, searchCandidates, searchResult, quickReviewRows, quickReviewIndex]);

  const chartListId = useMemo(() => `screener:${presetKey}:${markets.join(",")}`, [presetKey, markets]);

  function updateChartSettings(nextSettings) {
    setChartSettings(writeChartSettings(nextSettings, { scope: chartScope, symbol: activeModalRow?.symbol, listId: chartListId }));
  }

  function updateChartScope(nextScope) {
    setChartScope(nextScope);
    setChartSettings(readChartSettings({ scope: nextScope, symbol: activeModalRow?.symbol, listId: chartListId }));
  }

  useEffect(() => {
    if (chartScope !== "global") setChartSettings(readChartSettings({ scope: chartScope, symbol: activeModalRow?.symbol, listId: chartListId }));
  }, [chartScope, activeModalRow?.symbol, chartListId]);

  const activeSettings = useMemo(() => effectiveSettingsFromLayers(settings, filterLayers, fieldRules), [settings, filterLayers, fieldRules]);
  const activeLayerLabel = useMemo(() => layerStatusText(filterLayers, useRegimeFilter), [filterLayers, useRegimeFilter]);
  const executionLayerTotal = EXECUTION_LAYERS.length + 1;
  const executionLayerActive = activeLayerCount(filterLayers) + (useRegimeFilter ? 1 : 0);
  const executionRuleTotal = REGIME_LAYER.count + EXECUTION_LAYERS.reduce((sum, layer) => sum + layer.count, 0);
  const executionRuleActive = (useRegimeFilter ? REGIME_LAYER.count : 0) + EXECUTION_LAYERS.reduce((sum, layer) => sum + (filterLayers[layer.key] ? layer.count : 0), 0);
  const fineRuleTotal = FILTER_FIELDS.length;
  const fineRuleActive = FILTER_FIELDS.filter((field) => isFieldRuleActive(field, fieldRules, filterLayers)).length;
  const viewFilterCounts = {
    country: countryFilter !== "Todos" ? 1 : 0,
    theme: themeFilter !== "Todos" ? 1 : 0,
    sector: sectorFilter !== "Todos" ? 1 : 0,
    industry: industryFilter !== "Todos" ? 1 : 0,
    sectorStrength: sectorStrength !== "Todos" ? 1 : 0,
    ipo: ipo !== "Todos" ? 1 : 0,
  };
  const viewFiltersActive = VIEW_LAYERS.reduce((sum, layer) => sum + (viewLayers[layer.key] ? viewFilterCounts[layer.key] : 0), 0);
  const clear = () => { setRows([]); setFail([]); setDiagnostics(null); setErr(""); setResultPage(1); };
  function resetScreenerSession() {
    safeRemove(STORAGE_KEYS.screenerSession);
    setMarkets(DEFAULT_MARKETS);
    setManual("");
    setSettings(PRESETS.balanced.v);
    setPresetKey("balanced");
    setUniverse([]);
    setRows([]);
    setFail([]);
    setDiagnostics(null);
    setStatus("Sesión reiniciada. Carga universo o ejecuta el screener cuando quieras.");
    setRunning(false);
    setThemeFilter("Todos");
    setSectorFilter("Todos");
    setIndustryFilter("Todos");
    setCountryFilter("Todos");
    setSectorStrength("Todos");
    setIpo("Todos");
    setSort("totalScore");
    setErr("");
    setScanMode("batch");
    setBatchStart(0);
    setScanBatchSize(DEFAULT_SCAN_BATCH_SIZE);
    setResultPageSize(DEFAULT_RESULT_PAGE_SIZE);
    setResultPage(1);
    setMarketHealth(null);
    setUseRegimeFilter(true);
    setFilterLayers(DEFAULT_FILTER_LAYERS);
    setFieldRules(DEFAULT_FIELD_RULES);
    setViewLayers(DEFAULT_VIEW_LAYERS);
    setSearchSymbol("");
    setSearchCandidates([]);
    setSearchResult(null);
    setSearchError("");
    setSearchLoading(false);
    setActivePreviewRow(null);
    setActiveModalRow(null);
    setQuickReviewRows([]);
    setQuickReviewIndex(0);
    setShowMobileFilters(false);
  }
  const updateSetting = (key, value) => setSettings((prev) => {
    if (key === "setupMode" && value === "weakness") return { ...prev, ...PRESETS.weakness.v, maxSymbols: prev.maxSymbols || PRESETS.weakness.v.maxSymbols };
    return { ...prev, [key]: value };
  });
  const toggleFilterLayer = (key) => setFilterLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleFieldRule = (field) => {
    const currentlyActive = isFieldRuleActive(field, fieldRules, filterLayers);
    if (currentlyActive) {
      setFieldRules((prev) => ({ ...prev, [field.key]: false }));
      return;
    }
    setFieldRules((prev) => ({ ...prev, [field.key]: true }));
    const neededLayers = fieldLayerKeys(field);
    if (neededLayers.length) setFilterLayers((prev) => ({ ...prev, ...Object.fromEntries(neededLayers.map((key) => [key, true])) }));
  };
  const toggleViewLayer = (key) => setViewLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  async function loadMarketHealth() {
    setStatus("Actualizando salud de mercado...");
    try {
      const d = await getJson("/api/market-health");
      setMarketHealth(d);
      setStatus(`Salud de mercado: ${d.regime?.label || "sin regimen"} · Score ${Math.round(d.marketScore || 0)}`);
      return d;
    } catch (e) {
      setErr(e.message);
      setStatus("Proveedor no disponible para salud de mercado");
      return null;
    }
  }
  async function loadSearchResult(symbol, candidate = null) {
    const normalized = String(symbol || "").trim().toUpperCase();
    if (!normalized) {
      setSearchError("Introduce un ticker o el nombre de una empresa.");
      return;
    }
    setSearchLoading(true);
    setSearchError("");
    try {
      const [chart, profile] = await Promise.all([
        getJson(`/api/chart?symbol=${encodeURIComponent(normalized)}`),
        getJson(`/api/profile?symbol=${encodeURIComponent(normalized)}`).catch(() => ({})),
      ]);
      const baseRow = buildResearchRow(normalized, chart, profile, false);
      const benchmark = baseRow.benchmarkSymbol || benchmarkSymbolForRow(baseRow);
      const benchmarkChart = await getJson(`/api/chart?symbol=${encodeURIComponent(benchmark)}`).catch(() => ({ bars: [] }));
      const withBenchmark = applyRelativeStrength(baseRow, { [benchmark]: benchmarkChart });
      const row = sectorize([{ ...withBenchmark, ...dataCoverageForRow(withBenchmark, profile) }])[0];
      setSearchResult(row);
      setStatus(`Vista rapida cargada para ${row.companyName || candidate?.name || normalized} (${normalized}).`);
    } catch (e) {
      setSearchResult(null);
      setSearchError(e.message || "Proveedor no disponible");
      setStatus(`No se pudo cargar la vista rapida de ${normalized}.`);
    } finally {
      setSearchLoading(false);
    }
  }
  function resetSearchScopeState() {
    setSearchCandidates([]);
    setSearchResult(null);
    setSearchError("");
  }
  function clearSearch() {
    setSearchSymbol("");
    setSearchCandidates([]);
    setSearchResult(null);
    setSearchError("");
    setSearchLoading(false);
    setStatus("Buscador limpio.");
  }
  function updateSearchSymbol(value) {
    setSearchSymbol(value);
    if (!String(value || "").trim()) {
      setSearchCandidates([]);
      setSearchResult(null);
      setSearchError("");
    }
  }
  async function applySearchScope(item) {
    if (!item) return;
    if (item.type === "stock") {
      setSearchSymbol(item.value);
      loadSearchResult(item.value, { symbol: item.value, name: item.name || item.label });
      return;
    }
    resetSearchScopeState();
    if (item.type === "country") {
      setViewLayers((prev) => ({ ...prev, country: true, theme: true, sector: true, industry: true }));
      setCountryFilter(item.value);
      setThemeFilter("Todos");
      setSectorFilter("Todos");
      setIndustryFilter("Todos");
      const hasCountryRows = rows.some((row) => (row.country || countryCode(row.symbol)) === item.value);
      if (!hasCountryRows) {
        setMarkets([item.value]);
        setUniverse([]);
        clear();
        setStatus(`Cargando universo de ${marketName(item.value)}...`);
        await loadUniverse([item.value]);
      } else {
        setStatus(`Vista por pais: ${marketName(item.value)}.`);
      }
      return;
    }
    if (item.type === "theme") {
      setViewLayers((prev) => ({ ...prev, theme: true, sector: true, industry: true }));
      setCountryFilter("Todos");
      setThemeFilter(item.value);
      setSectorFilter("Todos");
      setIndustryFilter("Todos");
      setStatus(`Vista por tematica: ${item.value}.`);
      return;
    }
    if (item.type === "sector") {
      setViewLayers((prev) => ({ ...prev, sector: true, theme: true, industry: true }));
      setCountryFilter("Todos");
      setThemeFilter("Todos");
      setSectorFilter(item.value);
      setIndustryFilter("Todos");
      setStatus(`Vista por sector: ${item.value}.`);
      return;
    }
    if (item.type === "industry") {
      setViewLayers((prev) => ({ ...prev, industry: true, theme: true, sector: true }));
      setCountryFilter("Todos");
      setThemeFilter("Todos");
      setSectorFilter("Todos");
      setIndustryFilter(item.value);
      setStatus(`Vista por subsector: ${item.value}.`);
    }
  }
  async function runSearch(event) {
    event?.preventDefault?.();
    const query = searchSymbol.trim();
    if (!query) {
      clearSearch();
      return;
    }
    const tickerish = /^[A-Z0-9.^=-]{1,18}$/i.test(query) && !/\s/.test(query);
    setSearchLoading(true);
    setSearchError("");
    try {
      const data = await getJson(`/api/search?q=${encodeURIComponent(query)}`).catch(() => ({ results: [] }));
      const candidates = data.results || [];
      setSearchCandidates(candidates);
      const upper = query.toUpperCase();
      const exact = candidates.find((item) => item.symbol === upper);
      const picked = exact || candidates[0] || (tickerish ? { symbol: upper, name: upper } : null);
      if (!picked) {
        if (searchScopeItems.length) {
          await applySearchScope(searchScopeItems[0]);
          return;
        }
        setSearchResult(null);
        setSearchError("No encontre candidatos. Prueba con nombre, ticker, sector, subsector, pais o sufijo Yahoo.");
        setStatus(`Sin coincidencias para ${query}.`);
        return;
      }
      await loadSearchResult(picked.symbol, picked);
      if (!exact && candidates.length > 1) setStatus(`Cargado ${picked.symbol}. Hay ${candidates.length} coincidencias; puedes elegir otra debajo del buscador.`);
    } catch (e) {
      setSearchResult(null);
      setSearchError(e.message || "Proveedor no disponible");
      setStatus(`No se pudo buscar ${query}.`);
    } finally {
      setSearchLoading(false);
    }
  }
  async function loadBenchmarks() {
    const entries = await Promise.all(BENCHMARK_SYMBOLS.map(async (symbol) => {
      try {
        return [symbol, await getJson(`/api/chart?symbol=${encodeURIComponent(symbol)}`)];
      } catch {
        return [symbol, { bars: [] }];
      }
    }));
    return Object.fromEntries(entries);
  }
  function setPreset(k) { setPresetKey(k); setSettings({ ...PRESETS[k].v }); setSort(PRESETS[k].v.setupMode === "weakness" ? "weaknessScore" : "totalScore"); setFieldRules(DEFAULT_FIELD_RULES); clear(); setStatus(`Filtro activo: ${PRESETS[k].name}. Pulsa Ejecutar.`); }
  async function loadUniverse(marketsOverride = null) {
    setErr(""); setFail([]); setRows([]); setStatus("Descargando universos completos...");
    try {
      const targetMarkets = Array.isArray(marketsOverride) && marketsOverride.length ? marketsOverride : markets;
      const d = await getJson(`/api/universe?markets=${encodeURIComponent(targetMarkets.join(","))}`);
      const all = d.universe || [];
      const man = manual.split(/[\n,;\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean).map((symbol) => ({ symbol, name: symbol, country: countryCode(symbol), source: "manual" }));
      const ipoRadar = ipoRadarUniverseRows();
      const u = Array.from(new Map([...all, ...man, ...ipoRadar].map((x) => [x.symbol, x])).values());
      setUniverse(u);
      const marketLabel = targetMarkets.length === 1 ? ` · ${marketName(targetMarkets[0])}` : "";
      const scopeLabel = scanMode === "all" ? "todo el universo" : `lote de ${scanBatchSize}`;
      setStatus(`Universo cargado${marketLabel}: ${u.length} tickers${ipoRadar.length ? ` · IPO Radar ${ipoRadar.length}` : ""}. Filtro: ${PRESETS[presetKey].name}. Alcance inicial: ${scopeLabel}.`);
      return u;
    } catch (e) {
      setErr(e.message);
      setStatus("Proveedor no disponible al cargar universo");
      return [];
    }
  }
  function selected(u) {
    const list = [...u];
    if (scanMode === "random") return shuffle(list).slice(0, scanBatchSize);
    if (scanMode === "all") return list;
    const spread = spreadByInitial(list);
    const start = Math.max(0, Math.min(batchStart, Math.max(0, spread.length - 1)));
    return spread.slice(start, start + scanBatchSize);
  }
  async function run() {
    setRunning(true); setRows([]); setFail([]); setDiagnostics(null); setErr(""); setResultPage(1);
    try {
      const mh = marketHealth || (useRegimeFilter ? await loadMarketHealth() : null);
      const base = universe.length ? universe : await loadUniverse();
      setStatus("Cargando benchmarks RS: SPY / QQQ / ACWI...");
      const benchmarks = await loadBenchmarks();
      const symbols = selected(base);
      let rawRows = [], bad = [], filterRejections = [], qualityGateRejections = [];
      for (let i = 0; i < symbols.length; i++) {
        const s = symbols[i].symbol || symbols[i];
        setStatus(`Analizando ${i + 1}/${symbols.length}: ${s}`);
        try {
          const row = await analyzeRawCandidate(s, activeSettings, benchmarks);
          const gate = qualityGateForResearchRow(row, activeSettings);
          if (!gate.passed) {
            qualityGateRejections.push({
              symbol: s,
              key: "qualityGate",
              label: "Quality Gate",
              stage: "Pre-scan",
              detail: gate.reasons.join(" · "),
              field: "qualityGate",
            });
            continue;
          }
          rawRows.push({ ...row, qualityGate: gate });
          if (rawRows.length % 5 === 0) {
            const partialSectorized = sectorize(rawRows);
            const partialSplit = splitByFilter(partialSectorized, activeSettings);
            const partial = sortRowsForMode(applyPostFilters(regimeFiltered(partialSplit.passed, mh, useRegimeFilter, activeSettings), activeSettings), activeSettings);
            setRows(partial);
          }
        } catch (e) {
          bad.push({ symbol: s, reason: e.message || "Proveedor no disponible" });
        }
        await new Promise((r) => setTimeout(r, 65));
      }
      const sectorized = sectorize(rawRows);
      const hardFilterSplit = splitByFilter(sectorized, activeSettings);
      const ok = hardFilterSplit.passed;
      filterRejections = [...qualityGateRejections, ...hardFilterSplit.rejections];
      const regimeRejections = ok.map((row) => {
        const reason = regimeRejectReason(row, mh, useRegimeFilter, activeSettings);
        return reason ? { symbol: row.symbol, ...reason } : null;
      }).filter(Boolean);
      const afterRegime = ok.filter((row) => !regimeRejectReason(row, mh, useRegimeFilter, activeSettings));
      const postRejections = afterRegime.map((row) => {
        const reason = postFilterRejectReason(row, activeSettings);
        return reason ? { symbol: row.symbol, ...reason } : null;
      }).filter(Boolean);
      const final = sortRowsForMode(afterRegime.filter((row) => !postFilterRejectReason(row, activeSettings)), activeSettings);
      setRows(final);
      setFail(bad);
      setDiagnostics(scanDiagnosticsSummary({ symbols, base, filterRejections, providerErrors: bad, regimeRejections, postRejections, passedBeforeContext: ok.length, finalRows: final }));
      setStatus(`Completado: ${final.length} pasan ${PRESETS[presetKey].name} · RS Global sobre ${sectorized.length} acciones con datos · ${setupModeLabel(activeSettings.setupMode)} · ${activeLayerLabel}. Analizados ${symbols.length}/${base.length}.`);
    } catch (e) {
      setErr(e.message);
      setStatus("Error");
    } finally {
      setRunning(false);
    }
  }
  function nextBatch() {
    const total = universe.length || 1;
    let n = batchStart + scanBatchSize;
    if (n >= total) n = 0;
    setBatchStart(n);
    setStatus(`Lote seleccionado: ${n + 1}-${Math.min(n + scanBatchSize, total)} de ${total}`);
  }
  function marketPreset(t) {
    if (t === "global") setMarkets(DEFAULT_MARKETS);
    if (t === "us") setMarkets(["US"]);
    if (t === "europe") setMarkets(EUROPE);
    if (t === "asia") setMarkets(ASIA);
    if (t === "hk") setMarkets(["HK"]);
    setBatchStart(0);
    setUniverse([]); clear(); setStatus("Preset cambiado. Pulsa Cargar universo.");
  }
  function addFavorite(row) {
    const favs = safeRead(STORAGE_KEYS.favorites, []);
    if (favs.some((f) => f.symbol === row.symbol)) {
      setStatus(`${row.symbol} ya estaba en favoritos.`);
      return;
    }
    const favorite = favoriteFromRow(row, marketHealth);
    const next = [favorite, ...favs].slice(0, 250);
    safeWrite(STORAGE_KEYS.favorites, next);
    setFavoriteSymbols(new Set(next.map((x) => x.symbol)));
    setStatus(`${row.symbol} guardado en favoritos locales. Sincronizando Supabase...`);
    syncFavoriteToCloud(favorite).then((result) => {
      if (result.configured === false) setStatus(`${row.symbol} guardado localmente. Supabase no configurado.`);
      else if (result.ok) setStatus(`${row.symbol} guardado en favoritos y Supabase.`);
      else setStatus(`${row.symbol} guardado localmente. Supabase: ${result.message}`);
    });
  }
  function saveSnapshot(currentRows) {
    if (!currentRows.length) {
      setStatus("Sin filas actuales para guardar snapshot.");
      return;
    }
    const scans = safeRead(STORAGE_KEYS.scans, []);
    const compatibilityContext = {
      preset: presetKey,
      settings,
      activeSettings,
      filterLayers: { ...filterLayers, marketRegime: useRegimeFilter },
      fieldRules,
      markets,
      scanMode,
    };
    const compatibilityKey = snapshotCompatibilityKey(compatibilityContext);
    const previousScan = findCompatiblePreviousScan(scans, compatibilityContext);
    const enrichedRows = enrichRowsWithMethodology(currentRows, previousScan?.rows || []);
    const methodologySummary = summarizeMethodology(enrichedRows, previousScan);
    const eventTotal = Object.values(methodologySummary.eventCounts || {}).reduce((sum, value) => sum + value, 0);
    const scan = {
      id: uid(),
      createdAt: new Date().toISOString(),
      name: `${PRESETS[presetKey].name} · ${enrichedRows.length} acciones · ${new Date().toLocaleString()}`,
      preset: presetKey,
      settings,
      activeSettings,
      filterLayers,
      fieldRules,
      viewLayers,
      marketScore: marketHealth?.marketScore ?? null,
      marketRegime: marketHealth?.regime?.label || "sin dato",
      snapshotCompatibilityKey: compatibilityKey,
      comparison: {
        compatiblePrevious: Boolean(previousScan),
        previousScanId: previousScan?.id || null,
        previousScanDate: previousScan?.createdAt || null,
      },
      methodologySummary,
      rows: enrichedRows,
    };
    safeWrite(STORAGE_KEYS.scans, [scan, ...scans].slice(0, 50));
    const generatedAlerts = alertsFromScan(scan);
    const nextAlerts = mergeAlerts(safeRead(STORAGE_KEYS.alerts, []), generatedAlerts).slice(0, 500);
    safeWrite(STORAGE_KEYS.alerts, nextAlerts);
    setStatus(`Snapshot guardado localmente: ${enrichedRows.length} acciones · ${eventTotal} eventos · ${generatedAlerts.length} alertas. Sincronizando Supabase...`);
    syncScanToCloud(scan).then((result) => {
      if (result.configured === false) setStatus(`Snapshot guardado localmente: ${enrichedRows.length} acciones · ${generatedAlerts.length} alertas. Supabase no configurado.`);
      else if (result.ok) setStatus(`Snapshot guardado: ${enrichedRows.length} acciones · ${generatedAlerts.length} alertas. Disponible en local y Supabase.`);
      else setStatus(`Snapshot local guardado. Supabase: ${result.message}`);
    });
    syncAlertsToCloud(generatedAlerts).then((result) => {
      if (result.configured !== false && !result.ok) setStatus(`Snapshot guardado. Alertas solo locales: ${result.message}`);
      else if (result.ok && result.data?.alerts?.length) safeWrite(STORAGE_KEYS.alerts, mergeAlerts(safeRead(STORAGE_KEYS.alerts, []), result.data.alerts).slice(0, 500));
    });
  }
  function openReview(currentRows, startSymbol = "") {
    const reviewRows = Array.isArray(currentRows) ? currentRows.filter(Boolean) : [];
    if (!reviewRows.length) {
      setStatus("Sin filas actuales para abrir vista rapida.");
      return;
    }
    const currentIndex = Math.max(0, reviewRows.findIndex((row) => row.symbol === startSymbol));
    setQuickReviewRows(reviewRows);
    setQuickReviewIndex(currentIndex);
    setActiveModalRow(reviewRows[currentIndex]);
    safeWrite(STORAGE_KEYS.review, {
      source: "current",
      rows: reviewRows,
      currentIndex,
      reviewedSymbols: [],
      hiddenSymbols: [],
      selectedSymbol: startSymbol || reviewRows[0]?.symbol || "",
      updatedAt: new Date().toISOString(),
    });
    setStatus(`Vista rapida: ${reviewRows.length} acciones en cola.`);
  }
  function selectQuickReview(index, list = quickReviewRows) {
    if (!list.length) return;
    const nextIndex = ((index % list.length) + list.length) % list.length;
    setQuickReviewIndex(nextIndex);
    setActiveModalRow(list[nextIndex]);
    safeWrite(STORAGE_KEYS.review, {
      source: "current",
      rows: list,
      currentIndex: nextIndex,
      reviewedSymbols: [],
      hiddenSymbols: [],
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
  function csv(filteredRows) {
    const h = ["Rank", "Ticker", "Empresa", "Actividad ES", "Tema", "Pais", "Sector", "Industria", "IPO", "IPO Date", "IPO Age Months", "Benchmark", "Data Coverage", "Technical Coverage", "Fundamental Coverage", "Data Issues", "RS Rating", "RS Global", "RS Pais", "RS Sector", "RS Quality", "RS Stability", "Speculation Risk", "RS Quality Label", "Weakness Score", "Weakness Label", "Weakness Reasons", "RS Global Sample", "RS Pais Sample", "RS Sector Sample", "RS 3M", "RS 6M", "RS 12M", "Dist 20d", "Dist 50d", "Dist 52w", "Dist ATH", "Highs Spread", "3M", "6M", "12M", "SMA50", "Avg Volume 20d", "Latest Volume", "Avg Turnover 20d", "Latest Turnover", "UD Vol", "Rel Volume", "Volume Surge %", "Volume Effect Score", "A/D Proxy", "EPS/Growth Proxy", "Volume Evidence", "Short Float %", "Short Ratio", "Shares Short", "Float Shares", "Up Volume", "Max Daily Move 20d", "Max Daily Range 20d", "Avg Daily Range 20d", "Price Range 63d", "Volatility 63d", "Downside Vol 63d", "Max Drawdown 63d", "Return/Vol 3M", "Return/Drawdown 3M", "Risk/Reward Score", "Weinstein", "Minervini", "Momentum", "Risk", "Volume", "Liquidity", "Sector Score", "Setup Quality", "Demand", "Growth", "IPO Score", "Composite", "Legacy Total", "Composite Label", "Reasons", "Risks"];
    const lines = filteredRows.map((r, i) => [i + 1, r.symbol, r.companyName, r.businessEs, r.theme, r.country, r.sector, r.industry, r.ipoCategory, r.ipoDate, r.ipoAgeMonths, r.benchmarkSymbol, r.dataCoverageScore, r.technicalCoverageScore, r.fundamentalCoverageScore, (r.dataCoverageIssues || []).join(" | "), r.rsRating, r.rsGlobalPct, r.rsCountryPct, r.rsSectorPct, r.rsQualityScore, r.rsStabilityScore, r.speculationRiskScore, r.rsQualityLabel, r.weaknessScore, r.weaknessLabel, (r.weaknessReasons || []).join(" | "), r.rsGlobalSample, r.rsCountrySample, r.rsSectorSample, r.rs3m, r.rs6m, r.rs12m, r.distance20d, r.distance50d, r.distance52w, r.distanceATH, r.highsSpreadPct, r.perf3m, r.perf6m, r.perf12m, r.extSma50, r.avgVolume, r.latestVolume, r.avgTurnover, r.latestTurnover, r.upDownVolRatio, r.relativeVolume, r.volumeSurgePct, r.volumeEffectScore, r.adProxyScore, r.epsGrowthProxyScore, r.volumeEvidence, r.shortPercentOfFloat, r.shortRatio, r.sharesShort, r.floatShares, r.upVolume, r.maxDailyMove20dPct, r.maxDailyRange20dPct, r.avgDailyRange20dPct, r.range63dPct, r.volatility63d, r.downsideVolatility63d, r.maxDrawdown63d, r.returnToVol3m, r.returnToDrawdown3m, r.riskRewardScore, r.weinsteinScore, r.minerviniScore, r.momentumScore, r.riskScore, r.volumeScore, r.liquidityScore, r.sectorScore, r.setupQualityScore, r.demandScore, r.growthScore, r.ipoScore, r.totalScore, r.legacyTotalScore, r.compositeLabel, (r.compositeReasons || []).join(" | "), (r.compositeRisks || []).join(" | ")].map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(","));
    const blob = new Blob([[h.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "statsedge-screener.csv"; a.click(); URL.revokeObjectURL(url);
  }

  const filtered = useMemo(() => {
    let l = [...rows];
    if (viewLayers.country && countryFilter !== "Todos") l = l.filter((r) => (r.country || countryCode(r.symbol)) === countryFilter);
    if (viewLayers.theme && themeFilter !== "Todos") l = l.filter((r) => r.theme === themeFilter);
    if (viewLayers.sector && sectorFilter !== "Todos") l = l.filter((r) => r.sector === sectorFilter);
    if (viewLayers.industry && industryFilter !== "Todos") l = l.filter((r) => r.industry === industryFilter);
    if (viewLayers.sectorStrength) l = l.filter((r) => passesSectorStrength(r, sectorStrength));
    if (viewLayers.ipo && ipo !== "Todos") l = l.filter((r) => r.ipoCategory === ipo);
    return l.sort((a, b) => (b[sort] || 0) - (a[sort] || 0));
  }, [rows, countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, sort, viewLayers]);
  const totalResultPages = Math.max(1, Math.ceil(filtered.length / resultPageSize));
  const visibleResultPage = Math.min(resultPage, totalResultPages);
  const resultPageStart = (visibleResultPage - 1) * resultPageSize;
  const resultPageEnd = Math.min(resultPageStart + resultPageSize, filtered.length);
  const pagedRows = filtered.slice(resultPageStart, resultPageEnd);
  const setResultPageClamped = (page) => setResultPage(Math.max(1, Math.min(page, totalResultPages)));
  function updateResultPageSize(size) {
    const nextSize = RESULT_PAGE_SIZES.includes(size) ? size : DEFAULT_RESULT_PAGE_SIZE;
    setResultPageSize(nextSize);
    setResultPage(1);
  }
  const opportunities = useMemo(() => opportunityBuckets(filtered), [filtered]);
  useEffect(() => {
    setResultPage(1);
  }, [countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, sort, resultPageSize]);
  useEffect(() => {
    if (resultPage > totalResultPages) setResultPage(totalResultPages);
  }, [resultPage, totalResultPages]);
  useEffect(() => {
    if (!filtered.length) {
      if (activePreviewRow) setActivePreviewRow(null);
      return;
    }
    if (!activePreviewRow || !filtered.some((r) => r.symbol === activePreviewRow.symbol)) {
      setActivePreviewRow(filtered[0]);
    }
  }, [filtered, activePreviewRow]);
  const cleanOption = (value, emptyLabel) => value && value !== emptyLabel ? value : "";
  const themeOptions = useMemo(() => ["Todos", ...Array.from(new Set(rows.map((r) => cleanOption(r.theme, "General")).filter(Boolean))).sort()], [rows]);
  const sectorOptions = useMemo(() => ["Todos", ...Array.from(new Set(rows
    .filter((r) => themeFilter === "Todos" || r.theme === themeFilter)
    .map((r) => cleanOption(r.sector, "Sin sector"))
    .filter(Boolean))).sort()], [rows, themeFilter]);
  const industryOptions = useMemo(() => ["Todos", ...Array.from(new Set(rows
    .filter((r) => themeFilter === "Todos" || r.theme === themeFilter)
    .filter((r) => sectorFilter === "Todos" || r.sector === sectorFilter)
    .map((r) => cleanOption(r.industry, "Sin industria"))
    .filter(Boolean))).sort()], [rows, themeFilter, sectorFilter]);
  const countryOptions = useMemo(() => {
    const codes = Array.from(new Set(rows.map((r) => r.country || countryCode(r.symbol)).filter(Boolean)));
    codes.sort((a, b) => {
      const ai = MARKET_ORDER.indexOf(a), bi = MARKET_ORDER.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return marketName(a).localeCompare(marketName(b));
    });
    return ["Todos", ...codes];
  }, [rows]);
  const countryRank = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      const code = r.country || countryCode(r.symbol);
      const bucket = map.get(code) || { code, count: 0, avg: 0, rs: 0, p3: 0, leaders: 0, top: null };
      bucket.count += 1;
      bucket.avg += r.totalScore || 0;
      bucket.rs += r.rsCountryPct || r.rsGlobalPct || r.rsRating || 0;
      bucket.p3 += r.perf3m || 0;
      if ((r.totalScore || 0) >= 65) bucket.leaders += 1;
      if (!bucket.top || (r.totalScore || 0) > (bucket.top.totalScore || 0)) bucket.top = r;
      map.set(code, bucket);
    });
    return [...map.values()]
      .map((x) => ({ ...x, avg: x.avg / x.count, rs: x.rs / x.count, p3: x.p3 / x.count, leaderPct: (x.leaders / x.count) * 100 }))
      .sort((a, b) => (b.avg - a.avg) || (b.leaderPct - a.leaderPct));
  }, [rows]);
  const searchScopeItems = useMemo(() => {
    const q = searchText(searchSymbol);
    if (q.length < 2) return [];
    const score = (text = "") => {
      const value = searchText(text);
      if (!value) return 0;
      if (value === q) return 120;
      if (value.startsWith(q)) return 90;
      if (value.includes(q)) return 55;
      return 0;
    };
    const byField = (field) => {
      const map = new Map();
      rows.forEach((row) => {
        const value = row[field];
        if (!value || value === "General" || value === "Sin sector" || value === "Sin industria") return;
        const bucket = map.get(value) || { value, count: 0, top: null };
        bucket.count += 1;
        if (!bucket.top || (row.totalScore || 0) > (bucket.top.totalScore || 0)) bucket.top = row;
        map.set(value, bucket);
      });
      return [...map.values()];
    };
    const countryCounts = new Map();
    rows.forEach((row) => {
      const code = row.country || countryCode(row.symbol);
      countryCounts.set(code, (countryCounts.get(code) || 0) + 1);
    });
    const items = [];
    MARKETS.forEach(([code, name]) => {
      const haystack = `${code} ${name} ${MARKET_META[code]?.exchange || ""} ${MARKET_META[code]?.region || ""}`;
      const s = score(haystack);
      if (!s) return;
      const count = countryCounts.get(code) || 0;
      items.push({
        type: "country",
        value: code,
        label: name,
        icon: marketFlag(code),
        detail: count ? `${count} acciones analizadas` : `${MARKET_META[code]?.exchange || "mercado"} · cargar universo`,
        score: s + (count ? 8 : 0),
      });
    });
    const groups = [
      ["theme", "theme", "Tema", "Tema"],
      ["sector", "sector", "Sector", "Sector"],
      ["industry", "industry", "Subsector", "Sub"],
    ];
    groups.forEach(([type, field, detailLabel, icon]) => {
      byField(field).forEach((bucket) => {
        const s = score(`${bucket.value} ${detailLabel}`);
        if (!s) return;
        items.push({
          type,
          value: bucket.value,
          label: bucket.value,
          icon,
          detail: `${detailLabel} · ${bucket.count} resultados${bucket.top?.symbol ? ` · lider ${bucket.top.symbol}` : ""}`,
          score: s + Math.min(bucket.count, 20),
        });
      });
    });
    rows.slice(0, 500).forEach((row) => {
      const s = score(`${row.symbol} ${row.companyName || ""} ${row.theme || ""} ${row.sector || ""} ${row.industry || ""}`);
      if (!s) return;
      items.push({
        type: "stock",
        value: row.symbol,
        name: row.companyName,
        label: `${row.symbol} · ${row.companyName || row.symbol}`,
        icon: "Accion",
        detail: [row.country || countryCode(row.symbol), row.theme || row.sector, row.industry].filter(Boolean).join(" · "),
        score: s + 10,
      });
    });
    return items
      .sort((a, b) => (b.score - a.score) || a.label.localeCompare(b.label))
      .filter((item, index, array) => array.findIndex((other) => other.type === item.type && other.value === item.value) === index)
      .slice(0, 10);
  }, [searchSymbol, rows]);
  const recentIpoRows = useMemo(() => rows.filter((r) => isRecentIpoDate(r.ipoDate, 60)), [rows]);
  const ipos = useMemo(() => ["Todos", ...Array.from(new Set(recentIpoRows.map((r) => r.ipoCategory))).sort()], [recentIpoRows]);
  const secSum = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { const x = m.get(r.theme) || { theme: r.theme, count: 0, avg: 0, p3: 0 }; x.count++; x.avg += r.totalScore; x.p3 += r.perf3m || 0; m.set(r.theme, x); });
    return [...m.values()].map((x) => ({ ...x, avg: x.avg / x.count, p3: x.p3 / x.count })).sort((a, b) => b.avg - a.avg);
  }, [rows]);
  const ipoSum = useMemo(() => {
    const m = new Map();
    recentIpoRows.forEach((r) => { const x = m.get(r.ipoCategory) || { cat: r.ipoCategory, count: 0, avg: 0 }; x.count++; x.avg += r.totalScore; m.set(r.ipoCategory, x); });
    return [...m.values()].map((x) => ({ ...x, avg: x.avg / x.count })).sort((a, b) => b.avg - a.avg);
  }, [recentIpoRows]);
  useEffect(() => {
    if (countryFilter !== "Todos" && !countryOptions.includes(countryFilter)) setCountryFilter("Todos");
    if (themeFilter !== "Todos" && !themeOptions.includes(themeFilter)) setThemeFilter("Todos");
    if (sectorFilter !== "Todos" && !sectorOptions.includes(sectorFilter)) setSectorFilter("Todos");
    if (industryFilter !== "Todos" && !industryOptions.includes(industryFilter)) setIndustryFilter("Todos");
    if (ipo !== "Todos" && !ipos.includes(ipo)) setIpo("Todos");
  }, [countryFilter, countryOptions, themeFilter, themeOptions, sectorFilter, sectorOptions, industryFilter, industryOptions, ipo, ipos]);
  const failSummary = useMemo(() => {
    const map = new Map();
    fail.forEach((item) => {
      const kind = failureKind(item.reason);
      const bucket = map.get(kind.key) || { ...kind, count: 0, examples: [] };
      bucket.count += 1;
      if (bucket.examples.length < 8) bucket.examples.push(item.symbol);
      map.set(kind.key, bucket);
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [fail]);
  const analysisSize = universe.length ? selected(universe).length : 0;
  const batchLabel = universe.length ? scanMode === "all" ? `Todo / ${universe.length}` : `${batchStart + 1}-${Math.min(batchStart + scanBatchSize, universe.length)} / ${universe.length}` : "-";
  const modalReviewRows = quickReviewRows.length ? quickReviewRows : (activeModalRow ? [activeModalRow] : []);
  const modalReviewIndex = activeModalRow ? modalReviewRows.findIndex((row) => row.symbol === activeModalRow.symbol) : -1;
  const modalReviewPosition = modalReviewIndex >= 0 ? modalReviewIndex : quickReviewIndex;

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

  return <main className="page">
    <div className="topbar">
      <h1 className="title">Screener</h1>
      <div className="actions">
        <button className="btn btnMobileOnly" onClick={() => setShowMobileFilters(!showMobileFilters)}>Filtros</button>
        <button className="btn btnPrimary" onClick={() => { setShowMobileFilters(false); run(); }} disabled={running}>{running ? "Escaneando..." : "Ejecutar"}</button>
      </div>
    </div>
    {err && <div className="error">{err}</div>}
    
    <div className={`dashboardContainer ${sidebarCollapsed ? "sidebarCollapsed" : ""}`}>
      <button
        type="button"
        className="sidebarCollapseBtn"
        onClick={() => setSidebarCollapsed((value) => !value)}
        aria-label={sidebarCollapsed ? "Mostrar filtros" : "Ocultar filtros"}
        aria-expanded={!sidebarCollapsed}
      >
        {sidebarCollapsed ? "Filtros" : "‹"}
      </button>
      <aside className={`sidebar ${showMobileFilters ? "mobileOpen" : ""}`}>
        <div className="mobileSidebarHeader">
          <h2>Filtros</h2>
          <button className="btn btnPrimary" onClick={() => { setShowMobileFilters(false); run(); }}>{running ? "..." : "Aplicar"}</button>
        </div>
        <div className="kpis" style={{ marginBottom: 20 }}>
          <div className="kpi"><b>{universe.length}</b><span>universo</span></div>
          <div className="kpi"><b>{rows.length}</b><span>pasan</span></div>
          <div className="kpi"><b>{marketHealth ? Math.round(marketHealth.marketScore) : "-"}</b><span>{marketHealth?.regime?.label || "score"}</span></div>
        </div>
        <div className="sidebarGroup" style={{ marginBottom: 24 }}>
          <label className="field" style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estrategia Base</span>
            <select className="select" value={presetKey} onChange={(e) => setPreset(e.target.value)}>
              {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filtro Técnico</span>
            <select className="select" value={settings.setupMode || "leader"} onChange={(e) => { updateSetting("setupMode", e.target.value); if (e.target.value === "weakness") setSort("weaknessScore"); }}>
              {SETUP_MODES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
        </div>

        <FilterArchitecturePanel
          filterLayers={filterLayers}
          viewLayers={viewLayers}
          useRegimeFilter={useRegimeFilter}
          onToggleLayer={toggleFilterLayer}
          onToggleViewLayer={toggleViewLayer}
          onToggleRegime={() => setUseRegimeFilter((prev) => !prev)}
          executionRuleActive={executionRuleActive}
          executionRuleTotal={executionRuleTotal}
          viewFiltersActive={viewFiltersActive}
        />

        <div className="sidebarGroup" style={{ marginBottom: 24 }}>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Condiciones</span>
          <div className="filterSwitches">
            <FilterToggle active={settings.requireStage2} onClick={() => updateSetting("requireStage2", !settings.requireStage2)}>Stage 2</FilterToggle>
            <FilterToggle active={settings.requireUpVolume} onClick={() => updateSetting("requireUpVolume", !settings.requireUpVolume)}>Volumen en vela alcista</FilterToggle>
            <FilterToggle active={settings.requireRecentIpo} onClick={() => updateSetting("requireRecentIpo", !settings.requireRecentIpo)}>IPO real reciente</FilterToggle>
          </div>
          
          <details className="advancedFiltersDetails" style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', color: '#a1a1aa', fontSize: 12, fontWeight: 500, display: 'inline-block', borderBottom: '1px dashed rgba(255,255,255,.2)', paddingBottom: 2 }}>Ajustes finos ({fineRuleActive}/{fineRuleTotal})</summary>
            <div className="filterGroups" style={{ marginTop: 16 }}>
              {FILTER_GROUPS.map((group) => {
                const activeInGroup = group.fields.filter((field) => isFieldRuleActive(field, fieldRules, filterLayers)).length;
                return <div className="filterGroup" key={group.title}>
                  <div className="filterGroupHead"><h3>{group.title}</h3><span>{activeInGroup}/{group.fields.length}</span></div>
                  <div className="filterFields">{group.fields.map((field) => <FilterNumber key={field.key} field={field} value={settings[field.key]} onChange={updateSetting} active={isFieldRuleActive(field, fieldRules, filterLayers)} inactiveReason={inactiveFieldReason(field, fieldRules, filterLayers)} onToggle={() => toggleFieldRule(field)} />)}</div>
                </div>;
              })}
            </div>
            <div className="controls filterFooter" style={{ marginTop: 12 }}>
              <button className="btn btnGhost btnSmall" style={{ width: "100%" }} onClick={() => { setSettings({ ...PRESETS[presetKey].v }); setFieldRules(DEFAULT_FIELD_RULES); }}>Resetear condiciones</button>
            </div>
          </details>
        </div>

        <div className="sidebarGroup" style={{ marginBottom: 24 }}>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Mercados ({markets.length})</span>
          <div className="controls" style={{ marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
            <button className="btn btnGhost btnSmall" onClick={() => marketPreset("global")}>Global</button>
            <button className="btn btnGhost btnSmall" onClick={() => marketPreset("us")}>EEUU</button>
            <button className="btn btnGhost btnSmall" onClick={() => marketPreset("europe")}>Europa</button>
            <button className="btn btnGhost btnSmall" onClick={() => marketPreset("asia")}>Asia</button>
            <button className="btn btnGhost btnSmall" onClick={() => marketPreset("hk")}>HK</button>
            <a className="btn btnGhost btnSmall" href="/ipo-radar">IPO Radar</a>
            <button className="btn btnSmall" onClick={loadUniverse} disabled={running}>Cargar</button>
          </div>
          <div className="marketSelector" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {MARKETS.map(([c, n]) => {
              const active = markets.includes(c);
              return <button key={c} className={`marketChip ${active ? "active" : ""}`} style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => setMarkets((p) => active ? p.filter((x) => x !== c) : [...p, c])}>
                <span>{c}</span>
              </button>;
            })}
          </div>
        </div>

        <details className="disclosurePanel compactDisclosure" style={{ marginBottom: 20 }}>
          <summary><span>Cobertura y alcance</span></summary>
          <div className="grid" style={{ gap: 8 }}>
            <select className="select" value={scanMode} onChange={(e) => { setScanMode(e.target.value); setBatchStart(0); }}><option value="batch">Por lote</option><option value="random">Aleatorio</option><option value="all">Todo el universo</option></select>
            <select className="select" value={scanBatchSize} onChange={(e) => { setScanBatchSize(Number(e.target.value)); setBatchStart(0); }} aria-label="Tickers por lote">
              {SCAN_BATCH_SIZES.map((size) => <option key={size} value={size}>{size} tickers por lote</option>)}
            </select>
            <input className="input" type="number" value={batchStart} placeholder="Inicio" onChange={(e) => setBatchStart(Number(e.target.value) || 0)} />
            <button className="btn btnGhost" onClick={nextBatch} disabled={running || !universe.length}>Siguiente lote</button>
          </div>
        </details>
        <details className="disclosurePanel" style={{ marginTop: 12 }}>
          <summary><span>Ranking por pais</span><em>{countryRank.length} paises</em></summary>
          {countryRank.length ? <div className="countryRankGrid">
            {countryRank.slice(0, 12).map((x, index) => <button key={x.code} className={`countryRankCard ${viewLayers.country && countryFilter === x.code ? "active" : ""}`} onClick={() => { setViewLayers((prev) => ({ ...prev, country: true })); setCountryFilter(x.code); }}>
              <div className="countryRankTop">
                <span className="marketFlag">{marketFlag(x.code)}</span>
                <div><b>{index + 1}. {marketName(x.code)}</b><em>{x.code}</em></div>
                <strong>{x.avg.toFixed(0)}</strong>
              </div>
            </button>)}
          </div> : <p className="fine" style={{fontSize:11}}>—</p>}
        </details>
      </aside>

      <main className="mainContent">
        <section className="searchCard" style={{ marginBottom: 20 }}>
          <div className="commandSearchPanel searchPanelBare">
              <form className="searchBar" onSubmit={runSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input className="input searchInput" value={searchSymbol} onChange={(e) => updateSearchSymbol(e.target.value)} placeholder="Ticker, nombre, sector, subsector o pais..." />
                {(searchSymbol || searchCandidates.length || searchResult) && <button type="button" className="btn btnGhost" onClick={clearSearch}>Limpiar</button>}
                <button className="btn btnPrimary" disabled={searchLoading}>{searchLoading ? "Buscando..." : "Buscar"}</button>
              </form>
              <SearchScopeList items={searchScopeItems} onPick={applySearchScope} />
              {searchError && <div className="dataNote error" style={{ marginTop: 12 }}>{searchError}</div>}
              {searchResult ? <div className="searchResult searchResultPrimary">
                <PreviewCard row={searchResult} variant="search" onFavorite={addFavorite} isFavorite={favoriteSymbols.has(searchResult.symbol)} />
              </div> : null}
              <SearchCandidateList candidates={searchCandidates} activeSymbol={searchResult?.symbol} onPick={(item) => { setSearchSymbol(item.symbol); loadSearchResult(item.symbol, item); }} />
          </div>
        </section>

        <section className="mobileResearchHome">
          <MarketMiniTape marketHealth={marketHealth} />
          <SetupChipRail
            rows={filtered}
            presetKey={presetKey}
            setupMode={activeSettings.setupMode}
            sort={sort}
            onPreset={setPreset}
            onMode={(mode) => { updateSetting("setupMode", mode); if (mode === "weakness") setSort("weaknessScore"); }}
            onSort={setSort}
          />
          <MobileResultList
            rows={pagedRows}
            totalRows={filtered.length}
            sort={sort}
            onSort={setSort}
            onReview={(symbol) => openReview(filtered, symbol)}
            onFavorite={addFavorite}
            favoriteSymbols={favoriteSymbols}
            onSave={() => saveSnapshot(filtered)}
            onCsv={() => csv(filtered)}
            page={visibleResultPage}
            pageSize={resultPageSize}
            totalPages={totalResultPages}
            onPage={setResultPageClamped}
            onPageSize={updateResultPageSize}
          />
        </section>

        <section className="desktopResultsSection" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontSize: 13, margin: 0, fontWeight: 600, letterSpacing: '-0.01em' }}>{filtered.length} resultados</h2>
            <div className="controls">
              <button className="btn btnSmall btnGhost" onClick={() => { setViewLayers(DEFAULT_VIEW_LAYERS); setCountryFilter("Todos"); setThemeFilter("Todos"); setSectorFilter("Todos"); setIndustryFilter("Todos"); setSectorStrength("Todos"); setIpo("Todos"); }}>Reset</button>
              <button className="btn btnSmall btnGhost" onClick={resetScreenerSession}>Reset sesión</button>
              <button className="btn btnSmall btnGhost" onClick={() => csv(filtered)}>↓ CSV</button>
              <button className="btn btnSmall btnPrimary" onClick={() => openReview(filtered)} disabled={!filtered.length}>Revisar</button>
              <button className="btn btnSmall" onClick={() => saveSnapshot(filtered)} disabled={!filtered.length} aria-label="Guardar snapshot de resultados">Guardar</button>
            </div>
          </div>
          <div className="controls" style={{ marginBottom: 12 }}>
            <select className="select" style={{ width: "auto", padding: "4px 8px" }} value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
              {countryOptions.map((x) => <option key={x} value={x}>{x === "Todos" ? "Pais: Todos" : x}</option>)}
            </select>
            <select className="select" style={{ width: "auto", padding: "4px 8px" }} value={themeFilter} onChange={(e) => { setThemeFilter(e.target.value); setSectorFilter("Todos"); setIndustryFilter("Todos"); }}>
              {themeOptions.map((x) => <option key={x} value={x}>{x === "Todos" ? "Tema: Todos" : x}</option>)}
            </select>
            <select className="select" style={{ width: "auto", padding: "4px 8px" }} value={sectorFilter} onChange={(e) => { setSectorFilter(e.target.value); setIndustryFilter("Todos"); }}>
              {sectorOptions.map((x) => <option key={x} value={x}>{x === "Todos" ? "Sector: Todos" : x}</option>)}
            </select>
            <select className="select" style={{ width: "auto", padding: "4px 8px" }} value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)}>
              {industryOptions.map((x) => <option key={x} value={x}>{x === "Todos" ? "Subsector: Todos" : x}</option>)}
            </select>
            <select className="select" style={{ width: "auto", padding: "4px 8px" }} value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="totalScore">Ordenar: Composite</option>
              <option value="rsGlobalPct">Ordenar: RS Global</option>
              <option value="adProxyScore">Ordenar: A/D proxy</option>
              <option value="epsGrowthProxyScore">Ordenar: EPS/Growth proxy</option>
              <option value="volumeEffectScore">Ordenar: Volume Effect</option>
              <option value="avgTurnover">Ordenar: Importe 20d</option>
              <option value="shortPercentOfFloat">Ordenar: Short float</option>
              <option value="dataCoverageScore">Ordenar: Cobertura datos</option>
              <option value="weaknessScore">Ordenar: Deterioro</option>
            </select>
          </div>
          <div className="controls" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <span className="fine">
              Mostrando {filtered.length ? resultPageStart + 1 : 0}-{resultPageEnd} de {filtered.length}
            </span>
            <div className="controls">
              <select className="select" style={{ width: "auto", padding: "4px 8px" }} value={resultPageSize} onChange={(e) => updateResultPageSize(Number(e.target.value))} aria-label="Acciones por página">
                {RESULT_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} por página</option>)}
              </select>
              <button className="btn btnSmall btnGhost" onClick={() => setResultPageClamped(visibleResultPage - 1)} disabled={visibleResultPage <= 1}>Anterior</button>
              <span className="fine">Página {visibleResultPage}/{totalResultPages}</span>
              <button className="btn btnSmall btnGhost" onClick={() => setResultPageClamped(visibleResultPage + 1)} disabled={visibleResultPage >= totalResultPages}>Siguiente</button>
            </div>
          </div>
      <CompactResultsTable rows={pagedRows} favoriteSymbols={favoriteSymbols} onFavorite={addFavorite} onReview={(symbol) => openReview(filtered, symbol)} rankOffset={resultPageStart} />
        </section>
      </main>
    </div>
    <footer className="footer" style={{ marginTop: 40, borderTop: "1px solid rgba(255,255,255,.04)", paddingTop: 16, fontSize: 11, opacity: 0.5 }}>StatsEdge · Datos orientativos · {status}</footer>
    
    {activeModalRow && (
      <dialog className="stockModal quickReviewModal" open onClick={(e) => { if (e.target === e.currentTarget) closeQuickReview(); }}>
        <div className="stockModalInner quickReviewInner">
          <div className="profileHeader quickReviewHeader">
            <div className="profileHeaderLeft quickReviewTitleBlock">
              <CompanyMark row={activeModalRow} size="lg" />
              <div>
                <div className="profileHeaderBreadcrumb">
                  Screener <span>/</span> Vista rapida <span>/</span> {modalReviewPosition + 1} de {modalReviewRows.length}
                </div>
                <div className="profileTitle">
                  <h2>{activeModalRow.symbol}</h2>
                  <span>{activeModalRow.companyName}</span>
                </div>
                <div className="profilePrice">
                  <span className="price">{money(activeModalRow.price, activeModalRow.currency)}</span>
                  {Number.isFinite(activeModalRow.perf3m) && (
                    <span className={`change ${activeModalRow.perf3m >= 0 ? "up" : "down"}`}>
                      {activeModalRow.perf3m >= 0 ? "+" : ""}{activeModalRow.perf3m.toFixed(2)}% 3M
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="profileHeaderRight quickReviewActions">
              <button className="btn" onClick={() => moveQuickReview(-1)} disabled={modalReviewRows.length < 2}>Anterior</button>
              <span className="quickReviewCounter">{modalReviewPosition + 1}/{modalReviewRows.length}</span>
              <button className="btn btnPrimary" onClick={() => moveQuickReview(1)} disabled={modalReviewRows.length < 2}>Siguiente</button>
              <a className="btn" href={stockUrl(activeModalRow.symbol)}>Ficha</a>
              <a className="btn" href={externalLinks(activeModalRow.symbol, activeModalRow.exchange).tradingView} target="_blank" rel="noreferrer">TradingView</a>
              <button className="btn" onClick={closeQuickReview}>Cerrar</button>
            </div>
          </div>

          <div className="screenerReviewLayout">
            <aside className="reviewQueue screenerReviewQueue" aria-label="Cola de acciones del screener">
              <div className="reviewQueueHead">
                <h2>Cola</h2>
                <span>{modalReviewRows.length}</span>
              </div>
              <div className="reviewQueueList">
                {modalReviewRows.map((row, index) => (
                  <a
                    key={`${row.symbol}-${index}`}
                    href={stockUrl(row.symbol)}
                    className={`reviewQueueItem ${index === modalReviewPosition ? "active" : ""}`}
                    aria-current={index === modalReviewPosition ? "true" : undefined}
                    title={`Abrir ficha de ${row.symbol}`}
                  >
                    <CompanyMark row={row} size="sm" />
                    <span>
                      <b>{row.symbol}</b>
                      <em>{row.companyName || row.name || row.symbol}</em>
                    </span>
                    <i>{Number.isFinite(row.totalScore) ? Math.round(row.totalScore) : "-"}</i>
                  </a>
                ))}
              </div>
            </aside>

            <div className="screenerReviewMain">
              <div className="profileGrid quickReviewGrid">
                <div className="profileChartArea">
                  <ChartPreferences settings={chartSettings} onChange={updateChartSettings} symbol={activeModalRow.symbol} listId={chartListId} scope={chartScope} onScopeChange={updateChartScope} compact />
                  <div className="quickReviewChart">
                    <TradingViewPreviewChart row={activeModalRow} chartSettings={chartSettings} />
                  </div>
                  <div className="perfStrip">
                    <div className="perfBox"><span>1S</span><b className={(activeModalRow.perf1w || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf1w || 0)}</b></div>
                    <div className="perfBox"><span>1M</span><b className={(activeModalRow.perf1m || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf1m || 0)}</b></div>
                    <div className="perfBox"><span>3M</span><b className={(activeModalRow.perf3m || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf3m || 0)}</b></div>
                    <div className="perfBox"><span>6M</span><b className={(activeModalRow.perf6m || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf6m || 0)}</b></div>
                    <div className="perfBox"><span>YTD</span><b className={(activeModalRow.perfYtd || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perfYtd || 0)}</b></div>
                    <div className="perfBox"><span>1A</span><b className={(activeModalRow.perf12m || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf12m || 0)}</b></div>
                  </div>
                </div>

                <div className="profileSide">
                  <div className="profileCard">
                    <div className="profileCardHeader">
                      <h3>Métricas técnicas</h3>
                      <span>Score</span>
                    </div>
                    <div className="profileRow"><span>Capitalización</span><b>{amount(activeModalRow.marketCap, activeModalRow.currency) || "-"}</b></div>
                    <div className="profileRow"><span>Composite</span><b className="up">{activeModalRow.totalScore?.toFixed(0) || "-"}</b></div>
                    <div className="profileRow"><span>RS global</span><b>{activeModalRow.rsGlobalPct?.toFixed(0) || "-"}</b></div>
                    <div className="profileRow"><span>RS quality</span><b>{activeModalRow.rsQualityScore?.toFixed(0) || "-"}</b></div>
                    <div className="profileRow"><span>A/D proxy</span><b>{activeModalRow.adProxyScore?.toFixed(0) || "-"}</b></div>
                    <div className="profileRow"><span>EPS/Growth proxy</span><b>{activeModalRow.epsGrowthProxyScore?.toFixed(0) || "-"}</b></div>
                    <div className="profileRow"><span>Setup quality</span><b>{activeModalRow.setupQualityScore?.toFixed(0) || "-"}</b></div>
                    <div className="profileRow"><span>Growth</span><b>{activeModalRow.growthScore?.toFixed(0) || "-"}</b></div>
                    <div className="profileRow"><span>Rentabilidad/riesgo</span><b>{activeModalRow.riskRewardScore?.toFixed(0) || "-"}</b></div>
                  </div>

                  <div className="profileCard">
                    <div className="profileCardHeader">
                      <h3>Volumen y riesgo</h3>
                      <span>Datos</span>
                    </div>
                    <div className="profileRow"><span>Volumen sesión</span><b>{amount(activeModalRow.latestTurnover, activeModalRow.currency)}</b></div>
                    <div className="profileRow"><span>Volumen 5d</span><b className={(activeModalRow.volumeSurgePct || 0) > 0 ? "up" : ""}>{pct(activeModalRow.volumeSurgePct)}</b></div>
                    <div className="profileRow"><span>Up/down ratio</span><b>{ratioLabel(activeModalRow.upDownVolRatio)}</b></div>
                    <div className="profileRow"><span>Short float</span><b>{pct(activeModalRow.shortPercentOfFloat)}</b></div>
                    <div className="profileRow"><span>Drawdown 3M</span><b className="down">{Number.isFinite(activeModalRow.maxDrawdown63d) ? `${activeModalRow.maxDrawdown63d.toFixed(1)}%` : "-"}</b></div>
                    <div className="profileRow"><span>Volatilidad</span><b>{Number.isFinite(activeModalRow.volatility63d) ? `${activeModalRow.volatility63d.toFixed(1)}%` : "-"}</b></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </dialog>
    )}
  </main>;
}
