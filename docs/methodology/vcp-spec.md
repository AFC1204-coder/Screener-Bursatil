# VCP Operational Specification

This spec translates Mark Minervini-style Volatility Contraction Pattern evidence into StatsEdge rules. It is intentionally conservative: the app should classify evidence, not claim a trade setup when the structure is only a normal advance with small pullbacks.

## Research Basis

- Local sources: `research/books/mark minervini.pdf`, `research/books/Think & trade like a champion .pdf`, and extracted notes in `research/notes/`.
- Web references reviewed for implementation vocabulary and common practitioner thresholds: [TraderLion VCP guide](https://traderlion.com/technical-analysis/volatility-contraction-pattern/), [TradingSim VCP guide](https://www.tradingsim.com/blog/volatility-contraction-pattern), and [FinWiz VCP pattern guide](https://finwiz.io/chart-patterns/vcp-pattern).
- Shared definition: VCP is a base/consolidation after a prior advance where price volatility contracts through successive pullbacks, volume dries up into the right side, and the final pivot area becomes tight. A simple dip during a persistent uptrend is not enough.

## Classification States

- `data`: price history, freshness, OHLC, or volume is not reliable enough for a pattern claim.
- `trend_no_base`: prior trend exists, but recent action is still a persistent advance or has no validated base ceiling.
- `base_structure`: a consolidation exists, but contractions are not yet sufficient or regular.
- `base_measurable`: structure is measurable but too far from pivot for watch/action.
- `pivot_squeeze`: at least two meaningful, decreasing contractions or equivalent tight pivot evidence inside a base.
- `vcp_watch`: constructive VCP-like base; useful for monitoring, not automatically a plan.
- `vcp_strict`: three or more meaningful decreasing contractions, dry-up, controlled base depth, and near-pivot structure.
- `breakout_observed` / `failed_breakout`: price interaction with pivot has already happened and must be labelled separately.

## Valid VCP Gates

1. Data gate: enough recent daily bars, fresh price, reliable OHLC, and at least partial volume.
2. Prior trend gate: VCP should occur after leadership/Stage 2 context, not inside broken long-bias structures.
3. Consolidation gate: recent window must show a base, ceiling/pivot area, range compression, or a tight right side. Persistent advances with many new highs remain `trend_no_base`.
4. Meaningful contraction gate: a contraction must be a local high-to-low pullback inside the recent base, above an ATR-derived floor. Current implementation uses roughly `clamp(ATR20 * 0.9, 2.4%, 5.5%)`, with a small allowance for tight right-side action.
5. Structural sequence gate: later contractions must remain under the same base/pivot ceiling, hold the base floor, avoid meaningful lower-low drift, and be separated enough to avoid counting pivot noise twice.
6. Depth sequence gate: contractions must decrease materially. The current rule accepts each later contraction only if it is at least about 8% smaller than the prior one or at least 1 percentage point shallower.
7. Count gate: one contraction is never VCP; two decreasing contractions can be pivot/watch evidence only; strict VCP requires at least three meaningful decreasing contractions.
8. Volume gate: dry-up into the base is required for strict claims. Partial volume can keep a row observable, but blocks plan-valid/actionable wording.
9. Pivot gate: watch/action states require price near a clear pivot and not materially extended above it.

## Explicit False-Positive Rules

- Do not infer a VCP from two shallow dips if the base window is still a persistent advance with many new highs and no established ceiling.
- Do not count pullbacks outside the recent base as current VCP contractions.
- Do not promote a descending range to VCP merely because pullback percentages shrink; lower-low drift means the base floor is not yet constructive.
- Do not call irregular sequences VCP when contraction depths expand or re-widen.
- Do not label a tight base as `vcp_strict` without three meaningful decreasing contractions.
- Do not show plan-valid wording when data is stale, partial enough to block pattern claims, or pivot quality is weak.

## Current Code Contract

- Pattern measurement: `lib/setupPatterns.js`.
- Narrative and strict rejection: `lib/patternNarrative.js`.
- Watch/actionable verdicts: `lib/methodologyVerdict.js` and `lib/methodologyDisplay.js`.
- Compact diagnostic snapshot: `lib/vcpDiagnostics.js`.
- Regression coverage: `scripts/pattern-detector-regression.mjs`.
- Real ticker corpus: `docs/methodology/vcp-corpus.json`, using fixed as-of dates and daily refreshed bars for calibration.
- Corpus audit: `npm run audit:vcp:corpus`, with latest output in `docs/methodology/latest-vcp-corpus-audit.md`; the current guardrail expects 18/18 cases with zero mismatches.
- Visual audit artifacts: `docs/methodology/vcp-visuals/*.svg`, one compact chart per corpus case, linked from the audit table.
- Visual audit path: stock chart `VCP` toggle shows C1/C2/C3 markers, pivot line, and compact diagnostic gates without changing filters or verdicts.
