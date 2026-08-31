# StatsEdge Market Leadership Framework

StatsEdge is a global research terminal for independent investors. It should surface objective evidence of leadership, deterioration, context and data quality without issuing buy/sell recommendations.

This framework converts Weinstein/Minervini-style principles into measurable product behavior.

## 1. Market Condition First

The app should evaluate the market before ranking individual stocks. A strong stock in a hostile market can still be useful research, but the UI should make the market context visible.

Core evidence:

- Index price vs SMA50/SMA200.
- SMA200 slope.
- Percentage of indexes above SMA50/SMA200.
- Market score and regime.
- Sector participation.
- Leaders holding near highs.
- Leaders breaking key averages.
- Distribution-like pressure: downside price action with elevated volume.
- Failed breakout pressure.
- News/social mood as contextual sentiment, not a timing signal.

UI label examples:

- `Constructive`
- `Mixed`
- `Under pressure`
- `Defensive`
- `Leadership improving`
- `Leadership narrowing`

## 2. Global Leadership

The main advantage of StatsEdge is global coverage, especially for investors in Spain who want more than US-only screens.

Every stock should be comparable across:

- Global universe.
- Country/local market.
- Region.
- Sector.
- Industry/theme.
- Benchmark: ACWI, SPY, QQQ or local index when available.

Required metrics:

- `RS 1-99`
- `RS Pais 1-99`
- `RS Grupo 1-99`
- `RS Industry/Theme 1-99`
- `RS Benchmark 1-99`
- `RS 1M/3M/6M/12M vs benchmark`
- `RS trend vs previous snapshot`

Rules:

- `RS` is the primary, stable metric shown by the product. It is a percentile inside the current analyzed universe and is null when the sample is below the minimum universe size. It must not be replaced by benchmark RS in labels, filters, or chart priority areas.
- `RS Pais` and `RS Grupo` are scoped percentiles. They are null when the local scope has too few comparable stocks.
- `RS Benchmark` is a 1-99 derived score from relative performance versus the selected benchmark plus price/trend posture. It is not a universe percentile and is secondary context.
- The chart shows `RS` first when available. The benchmark line is a secondary price/benchmark ratio rebased to 100; it is visual evidence, not the same number as `RS` or `RS Benchmark`.
- Composite and weakness logic may use an explicitly internal fallback (`RS`, then `RS Benchmark`) when a score needs continuity, but user-facing primary RS remains `RS` or `sin dato`.

The app should not say "this is the best stock to buy." It should say "this stock ranks in the top X percentile for this universe."

## 3. Stage And Trend Structure

Weinstein-style stage analysis should be treated as a technical state machine, not as advice.

Evidence:

- Price above/below SMA50/SMA150/SMA200.
- SMA50/SMA150/SMA200 alignment.
- SMA200 slope.
- Distance to 52-week high.
- Advance from 52-week low.
- Stage approximation.

Stage labels:

- `Stage 2`
- `Base / transition`
- `Weak / mixed`
- `Stage 4`
- `Insufficient history`

### Stage health index (MET-5)

Question: how firmly does the value sustain the stage it is in?

- Scope: **Stage 2 and Stage 4 only**. Integer 0–100; weighted sum, not a verdict or traffic light.
- Formula: `round(25·p30 + 10·p10 + 20·accel + 25·vol + 20·ext)` — constants in `lib/stageHealth.js`.
- Components (all read in the **direction of the stage**):
  - **30-week MA persistence** (25): `min(weeks on stage side / 26, 1)`.
  - **10-week MA persistence** (10): full ramp if on stage side; **0** if on the wrong side.
  - **Acceleration** (20): recent vs prior 3-month advance; dead band 5 pp; sign inverted in Stage 4.
  - **Volume** (25): 50-session up/down ratio; Stage 4 uses mirrored thresholds (same constants as trend support).
  - **Extension** (20): `|distance to 30-week MA|`; ≤15% → 1; linear ramp to 0 at ≥50%.
- **Stage 4 mirror**: same numbers, decline direction — slowing advance and selling volume score higher health.
- **All-or-nothing**: if any component is missing, there is no index — only an absence reason (no renormalization).
- **Worked example** (Stage 2): 23 wks above 30w MA, 8 wks above 10w MA, advance “holds”, volume 1.4×, extension +12% → **90/100**.
- **Not in scores**: `stageHealthScore` does not feed `objectiveScore`, `compositeScore`, `weaknessScore`, or hunt filters (v1 = stock card only).

## 4. Setup Quality

Setup quality should measure whether the chart is orderly enough for further research.

Evidence:

- Near 20d/50d/52w high.
- Limited extension above SMA50.
- Tight high spread.
- Controlled pullback.
- Contraction in volatility.
- Volume drying during consolidation.
- Volume expansion on breakout attempt.
- Price holding key moving averages.

Useful labels:

- `Near pivot`
- `Pullback to SMA50`
- `Extended but strong`
- `Early Stage 2`
- `Breakout attempt`
- `Failed breakout`

## 5. Demand And Volume

Volume should be treated as evidence of demand or pressure, never as a standalone signal.

Evidence:

- Average volume.
- Relative volume vs 20d average.
- 5d volume surge vs previous period.
- Up/down volume ratio.
- Higher-volume down days.
- Volume contraction during consolidation.
- Volume expansion during breakout attempt.

## 6. Risk-Adjusted Evidence

Risk matters because high return with extreme volatility may be less useful than controlled leadership.

Evidence:

- Annualized volatility 63d.
- Downside volatility 63d.
- Max drawdown 63d.
- Return/volatility 3M.
- Return/drawdown 3M.
- Extension above SMA50.
- Liquidity and currency risk.

Useful labels:

- `Efficient leadership`
- `High volatility`
- `Drawdown expanding`
- `Extended risk`
- `Controlled pullback`

## 7. Fundamental Evidence

Fundamentals should be a second evidence layer. If the provider does not return data, the UI must say `Sin dato`.

Evidence:

- Revenue growth.
- Earnings growth.
- Gross margin.
- Operating margin.
- Profit margin.
- EBITDA margin.
- ROE / ROA.
- Debt/equity.
- Current ratio.
- Earnings date.
- Historical annual/quarterly statements when available.

Required disclaimer:

`Datos aproximados segun proveedor disponible; no equivalen a ratings propietarios de MarketSurge.`

## 8. Deterioration

The platform should be as good at showing deterioration as it is at showing leadership.

Evidence:

- RS falling.
- Price losing SMA50/SMA200.
- Sector rank falling.
- Failed breakout.
- Higher downside volume.
- Drawdown expanding faster than benchmark.
- Leaders in same group breaking down.
- Market regime worsening.

Useful labels:

- `Deterioration observed`
- `RS weakening`
- `Support lost`
- `Group weakening`
- `Failed setup`

## 9. Data Quality

Professional tools show uncertainty. StatsEdge should show data confidence.

Per stock:

- Price data: OK / partial / unavailable.
- Profile data: OK / partial / unavailable.
- Fundamentals: OK / partial / unavailable.
- IPO date: confirmed / approximate / unavailable.
- TradingView mapping: exact / inferred / fallback.
- Sector/theme: provider / inferred / manual.

## 10. Product Rule

The app should answer:

1. What is the market condition?
2. Which countries/regions lead?
3. Which sectors/themes lead?
4. Which stocks lead within those groups?
5. Which candidates are near an actionable technical area?
6. Which candidates are too extended or volatile?
7. Which favorites are improving or deteriorating?
8. What changed since the last snapshot?
9. Which data is missing or unreliable?

The app should not answer:

- What should I buy?
- What should I sell?
- How much money should I make?
