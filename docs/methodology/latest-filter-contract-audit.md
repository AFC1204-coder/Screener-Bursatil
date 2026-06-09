# Filter Contract Audit

Dataset version: 1
Cases: 230 · Passed: 230 · Failed: 0
Synthetic: 223 · Frozen: 7
Visible fields covered: 62/62
Guardrails: OK
Exactness probe: OK · passed RS90 · rejected RS89

## Area Summary

| Area | Cases | Failed |
|---|---:|---:|
| frozen-real | 7 | 0 |
| synthetic-boundary | 108 | 0 |
| synthetic-distance | 12 | 0 |
| synthetic-mode | 18 | 0 |
| synthetic-null | 64 | 0 |
| synthetic-special | 21 | 0 |

## Matrix

| Result | Area | Case | Filter | Metric | Threshold | Input | Expected | Actual | Reject field | Detail |
|---|---|---|---|---|---|---|---|---|---|---|
OK | synthetic-boundary | minPrice-boundary-pass | minPrice | price | 50 | 50 | pass | pass | - | -
OK | synthetic-boundary | minPrice-below-reject | minPrice | price | 50 | 49.9 | reject minPrice | reject | minPrice | precio 49.90 < 50
OK | synthetic-null | minPrice-null-reject | minPrice | price | 50 | null | reject minPrice | reject | minPrice | precio sin dato
OK | synthetic-boundary | minMarketCap-boundary-pass | minMarketCap | marketCap | 500,000,000 | 500,000,000 | pass | pass | - | -
OK | synthetic-boundary | minMarketCap-below-reject | minMarketCap | marketCap | 500,000,000 | 499,999,999 | reject minMarketCap | reject | minMarketCap | market cap 499999999.00 < 500000000
OK | synthetic-null | minMarketCap-null-reject | minMarketCap | marketCap | 500,000,000 | null | reject minMarketCap | reject | minMarketCap | market cap sin dato
OK | synthetic-boundary | minAvgVolume-boundary-pass | minAvgVolume | avgVolume | 500,000 | 500,000 | pass | pass | - | -
OK | synthetic-boundary | minAvgVolume-below-reject | minAvgVolume | avgVolume | 500,000 | 499,999 | reject minAvgVolume | reject | minAvgVolume | volumen medio 499999.00 < 500000
OK | synthetic-null | minAvgVolume-null-reject | minAvgVolume | avgVolume | 500,000 | null | reject minAvgVolume | reject | minAvgVolume | volumen medio sin dato
OK | synthetic-boundary | minAvgTurnover-boundary-pass | minAvgTurnover | avgTurnover | 10,000,000 | 10,000,000 | pass | pass | - | -
OK | synthetic-boundary | minAvgTurnover-below-reject | minAvgTurnover | avgTurnover | 10,000,000 | 9,999,999 | reject minAvgTurnover | reject | minAvgTurnover | importe medio 9999999.00 < 10000000
OK | synthetic-null | minAvgTurnover-null-reject | minAvgTurnover | avgTurnover | 10,000,000 | null | reject minAvgTurnover | reject | minAvgTurnover | importe medio sin dato
OK | synthetic-boundary | minLatestVolume-boundary-pass | minLatestVolume | latestVolume | 250,000 | 250,000 | pass | pass | - | -
OK | synthetic-boundary | minLatestVolume-below-reject | minLatestVolume | latestVolume | 250,000 | 249,999 | reject minLatestVolume | reject | minLatestVolume | volumen sesion 249999.00 < 250000
OK | synthetic-null | minLatestVolume-null-reject | minLatestVolume | latestVolume | 250,000 | null | reject minLatestVolume | reject | minLatestVolume | volumen sesion sin dato
OK | synthetic-boundary | minLatestTurnover-boundary-pass | minLatestTurnover | latestTurnover | 5,000,000 | 5,000,000 | pass | pass | - | -
OK | synthetic-boundary | minLatestTurnover-below-reject | minLatestTurnover | latestTurnover | 5,000,000 | 4,999,999 | reject minLatestTurnover | reject | minLatestTurnover | importe sesion 4999999.00 < 5000000
OK | synthetic-null | minLatestTurnover-null-reject | minLatestTurnover | latestTurnover | 5,000,000 | null | reject minLatestTurnover | reject | minLatestTurnover | importe sesion sin dato
OK | synthetic-boundary | minRelativeVolume-boundary-pass | minRelativeVolume | relativeVolume | 1.5 | 1.5 | pass | pass | - | -
OK | synthetic-boundary | minRelativeVolume-below-reject | minRelativeVolume | relativeVolume | 1.5 | 1.49 | reject minRelativeVolume | reject | minRelativeVolume | volumen relativo 1.49 < 1.5
OK | synthetic-null | minRelativeVolume-null-reject | minRelativeVolume | relativeVolume | 1.5 | null | reject minRelativeVolume | reject | minRelativeVolume | volumen relativo sin dato
OK | synthetic-boundary | minVolumeSurgePct-boundary-pass | minVolumeSurgePct | volumeSurgePct | 20 | 20 | pass | pass | - | -
OK | synthetic-boundary | minVolumeSurgePct-below-reject | minVolumeSurgePct | volumeSurgePct | 20 | 19.9 | reject minVolumeSurgePct | reject | minVolumeSurgePct | volumen 5d 19.90 < 20
OK | synthetic-null | minVolumeSurgePct-null-reject | minVolumeSurgePct | volumeSurgePct | 20 | null | reject minVolumeSurgePct | reject | minVolumeSurgePct | volumen 5d sin dato
OK | synthetic-boundary | minUpDownVolRatio-boundary-pass | minUpDownVolRatio | upDownVolRatio | 1 | 1 | pass | pass | - | -
OK | synthetic-boundary | minUpDownVolRatio-below-reject | minUpDownVolRatio | upDownVolRatio | 1 | 0.99 | reject minUpDownVolRatio | reject | minUpDownVolRatio | up/down volume 0.99 < 1
OK | synthetic-null | minUpDownVolRatio-null-reject | minUpDownVolRatio | upDownVolRatio | 1 | null | reject minUpDownVolRatio | reject | minUpDownVolRatio | up/down volume sin dato
OK | synthetic-boundary | minVolumeEffectScore-boundary-pass | minVolumeEffectScore | volumeEffectScore | 60 | 60 | pass | pass | - | -
OK | synthetic-boundary | minVolumeEffectScore-below-reject | minVolumeEffectScore | volumeEffectScore | 60 | 59.9 | reject minVolumeEffectScore | reject | minVolumeEffectScore | volume effect 59.90 < 60
OK | synthetic-null | minVolumeEffectScore-null-reject | minVolumeEffectScore | volumeEffectScore | 60 | null | reject minVolumeEffectScore | reject | minVolumeEffectScore | volume effect sin dato
OK | synthetic-boundary | minShortFloatPct-boundary-pass | minShortFloatPct | shortPercentOfFloat | 5 | 5 | pass | pass | - | -
OK | synthetic-boundary | minShortFloatPct-below-reject | minShortFloatPct | shortPercentOfFloat | 5 | 4.99 | reject minShortFloatPct | reject | minShortFloatPct | short float 4.99 < 5
OK | synthetic-null | minShortFloatPct-null-reject | minShortFloatPct | shortPercentOfFloat | 5 | null | reject minShortFloatPct | reject | minShortFloatPct | short float sin dato
OK | synthetic-boundary | maxShortFloatPct-boundary-pass | maxShortFloatPct | shortPercentOfFloat | 10 | 10 | pass | pass | - | -
OK | synthetic-boundary | maxShortFloatPct-above-reject | maxShortFloatPct | shortPercentOfFloat | 10 | 10.1 | reject maxShortFloatPct | reject | maxShortFloatPct | short float 10.10 > 10
OK | synthetic-null | maxShortFloatPct-null-reject | maxShortFloatPct | shortPercentOfFloat | 10 | null | reject maxShortFloatPct | reject | maxShortFloatPct | short float sin dato
OK | synthetic-boundary | minPerf3m-boundary-pass | minPerf3m | perf3m | 10 | 10 | pass | pass | - | -
OK | synthetic-boundary | minPerf3m-below-reject | minPerf3m | perf3m | 10 | 9.9 | reject minPerf3m | reject | minPerf3m | perf 3M 9.90 < 10
OK | synthetic-null | minPerf3m-null-reject | minPerf3m | perf3m | 10 | null | reject minPerf3m | reject | minPerf3m | perf 3M sin dato
OK | synthetic-boundary | minPerf6m-boundary-pass | minPerf6m | perf6m | 20 | 20 | pass | pass | - | -
OK | synthetic-boundary | minPerf6m-below-reject | minPerf6m | perf6m | 20 | 19.9 | reject minPerf6m | reject | minPerf6m | perf 6M 19.90 < 20
OK | synthetic-null | minPerf6m-null-reject | minPerf6m | perf6m | 20 | null | reject minPerf6m | reject | minPerf6m | perf 6M sin dato
OK | synthetic-boundary | minPerf12m-boundary-pass | minPerf12m | perf12m | 30 | 30 | pass | pass | - | -
OK | synthetic-boundary | minPerf12m-below-reject | minPerf12m | perf12m | 30 | 29.9 | reject minPerf12m | reject | minPerf12m | perf 12M 29.90 < 30
OK | synthetic-null | minPerf12m-null-reject | minPerf12m | perf12m | 30 | null | reject minPerf12m | reject | minPerf12m | perf 12M sin dato
OK | synthetic-boundary | maxHighsSpreadPct-boundary-pass | maxHighsSpreadPct | highsSpreadPct | 8 | 8 | pass | pass | - | -
OK | synthetic-boundary | maxHighsSpreadPct-above-reject | maxHighsSpreadPct | highsSpreadPct | 8 | 8.01 | reject maxHighsSpreadPct | reject | maxHighsSpreadPct | highs spread 8.01 > 8
OK | synthetic-null | maxHighsSpreadPct-null-reject | maxHighsSpreadPct | highsSpreadPct | 8 | null | reject maxHighsSpreadPct | reject | maxHighsSpreadPct | highs spread sin dato
OK | synthetic-boundary | maxExtensionSma50-boundary-pass | maxExtensionSma50 | extSma50 | 25 | 25 | pass | pass | - | -
OK | synthetic-boundary | maxExtensionSma50-above-reject | maxExtensionSma50 | extSma50 | 25 | 25.1 | reject maxExtensionSma50 | reject | maxExtensionSma50 | extension SMA50 25.10 > 25
OK | synthetic-null | maxExtensionSma50-null-reject | maxExtensionSma50 | extSma50 | 25 | null | reject maxExtensionSma50 | reject | maxExtensionSma50 | extension SMA50 sin dato
OK | synthetic-boundary | maxDailyMove20dPct-boundary-pass | maxDailyMove20dPct | maxDailyMove20dPct | 12 | 12 | pass | pass | - | -
OK | synthetic-boundary | maxDailyMove20dPct-above-reject | maxDailyMove20dPct | maxDailyMove20dPct | 12 | 12.1 | reject maxDailyMove20dPct | reject | maxDailyMove20dPct | movimiento diario 20d 12.10 > 12
OK | synthetic-null | maxDailyMove20dPct-null-reject | maxDailyMove20dPct | maxDailyMove20dPct | 12 | null | reject maxDailyMove20dPct | reject | maxDailyMove20dPct | movimiento diario 20d sin dato
OK | synthetic-boundary | maxDailyRange20dPct-boundary-pass | maxDailyRange20dPct | maxDailyRange20dPct | 16 | 16 | pass | pass | - | -
OK | synthetic-boundary | maxDailyRange20dPct-above-reject | maxDailyRange20dPct | maxDailyRange20dPct | 16 | 16.1 | reject maxDailyRange20dPct | reject | maxDailyRange20dPct | rango intradia 20d 16.10 > 16
OK | synthetic-null | maxDailyRange20dPct-null-reject | maxDailyRange20dPct | maxDailyRange20dPct | 16 | null | reject maxDailyRange20dPct | reject | maxDailyRange20dPct | rango intradia 20d sin dato
OK | synthetic-boundary | maxRange63dPct-boundary-pass | maxRange63dPct | range63dPct | 55 | 55 | pass | pass | - | -
OK | synthetic-boundary | maxRange63dPct-above-reject | maxRange63dPct | range63dPct | 55 | 55.1 | reject maxRange63dPct | reject | maxRange63dPct | rango 63d 55.10 > 55
OK | synthetic-null | maxRange63dPct-null-reject | maxRange63dPct | range63dPct | 55 | null | reject maxRange63dPct | reject | maxRange63dPct | rango 63d sin dato
OK | synthetic-boundary | maxVolatility63d-boundary-pass | maxVolatility63d | volatility63d | 60 | 60 | pass | pass | - | -
OK | synthetic-boundary | maxVolatility63d-above-reject | maxVolatility63d | volatility63d | 60 | 60.1 | reject maxVolatility63d | reject | maxVolatility63d | volatilidad 63d 60.10 > 60
OK | synthetic-null | maxVolatility63d-null-reject | maxVolatility63d | volatility63d | 60 | null | reject maxVolatility63d | reject | maxVolatility63d | volatilidad 63d sin dato
OK | synthetic-boundary | maxDrawdown63d-boundary-pass | maxDrawdown63d | maxDrawdown63d | 22 | 22 | pass | pass | - | -
OK | synthetic-boundary | maxDrawdown63d-above-reject | maxDrawdown63d | maxDrawdown63d | 22 | 22.1 | reject maxDrawdown63d | reject | maxDrawdown63d | drawdown 63d 22.10 > 22
OK | synthetic-null | maxDrawdown63d-null-reject | maxDrawdown63d | maxDrawdown63d | 22 | null | reject maxDrawdown63d | reject | maxDrawdown63d | drawdown 63d sin dato
OK | synthetic-boundary | minContractionCount-boundary-pass | minContractionCount | contractionCount | 3 | 3 | pass | pass | - | -
OK | synthetic-boundary | minContractionCount-below-reject | minContractionCount | contractionCount | 3 | 2.99 | reject minContractionCount | reject | minContractionCount | contracciones 2.99 < 3
OK | synthetic-null | minContractionCount-null-reject | minContractionCount | contractionCount | 3 | null | reject minContractionCount | reject | minContractionCount | contracciones sin dato
OK | synthetic-boundary | maxContraction1DepthPct-boundary-pass | maxContraction1DepthPct | contraction1DepthPct | 25 | 25 | pass | pass | - | -
OK | synthetic-boundary | maxContraction1DepthPct-above-reject | maxContraction1DepthPct | contraction1DepthPct | 25 | 25.1 | reject maxContraction1DepthPct | reject | maxContraction1DepthPct | contracción 1 25.10 > 25
OK | synthetic-null | maxContraction1DepthPct-null-reject | maxContraction1DepthPct | contraction1DepthPct | 25 | null | reject maxContraction1DepthPct | reject | maxContraction1DepthPct | contracción 1 sin dato
OK | synthetic-boundary | maxContraction2DepthPct-boundary-pass | maxContraction2DepthPct | contraction2DepthPct | 16 | 16 | pass | pass | - | -
OK | synthetic-boundary | maxContraction2DepthPct-above-reject | maxContraction2DepthPct | contraction2DepthPct | 16 | 16.1 | reject maxContraction2DepthPct | reject | maxContraction2DepthPct | contracción 2 16.10 > 16
OK | synthetic-null | maxContraction2DepthPct-null-reject | maxContraction2DepthPct | contraction2DepthPct | 16 | null | reject maxContraction2DepthPct | reject | maxContraction2DepthPct | contracción 2 sin dato
OK | synthetic-boundary | maxContraction3DepthPct-boundary-pass | maxContraction3DepthPct | contraction3DepthPct | 8 | 8 | pass | pass | - | -
OK | synthetic-boundary | maxContraction3DepthPct-above-reject | maxContraction3DepthPct | contraction3DepthPct | 8 | 8.01 | reject maxContraction3DepthPct | reject | maxContraction3DepthPct | contracción 3 8.01 > 8
OK | synthetic-null | maxContraction3DepthPct-null-reject | maxContraction3DepthPct | contraction3DepthPct | 8 | null | reject maxContraction3DepthPct | reject | maxContraction3DepthPct | contracción 3 sin dato
OK | synthetic-boundary | maxLastContractionDepthPct-boundary-pass | maxLastContractionDepthPct | lastContractionDepthPct | 8 | 8 | pass | pass | - | -
OK | synthetic-boundary | maxLastContractionDepthPct-above-reject | maxLastContractionDepthPct | lastContractionDepthPct | 8 | 8.01 | reject maxLastContractionDepthPct | reject | maxLastContractionDepthPct | última contracción 8.01 > 8
OK | synthetic-null | maxLastContractionDepthPct-null-reject | maxLastContractionDepthPct | lastContractionDepthPct | 8 | null | reject maxLastContractionDepthPct | reject | maxLastContractionDepthPct | última contracción sin dato
OK | synthetic-boundary | maxBaseDepthPct-boundary-pass | maxBaseDepthPct | baseDepthPct | 35 | 35 | pass | pass | - | -
OK | synthetic-boundary | maxBaseDepthPct-above-reject | maxBaseDepthPct | baseDepthPct | 35 | 35.1 | reject maxBaseDepthPct | reject | maxBaseDepthPct | profundidad base 35.10 > 35
OK | synthetic-null | maxBaseDepthPct-null-reject | maxBaseDepthPct | baseDepthPct | 35 | null | reject maxBaseDepthPct | reject | maxBaseDepthPct | profundidad base sin dato
OK | synthetic-boundary | minBaseWeeks-boundary-pass | minBaseWeeks | baseWeeks | 7 | 7 | pass | pass | - | -
OK | synthetic-boundary | minBaseWeeks-below-reject | minBaseWeeks | baseWeeks | 7 | 6.99 | reject minBaseWeeks | reject | minBaseWeeks | duracion base 6.99 < 7
OK | synthetic-null | minBaseWeeks-null-reject | minBaseWeeks | baseWeeks | 7 | null | reject minBaseWeeks | reject | minBaseWeeks | duracion base sin dato
OK | synthetic-boundary | maxBaseWeeks-boundary-pass | maxBaseWeeks | baseWeeks | 22 | 22 | pass | pass | - | -
OK | synthetic-boundary | maxBaseWeeks-above-reject | maxBaseWeeks | baseWeeks | 22 | 22.1 | reject maxBaseWeeks | reject | maxBaseWeeks | duracion base 22.10 > 22
OK | synthetic-null | maxBaseWeeks-null-reject | maxBaseWeeks | baseWeeks | 22 | null | reject maxBaseWeeks | reject | maxBaseWeeks | duracion base sin dato
OK | synthetic-boundary | maxAbsDistanceToPivotPct-boundary-pass | maxAbsDistanceToPivotPct | absDistanceToPivotPct | 6 | 6 | pass | pass | - | -
OK | synthetic-boundary | maxAbsDistanceToPivotPct-above-reject | maxAbsDistanceToPivotPct | absDistanceToPivotPct | 6 | 6.01 | reject maxAbsDistanceToPivotPct | reject | maxAbsDistanceToPivotPct | distancia pivot 6.01 > 6
OK | synthetic-null | maxAbsDistanceToPivotPct-null-reject | maxAbsDistanceToPivotPct | absDistanceToPivotPct | 6 | null | reject maxAbsDistanceToPivotPct | reject | maxAbsDistanceToPivotPct | distancia pivot sin dato
OK | synthetic-boundary | maxVolumeDryUpRatio-boundary-pass | maxVolumeDryUpRatio | volumeDryUpRatio | 0.9 | 0.9 | pass | pass | - | -
OK | synthetic-boundary | maxVolumeDryUpRatio-above-reject | maxVolumeDryUpRatio | volumeDryUpRatio | 0.9 | 0.91 | reject maxVolumeDryUpRatio | reject | maxVolumeDryUpRatio | volumen seco 0.91 > 0.9
OK | synthetic-null | maxVolumeDryUpRatio-null-reject | maxVolumeDryUpRatio | volumeDryUpRatio | 0.9 | null | reject maxVolumeDryUpRatio | reject | maxVolumeDryUpRatio | volumen seco sin dato
OK | synthetic-boundary | maxTightness10dPct-boundary-pass | maxTightness10dPct | tightness10dPct | 12 | 12 | pass | pass | - | -
OK | synthetic-boundary | maxTightness10dPct-above-reject | maxTightness10dPct | tightness10dPct | 12 | 12.1 | reject maxTightness10dPct | reject | maxTightness10dPct | rango 10d 12.10 > 12
OK | synthetic-null | maxTightness10dPct-null-reject | maxTightness10dPct | tightness10dPct | 12 | null | reject maxTightness10dPct | reject | maxTightness10dPct | rango 10d sin dato
OK | synthetic-boundary | minPatternQualityScore-boundary-pass | minPatternQualityScore | patternQualityScore | 65 | 65 | pass | pass | - | -
OK | synthetic-boundary | minPatternQualityScore-below-reject | minPatternQualityScore | patternQualityScore | 65 | 64.9 | reject minPatternQualityScore | reject | minPatternQualityScore | calidad estructura 64.90 < 65
OK | synthetic-null | minPatternQualityScore-null-reject | minPatternQualityScore | patternQualityScore | 65 | null | reject minPatternQualityScore | reject | minPatternQualityScore | calidad estructura sin dato
OK | synthetic-boundary | minRiskRewardScore-boundary-pass | minRiskRewardScore | riskRewardScore | 70 | 70 | pass | pass | - | -
OK | synthetic-boundary | minRiskRewardScore-below-reject | minRiskRewardScore | riskRewardScore | 70 | 69.9 | reject minRiskRewardScore | reject | minRiskRewardScore | rentabilidad/riesgo 69.90 < 70
OK | synthetic-null | minRiskRewardScore-null-reject | minRiskRewardScore | riskRewardScore | 70 | null | reject minRiskRewardScore | reject | minRiskRewardScore | rentabilidad/riesgo sin dato
OK | synthetic-boundary | minReturnToVol3m-boundary-pass | minReturnToVol3m | returnToVol3m | 1.2 | 1.2 | pass | pass | - | -
OK | synthetic-boundary | minReturnToVol3m-below-reject | minReturnToVol3m | returnToVol3m | 1.2 | 1.19 | reject minReturnToVol3m | reject | minReturnToVol3m | retorno/volatilidad 1.19 < 1.2
OK | synthetic-null | minReturnToVol3m-null-reject | minReturnToVol3m | returnToVol3m | 1.2 | null | reject minReturnToVol3m | reject | minReturnToVol3m | retorno/volatilidad sin dato
OK | synthetic-boundary | minReturnToDrawdown3m-boundary-pass | minReturnToDrawdown3m | returnToDrawdown3m | 2 | 2 | pass | pass | - | -
OK | synthetic-boundary | minReturnToDrawdown3m-below-reject | minReturnToDrawdown3m | returnToDrawdown3m | 2 | 1.99 | reject minReturnToDrawdown3m | reject | minReturnToDrawdown3m | retorno/drawdown 1.99 < 2
OK | synthetic-null | minReturnToDrawdown3m-null-reject | minReturnToDrawdown3m | returnToDrawdown3m | 2 | null | reject minReturnToDrawdown3m | reject | minReturnToDrawdown3m | retorno/drawdown sin dato
OK | synthetic-boundary | minAdProxyScore-boundary-pass | minAdProxyScore | adProxyScore | 75 | 75 | pass | pass | - | -
OK | synthetic-boundary | minAdProxyScore-below-reject | minAdProxyScore | adProxyScore | 75 | 74.9 | reject minAdProxyScore | reject | minAdProxyScore | A/D proxy 74.90 < 75
OK | synthetic-null | minAdProxyScore-null-reject | minAdProxyScore | adProxyScore | 75 | null | reject minAdProxyScore | reject | minAdProxyScore | A/D proxy sin dato
OK | synthetic-boundary | minEpsGrowthProxyScore-boundary-pass | minEpsGrowthProxyScore | epsGrowthProxyScore | 70 | 70 | pass | pass | - | -
OK | synthetic-boundary | minEpsGrowthProxyScore-below-reject | minEpsGrowthProxyScore | epsGrowthProxyScore | 70 | 69.9 | reject minEpsGrowthProxyScore | reject | minEpsGrowthProxyScore | EPS/growth proxy 69.90 < 70
OK | synthetic-null | minEpsGrowthProxyScore-null-reject | minEpsGrowthProxyScore | epsGrowthProxyScore | 70 | null | reject minEpsGrowthProxyScore | reject | minEpsGrowthProxyScore | EPS/growth proxy sin dato
OK | synthetic-boundary | minDataCoverageScore-boundary-pass | minDataCoverageScore | dataCoverageScore | 80 | 80 | pass | pass | - | -
OK | synthetic-boundary | minDataCoverageScore-below-reject | minDataCoverageScore | dataCoverageScore | 80 | 79.9 | reject minDataCoverageScore | reject | minDataCoverageScore | cobertura total 79.90 < 80
OK | synthetic-null | minDataCoverageScore-null-reject | minDataCoverageScore | dataCoverageScore | 80 | null | reject minDataCoverageScore | reject | minDataCoverageScore | cobertura total sin dato
OK | synthetic-boundary | minTechnicalCoverageScore-boundary-pass | minTechnicalCoverageScore | technicalCoverageScore | 85 | 85 | pass | pass | - | -
OK | synthetic-boundary | minTechnicalCoverageScore-below-reject | minTechnicalCoverageScore | technicalCoverageScore | 85 | 84.9 | reject minTechnicalCoverageScore | reject | minTechnicalCoverageScore | cobertura técnica 84.90 < 85
OK | synthetic-null | minTechnicalCoverageScore-null-reject | minTechnicalCoverageScore | technicalCoverageScore | 85 | null | reject minTechnicalCoverageScore | reject | minTechnicalCoverageScore | cobertura técnica sin dato
OK | synthetic-boundary | minFundamentalCoverageScore-boundary-pass | minFundamentalCoverageScore | fundamentalCoverageScore | 40 | 40 | pass | pass | - | -
OK | synthetic-boundary | minFundamentalCoverageScore-below-reject | minFundamentalCoverageScore | fundamentalCoverageScore | 40 | 39.9 | reject minFundamentalCoverageScore | reject | minFundamentalCoverageScore | cobertura fundamental 39.90 < 40
OK | synthetic-null | minFundamentalCoverageScore-null-reject | minFundamentalCoverageScore | fundamentalCoverageScore | 40 | null | reject minFundamentalCoverageScore | reject | minFundamentalCoverageScore | cobertura fundamental sin dato
OK | synthetic-boundary | minRsBenchmarkRating-boundary-pass | minRsBenchmarkRating | rsRating | 90 | 90 | pass | pass | - | -
OK | synthetic-boundary | minRsBenchmarkRating-below-reject | minRsBenchmarkRating | rsRating | 90 | 89.9 | reject minRsBenchmarkRating | reject | minRsBenchmarkRating | RS benchmark 89.90 < 90
OK | synthetic-null | minRsBenchmarkRating-null-reject | minRsBenchmarkRating | rsRating | 90 | null | reject minRsBenchmarkRating | reject | minRsBenchmarkRating | RS benchmark sin dato
OK | synthetic-boundary | minRsCountryPct-boundary-pass | minRsCountryPct | rsCountryPct | 80 | 80 | pass | pass | - | -
OK | synthetic-boundary | minRsCountryPct-below-reject | minRsCountryPct | rsCountryPct | 80 | 79.9 | reject minRsCountryPct | reject | minRsCountryPct | RS pais 79.90 < 80
OK | synthetic-null | minRsCountryPct-null-reject | minRsCountryPct | rsCountryPct | 80 | null | reject minRsCountryPct | reject | minRsCountryPct | RS pais sin dato
OK | synthetic-boundary | minRsSectorPct-boundary-pass | minRsSectorPct | rsSectorPct | 80 | 80 | pass | pass | - | -
OK | synthetic-boundary | minRsSectorPct-below-reject | minRsSectorPct | rsSectorPct | 80 | 79.9 | reject minRsSectorPct | reject | minRsSectorPct | RS grupo 79.90 < 80
OK | synthetic-null | minRsSectorPct-null-reject | minRsSectorPct | rsSectorPct | 80 | null | reject minRsSectorPct | reject | minRsSectorPct | RS grupo sin dato
OK | synthetic-boundary | minRsQualityScore-boundary-pass | minRsQualityScore | rsQualityScore | 75 | 75 | pass | pass | - | -
OK | synthetic-boundary | minRsQualityScore-below-reject | minRsQualityScore | rsQualityScore | 75 | 74.9 | reject minRsQualityScore | reject | minRsQualityScore | RS quality 74.90 < 75
OK | synthetic-null | minRsQualityScore-null-reject | minRsQualityScore | rsQualityScore | 75 | null | reject minRsQualityScore | reject | minRsQualityScore | RS quality sin dato
OK | synthetic-boundary | minSectorScore-boundary-pass | minSectorScore | sectorScore | 70 | 70 | pass | pass | - | -
OK | synthetic-boundary | minSectorScore-below-reject | minSectorScore | sectorScore | 70 | 69.9 | reject minSectorScore | reject | minSectorScore | fuerza grupo 69.90 < 70
OK | synthetic-null | minSectorScore-null-reject | minSectorScore | sectorScore | 70 | null | reject minSectorScore | reject | minSectorScore | fuerza grupo sin dato
OK | synthetic-boundary | minWeinsteinScore-boundary-pass | minWeinsteinScore | weinsteinScore | 80 | 80 | pass | pass | - | -
OK | synthetic-boundary | minWeinsteinScore-below-reject | minWeinsteinScore | weinsteinScore | 80 | 79.9 | reject minWeinsteinScore | reject | minWeinsteinScore | Weinstein 79.90 < 80
OK | synthetic-null | minWeinsteinScore-null-reject | minWeinsteinScore | weinsteinScore | 80 | null | reject minWeinsteinScore | reject | minWeinsteinScore | Weinstein sin dato
OK | synthetic-boundary | minMinerviniScore-boundary-pass | minMinerviniScore | minerviniScore | 80 | 80 | pass | pass | - | -
OK | synthetic-boundary | minMinerviniScore-below-reject | minMinerviniScore | minerviniScore | 80 | 79.9 | reject minMinerviniScore | reject | minMinerviniScore | Minervini 79.90 < 80
OK | synthetic-null | minMinerviniScore-null-reject | minMinerviniScore | minerviniScore | 80 | null | reject minMinerviniScore | reject | minMinerviniScore | Minervini sin dato
OK | synthetic-boundary | minMomentumScore-boundary-pass | minMomentumScore | momentumScore | 70 | 70 | pass | pass | - | -
OK | synthetic-boundary | minMomentumScore-below-reject | minMomentumScore | momentumScore | 70 | 69.9 | reject minMomentumScore | reject | minMomentumScore | momentum score 69.90 < 70
OK | synthetic-null | minMomentumScore-null-reject | minMomentumScore | momentumScore | 70 | null | reject minMomentumScore | reject | minMomentumScore | momentum score sin dato
OK | synthetic-boundary | minRiskScore-boundary-pass | minRiskScore | riskScore | 70 | 70 | pass | pass | - | -
OK | synthetic-boundary | minRiskScore-below-reject | minRiskScore | riskScore | 70 | 69.9 | reject minRiskScore | reject | minRiskScore | risk score 69.90 < 70
OK | synthetic-null | minRiskScore-null-reject | minRiskScore | riskScore | 70 | null | reject minRiskScore | reject | minRiskScore | risk score sin dato
OK | synthetic-boundary | minVolumeScore-boundary-pass | minVolumeScore | volumeScore | 60 | 60 | pass | pass | - | -
OK | synthetic-boundary | minVolumeScore-below-reject | minVolumeScore | volumeScore | 60 | 59.9 | reject minVolumeScore | reject | minVolumeScore | volume score 59.90 < 60
OK | synthetic-null | minVolumeScore-null-reject | minVolumeScore | volumeScore | 60 | null | reject minVolumeScore | reject | minVolumeScore | volume score sin dato
OK | synthetic-boundary | minLiquidityScore-boundary-pass | minLiquidityScore | liquidityScore | 60 | 60 | pass | pass | - | -
OK | synthetic-boundary | minLiquidityScore-below-reject | minLiquidityScore | liquidityScore | 60 | 59.9 | reject minLiquidityScore | reject | minLiquidityScore | liquidity score 59.90 < 60
OK | synthetic-null | minLiquidityScore-null-reject | minLiquidityScore | liquidityScore | 60 | null | reject minLiquidityScore | reject | minLiquidityScore | liquidity score sin dato
OK | synthetic-boundary | minTotalScore-boundary-pass | minTotalScore | totalScore | 85 | 85 | pass | pass | - | -
OK | synthetic-boundary | minTotalScore-below-reject | minTotalScore | totalScore | 85 | 84.9 | reject minTotalScore | reject | minTotalScore | composite 84.90 < 85
OK | synthetic-null | minTotalScore-null-reject | minTotalScore | totalScore | 85 | null | reject minTotalScore | reject | minTotalScore | composite sin dato
OK | synthetic-distance | maxDistance20dHigh-drawdown-boundary-pass | maxDistance20dHigh | distance20d | 12 | -12 | pass | pass | - | -
OK | synthetic-distance | maxDistance20dHigh-positive-extension-pass | maxDistance20dHigh | distance20d | 12 | 2 | pass | pass | - | -
OK | synthetic-distance | maxDistance20dHigh-beyond-drawdown-reject | maxDistance20dHigh | distance20d | 12 | -12.1 | reject maxDistance20dHigh | reject | maxDistance20dHigh | distancia 20d -12.10 < -12
OK | synthetic-null | maxDistance20dHigh-null-reject | maxDistance20dHigh | distance20d | 12 | null | reject maxDistance20dHigh | reject | maxDistance20dHigh | distancia 20d sin dato
OK | synthetic-distance | maxDistance50dHigh-drawdown-boundary-pass | maxDistance50dHigh | distance50d | 12 | -12 | pass | pass | - | -
OK | synthetic-distance | maxDistance50dHigh-positive-extension-pass | maxDistance50dHigh | distance50d | 12 | 2 | pass | pass | - | -
OK | synthetic-distance | maxDistance50dHigh-beyond-drawdown-reject | maxDistance50dHigh | distance50d | 12 | -12.1 | reject maxDistance50dHigh | reject | maxDistance50dHigh | distancia 50d -12.10 < -12
OK | synthetic-null | maxDistance50dHigh-null-reject | maxDistance50dHigh | distance50d | 12 | null | reject maxDistance50dHigh | reject | maxDistance50dHigh | distancia 50d sin dato
OK | synthetic-distance | maxDistance52w-drawdown-boundary-pass | maxDistance52w | distance52w | 12 | -12 | pass | pass | - | -
OK | synthetic-distance | maxDistance52w-positive-extension-pass | maxDistance52w | distance52w | 12 | 2 | pass | pass | - | -
OK | synthetic-distance | maxDistance52w-beyond-drawdown-reject | maxDistance52w | distance52w | 12 | -12.1 | reject maxDistance52w | reject | maxDistance52w | distancia 52w -12.10 < -12
OK | synthetic-null | maxDistance52w-null-reject | maxDistance52w | distance52w | 12 | null | reject maxDistance52w | reject | maxDistance52w | distancia 52w sin dato
OK | synthetic-distance | maxDistanceATH-drawdown-boundary-pass | maxDistanceATH | distanceATH | 12 | -12 | pass | pass | - | -
OK | synthetic-distance | maxDistanceATH-positive-extension-pass | maxDistanceATH | distanceATH | 12 | 2 | pass | pass | - | -
OK | synthetic-distance | maxDistanceATH-beyond-drawdown-reject | maxDistanceATH | distanceATH | 12 | -12.1 | reject maxDistanceATH | reject | maxDistanceATH | distancia ATH -12.10 < -12
OK | synthetic-null | maxDistanceATH-null-reject | maxDistanceATH | distanceATH | 12 | null | reject maxDistanceATH | reject | maxDistanceATH | distancia ATH sin dato
OK | synthetic-special | minRsRating-global-boundary-pass | minRsRating | rsGlobalPct | 90 | 90 | pass | pass | - | -
OK | synthetic-special | minRsRating-global-below-reject | minRsRating | rsGlobalPct | 90 | 89.9 | reject minRsRating | reject | minRsRating | RS universo 90 < 90
OK | synthetic-special | minRsRating-no-benchmark-fallback | minRsRating | rsGlobalPct | 90 | null | reject minRsRating | reject | minRsRating | RS universo sin dato < 90
OK | synthetic-special | maxPriceFreshnessDays-boundary-pass | maxPriceFreshnessDays | priceFreshnessDays | 5 | 5 | pass | pass | - | -
OK | synthetic-special | maxPriceFreshnessDays-stale-reject | maxPriceFreshnessDays | priceFreshnessDays | 5 | 6 | reject maxPriceFreshnessDays | reject | maxPriceFreshnessDays | precio viejo o sin fecha > 5d
OK | synthetic-null | maxPriceFreshnessDays-missing-date-reject | maxPriceFreshnessDays | lastDate | 5 | null | reject maxPriceFreshnessDays | reject | maxPriceFreshnessDays | precio viejo o sin fecha > 5d
OK | synthetic-special | requireSma200Up-positive-pass | requireSma200Up | sma200Slope | 1 | 0.1 | pass | pass | - | -
OK | synthetic-special | requireSma200Up-flat-reject | requireSma200Up | sma200Slope | 1 | 0 | reject requireSma200Up | reject | requireSma200Up | SMA200 no sube
OK | synthetic-null | requireSma200Up-null-reject | requireSma200Up | sma200Slope | 1 | null | reject requireSma200Up | reject | requireSma200Up | SMA200 no sube
OK | synthetic-special | requirePriceAboveSma50-above-pass | requirePriceAboveSma50 | price/sma50 | 1 | 100>99 | pass | pass | - | -
OK | synthetic-special | requirePriceAboveSma50-equality-reject | requirePriceAboveSma50 | price/sma50 | 1 | 100=100 | reject requirePriceAboveSma50 | reject | requirePriceAboveSma50 | precio bajo SMA50
OK | synthetic-null | requirePriceAboveSma50-null-reject | requirePriceAboveSma50 | price/sma50 | 1 | null | reject requirePriceAboveSma50 | reject | requirePriceAboveSma50 | precio bajo SMA50
OK | synthetic-special | requireUpVolume-true-pass | requireUpVolume | upVolume | 1 | 1 | pass | pass | - | -
OK | synthetic-special | requireUpVolume-false-reject | requireUpVolume | upVolume | 1 | 0 | reject requireUpVolume | reject | requireUpVolume | última vela no es alcista con volumen
OK | synthetic-null | requireUpVolume-null-reject | requireUpVolume | upVolume | 1 | null | reject requireUpVolume | reject | requireUpVolume | última vela no es alcista con volumen
OK | synthetic-special | requireContractionsDecreasing-true-pass | requireContractionsDecreasing | contractionsDecreasing | 1 | 1 | pass | pass | - | -
OK | synthetic-special | requireContractionsDecreasing-false-reject | requireContractionsDecreasing | contractionsDecreasing | 1 | 0 | reject requireContractionsDecreasing | reject | requireContractionsDecreasing | sin compresión progresiva
OK | synthetic-null | requireContractionsDecreasing-null-reject | requireContractionsDecreasing | contractionsDecreasing | 1 | null | reject requireContractionsDecreasing | reject | requireContractionsDecreasing | sin compresión progresiva
OK | synthetic-special | pattern-data-blocked-rejects-structure-filter | patternDataStatus | patternDataStatus | pattern active | insufficient_history | reject patternDataStatus | reject | patternDataStatus | estructura no fiable: histórico insuficiente
OK | synthetic-special | pattern-invalid-structure-rejects-count-pass | contractionStructureStatus | contractionStructureStatus | pattern active | lower_low_drift | reject contractionStructureStatus | reject | contractionStructureStatus | mínimos no sostienen la base
OK | synthetic-special | pattern-valid-structure-allows-count-pass | contractionStructureStatus | contractionStructureStatus | pattern active | ok | pass | pass | - | -
OK | synthetic-special | pattern-partial-volume-rejects-dry-up-filter | patternDataStatus | patternVolumeEligible | maxVolumeDryUpRatio | partial_volume | reject patternDataStatus | reject | patternDataStatus | volumen no fiable para validar volumen seco
OK | synthetic-special | requireStage2-confirmed-pass | requireStage2 | stage2 structure | 1 | confirmed | pass | pass | - | -
OK | synthetic-special | requireStage2-broken-stack-reject | requireStage2 | sma stack | 1 | sma50<sma150 | reject requireStage2 | reject | requireStage2 | SMA50 diaria no supera SMA150
OK | synthetic-special | requireRecentIpo-age-boundary-pass | maxIpoAgeMonths | ipoAgeMonths | 12 | 12 | pass | pass | - | -
OK | synthetic-special | requireRecentIpo-age-over-reject | maxIpoAgeMonths | ipoAgeMonths | 12 | 13 | reject requireRecentIpo | reject | requireRecentIpo | IPO no reciente <= 12m
OK | synthetic-null | requireRecentIpo-null-reject | maxIpoAgeMonths | ipoAgeMonths | 12 | null | reject requireRecentIpo | reject | requireRecentIpo | IPO no reciente <= 12m
OK | synthetic-mode | setupMode-nearPivot-score-only-reject | setupMode | distance/spread/ext | nearPivot | -6/10/18 no method pivot | reject setupMode | reject | setupMode | Vigilancia pivot: contrato compartido no validado, pivot metodológico no validado, dist20 -6 >= -6, spread 10.0 <= 10.0, ext 18.0 <= 18.0
OK | synthetic-mode | setupMode-nearPivot-boundary-pass | setupMode | method-pivot/distance/spread/ext | nearPivot | -4 pivot/-6/10/18 | pass | pass | - | -
OK | synthetic-mode | setupMode-nearPivot-contract-score-reject | setupMode | method-pivot/contract-score | nearPivot | score 40 | reject setupMode | reject | setupMode | Vigilancia pivot: contrato compartido no validado, pivot metodológico validado, dist20 -6 >= -6, spread 10.0 <= 10.0, ext 18.0 <= 18.0
OK | synthetic-mode | setupMode-nearPivot-partial-volume-reject | setupMode | method-pivot/partial-volume | nearPivot | partial_volume | reject setupMode | reject | setupMode | Vigilancia pivot: contrato compartido no validado, pivot metodológico no validado, dist20 -6 >= -6, spread 10.0 <= 10.0, ext 18.0 <= 18.0
OK | synthetic-mode | setupMode-nearPivot-extension-reject | setupMode | extSma50 | nearPivot | 18.1 | reject setupMode | reject | setupMode | Vigilancia pivot: contrato compartido no validado, pivot metodológico no validado, dist20 -2 >= -6, spread 5 <= 10.0, ext 18.1 <= 18.0
OK | synthetic-mode | setupMode-pullback-window-pass | setupMode | price/sma50/ext/distance52w/perf6m | pullback | 100/100/0/-20/8 | pass | pass | - | -
OK | synthetic-mode | setupMode-pullback-contract-score-reject | setupMode | composite | pullback | 40 | reject setupMode | reject | setupMode | Pullback SMA50: contrato compartido no validado, precio 100 > SMA200 70.0, precio/SMA50 100 => ext calc 0, ext 0 entre -3 y 8, 52w -20.0 >= -30, 6M 12.0 >= 8
OK | synthetic-mode | setupMode-pullback-stale-extension-reject | setupMode | price/sma50/ext | pullback | 80/100/0 | reject setupMode | reject | setupMode | Pullback SMA50: contrato compartido no validado, precio 80.0 > SMA200 70.0, precio/SMA50 100 => ext calc -20.0, ext 0 entre -3 y 8, 52w -20.0 >= -30, 6M 12.0 >= 8
OK | synthetic-mode | setupMode-pullback-extension-reject | setupMode | extSma50 | pullback | 10 | reject setupMode | reject | setupMode | Pullback SMA50: contrato compartido no validado, precio 100 > SMA200 72.0, precio/SMA50 92.0 => ext calc 8.70, ext 10.0 entre -3 y 8, 52w -20.0 >= -30, 6M 12.0 >= 8
OK | synthetic-mode | setupMode-early-boundary-pass | setupMode | distance52w/perf3m/ext | early | -35/5/20 | pass | pass | - | -
OK | synthetic-mode | setupMode-ipoRecent-boundary-pass | setupMode | ipo/momentum/ext | ipoRecent | 10/35/35 | pass | pass | - | -
OK | synthetic-mode | setupMode-ipoRecent-old-reject | setupMode | ipoAgeMonths | ipoRecent | 13 | reject setupMode | reject | setupMode | IPO reciente: contrato compartido no validado, edad 13.0m <= 12.0m, 52w -35.0 >= -35, ext 35.0 <= 35.0, momentum 35.0 >= 35.0
OK | synthetic-mode | setupMode-ipoRecent-long-bias-reject | setupMode | ipo/long-bias | ipoRecent | price below SMA200 | reject setupMode | reject | setupMode | IPO reciente: contrato compartido no validado, edad 10.0m <= 12.0m, 52w -20.0 >= -35, ext 20.0 <= 35.0, momentum 60.0 >= 35.0
OK | synthetic-mode | setupMode-extended-boundary-pass | setupMode | price/sma50/ext/momentum | extended | 115/100/15/65 | pass | pass | - | -
OK | synthetic-mode | setupMode-extended-stale-extension-reject | setupMode | price/sma50/ext | extended | 90/100/15 | reject setupMode | reject | setupMode | Extendida fuerte: contrato compartido no validado, precio/SMA50 100 => ext calc -10, ext 15.0 entre 15.0 y 25.0, momentum 80.0 >= 65.0
OK | synthetic-mode | setupMode-extended-underextension-reject | setupMode | extSma50 | extended | 14.9 | reject setupMode | reject | setupMode | Extendida fuerte: contrato compartido no validado, precio/SMA50 100 => ext calc 14.9, ext 14.9 entre 15.0 y 25.0, momentum 80.0 >= 65.0
OK | synthetic-mode | setupMode-weakness-boundary-pass | minWeaknessScore | weaknessScore | 55 | 55 | pass | pass | - | -
OK | synthetic-mode | setupMode-weakness-below-reject | minWeaknessScore | weaknessScore | 55 | 54.9 | reject minWeaknessScore | reject | minWeaknessScore | deterioro 55 < 55
OK | frozen-real | meta-vcp-plan-2024-01-05:strict-vcp-plan-pass | requireContractionsDecreasing, minContractionCount, maxContraction1DepthPct, maxContraction2DepthPct, maxContraction3DepthPct, maxLastContractionDepthPct, maxAbsDistanceToPivotPct, maxVolumeDryUpRatio, minPatternQualityScore | META | 2024-01-05 | meta-vcp-plan-2024-01-05 | pass | pass | - | -
OK | frozen-real | 3988-hk-vcp-plan-2026-05-28:strict-vcp-plan-pass | requireContractionsDecreasing, minContractionCount, maxContraction1DepthPct, maxContraction2DepthPct, maxContraction3DepthPct, maxLastContractionDepthPct, maxAbsDistanceToPivotPct, maxVolumeDryUpRatio, minPatternQualityScore | 3988.HK | 2026-05-28 | 3988-hk-vcp-plan-2026-05-28 | pass | pass | - | -
OK | frozen-real | nvda-pivot-squeeze-2024-05-22:pivot-squeeze-watch-pass | requireContractionsDecreasing, minContractionCount, maxContraction1DepthPct, maxContraction2DepthPct, maxAbsDistanceToPivotPct, maxVolumeDryUpRatio, minPatternQualityScore | NVDA | 2024-05-22 | nvda-pivot-squeeze-2024-05-22 | pass | pass | - | -
OK | frozen-real | nvda-pivot-squeeze-2024-05-22:strict-vcp-rejects-two-contraction-watch | requireContractionsDecreasing, minContractionCount | NVDA | 2024-05-22 | nvda-pivot-squeeze-2024-05-22 | reject minContractionCount | reject | minContractionCount | contracciones 2.00 < 3
OK | frozen-real | brk-b-lower-low-drift-2026-06-02:rejects-lower-low-drift | requireContractionsDecreasing, minContractionCount | BRK-B | 2026-06-02 | brk-b-lower-low-drift-2026-06-02 | reject contractionStructureStatus | reject | contractionStructureStatus | mínimos no sostienen la base
OK | frozen-real | aapl-observe-too-far-2022-02-22:rejects-observe-far-from-pivot | maxAbsDistanceToPivotPct | AAPL | 2022-02-22 | aapl-observe-too-far-2022-02-22 | reject maxAbsDistanceToPivotPct | reject | maxAbsDistanceToPivotPct | distancia pivot 10.10 > 6
OK | frozen-real | msft-no-base-2026-06-02:rejects-missing-contractions | minContractionCount | MSFT | 2026-06-02 | msft-no-base-2026-06-02 | reject minContractionCount | reject | minContractionCount | contracciones 0.00 < 2
