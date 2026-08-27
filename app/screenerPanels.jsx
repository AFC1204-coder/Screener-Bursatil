"use client";

// app/screenerPanels.jsx — barrel de re-export para compatibilidad.
// Toda la presentación y lógica de vista vive ahora en módulos bajo lib/:
//   lib/screenerFormat.js            — helpers de formato/texto
//   lib/screenerAtoms.jsx            — primitivas UI compartidas
//   lib/screenerResultView.js        — lógica de vista de resultados
//   lib/screenerDomains/{decision,audit,dataHealth}.jsx — componentes de dominio
//   lib/screenerTable.jsx            — tabla de resultados
//   lib/screenerMarket.jsx           — tarjetas/charts/leaders
//   lib/screenerMobile.jsx           — superficie móvil
//   lib/screenerSearch.jsx           — búsqueda de símbolos
//   lib/screenerFilters.jsx          — paneles/controles de filtros
// Este archivo re-exporta los símbolos públicos para no romper consumidores
// existentes que importan desde @/app/screenerPanels. Nuevos consumidores
// deberían importar directamente del módulo correspondiente.

import RowTrustSignature from "@/app/RowTrustSignature";
import { InfoHint } from "@/app/components/ui/InfoHint";
import { buildRowTrustSignature } from "@/lib/rowTrustSignature";
import { DECISION_PROFILE_ORDER, buildReviewProfileSummary, decisionProfileForRow, decisionProfileLabel, prepareReviewQueueRows, reviewProfileMeta } from "@/lib/decisionProfile";
import {
  activeLayerCount,
  amount,
  cap,
  chartPath,
  compactPatternDetail,
  compactPatternReason,
  compactTone,
  companyLogoDomain,
  initials,
  investorStatusLabel,
  layerStatusText,
  money,
  quickBusinessDescription,
  quickBusinessMarket,
  quickSetup,
  ratioLabel,
  ruleCountLabel,
  searchText,
  shortBusiness,
  sleep,
} from "@/lib/screenerFormat";
import {
  CompanyMark,
  CompactMetric,
  DecisionIssueBadge,
  MiniSparkline,
  ObjectiveMetricTruthPill,
  ReviewFocusPill,
  VcpReliabilityPill,
} from "@/lib/screenerAtoms";
import {
  DecisionOperatingBrief,
  DecisionQualityStrip,
  DecisionSummaryRail,
  PendingDecisionWorkRail,
} from "@/lib/screenerDomains/decision";
import {
  AuditabilitySummaryRail,
  DecisionEvidenceChecklist,
  DecisionEvidenceSummaryRail,
  ScoreAuditPanel,
  ScoreAuditSummaryRail,
} from "@/lib/screenerDomains/audit";
import { DataHealthPanel, DataHealthSummaryRail } from "@/lib/screenerDomains/dataHealth";
import { CompactCountryFlag, CompactResultsTable } from "@/lib/screenerTable";
import {
  LeaderTape,
  MarketMiniTape,
  OpportunityMap,
  PreviewCard,
  QuickPanel,
  ScoreLine,
  RowPreviewChart,
  ipoVerificationText,
} from "@/lib/screenerMarket";
import { MobileMoverCard, MobileResultList, MobileResultRow, MobileTopMovers, RegimeStrip } from "@/lib/screenerMobile";
import { SearchCandidateList, SearchScopeList } from "@/lib/screenerSearch";
import {
  FilterArchitecturePanel,
  FilterDiagnosticsPanel,
  FilterFamilyModal,
  FilterNumber,
  FilterTemplatePanel,
  OptionalBasePresetsPanel,
  FilterToggle,
  LayerControl,
  LayerToggleButton,
  ResultFilterChips,
  ScreenerContractPanel,
  SetupChipRail,
} from "@/lib/screenerFiltersView";

export {
  money, cap, amount, sleep, searchText, investorStatusLabel, InfoHint, ratioLabel,
  ipoVerificationText, initials, shortBusiness, quickBusinessDescription,
  quickBusinessMarket, chartPath, MiniSparkline, RowPreviewChart, companyLogoDomain,
  CompanyMark, quickSetup, compactPatternReason, compactPatternDetail, LeaderTape,
  ScoreLine, OpportunityMap, MarketMiniTape, SetupChipRail,
  MobileMoverCard, MobileTopMovers, MobileResultRow, buildRowTrustSignature, RowTrustSignature, DecisionQualityStrip, DecisionOperatingBrief, DecisionSummaryRail, DecisionEvidenceChecklist, DecisionEvidenceSummaryRail, DataHealthPanel, DataHealthSummaryRail, ScoreAuditPanel, ScoreAuditSummaryRail, AuditabilitySummaryRail, MobileResultList, RegimeStrip,
  PendingDecisionWorkRail,
  QuickPanel, PreviewCard, SearchCandidateList, SearchScopeList, compactTone, CompactMetric,
  DecisionIssueBadge, ResultFilterChips, ScreenerContractPanel,
  FilterTemplatePanel, OptionalBasePresetsPanel, FilterFamilyModal, CompactCountryFlag, CompactResultsTable,
  FilterNumber, FilterToggle, LayerToggleButton, LayerControl, FilterArchitecturePanel,
  FilterDiagnosticsPanel, activeLayerCount, ruleCountLabel, layerStatusText,
  DECISION_PROFILE_ORDER, buildReviewProfileSummary, decisionProfileForRow, decisionProfileLabel, prepareReviewQueueRows, reviewProfileMeta,
};
