# VCP Corpus Audit

Dataset version: 1
Base URL: http://127.0.0.1:3000
Refresh: yes · Price max age: 5d
Cases: 18 · Passed: 18 · Failed: 0
Calibration: checked 18 · mismatches 0 · actual block 6 / observe 3 / watch 7 / plan 2
Calibration guardrails: OK

| Result | Case | Symbol | As of | Actual | Expected | Visual | Diagnostic | Contractions | Failed checks |
|---|---|---|---|---|---|---|---|---|---|
OK | meta-actionable-vcp-2024-01-05 | META | 2024-01-05 | VCP plan válido (actionable_vcp/actionable) | plan | [SVG](vcp-visuals/meta-actionable-vcp-2024-01-05.svg) | VCP estricto validado.; estructura ok; pivot -2.7%; vol 0.75x; q 80; 651 barras | 14.3% -> 8.5% -> 6.0% | -
OK | 3988-hk-actionable-vcp-2026-05-28 | 3988.HK | 2026-05-28 | VCP plan válido (actionable_vcp/actionable) | plan | [SVG](vcp-visuals/3988-hk-actionable-vcp-2026-05-28.svg) | VCP estricto validado.; estructura ok; pivot -3.8%; vol 0.90x; q 83; 1221 barras | 7.8% -> 4.6% -> 3.0% | -
OK | isrg-vcp-watch-2025-07-15 | ISRG | 2025-07-15 | Base en vigilancia (vcp_watch/watch) | watch | [SVG](vcp-visuals/isrg-vcp-watch-2025-07-15.svg) | pivot a -9.9%; estructura ok; pivot -9.9%; vol 1.01x; q 73; 1031 barras | 16.4% -> 12.5% -> 7.0% -> 3.1% | -
OK | nvda-pivot-squeeze-2024-05-22 | NVDA | 2024-05-22 | Compresión de pivot (pivot_squeeze/watch) | watch | [SVG](vcp-visuals/nvda-pivot-squeeze-2024-05-22.svg) | rango estrecho cerca de pivot -2.5%; estructura ok; pivot -2.5%; vol 0.78x; q 73; 746 barras | 16.7% -> 4.3% | -
OK | xom-vcp-watch-2024-04-17 | XOM | 2024-04-17 | Base en vigilancia (vcp_watch/watch) | watch | [SVG](vcp-visuals/xom-vcp-watch-2024-04-17.svg) | volumen seco 0.99x > 0.90x; estructura ok; pivot -4.1%; vol 0.99x; q 79; 721 barras | 8.4% -> 4.2% -> 3.3% | -
OK | mcd-constructive-watch-2023-11-29 | MCD | 2023-11-29 | Base constructiva (constructive_base/watch) | watch | [SVG](vcp-visuals/mcd-constructive-watch-2023-11-29.svg) | 2 contracciones útiles; estructura ok; pivot -1.8%; vol 0.88x; q 82; 626 barras | 14.0% -> 3.0% | -
OK | aapl-constructive-watch-2023-12-20 | AAPL | 2023-12-20 | Base constructiva (constructive_base/watch) | watch | [SVG](vcp-visuals/aapl-constructive-watch-2023-12-20.svg) | 2 contracciones útiles; estructura ok; pivot -2.4%; vol 1.15x; q 79; 641 barras | 9.1% -> 2.8% | -
OK | cost-constructive-watch-2026-05-07 | COST | 2026-05-07 | Base constructiva (constructive_base/watch) | watch | [SVG](vcp-visuals/cost-constructive-watch-2026-05-07.svg) | 2 contracciones útiles; estructura ok; pivot -2.2%; vol 0.98x; q 76; 1236 barras | 6.7% -> 3.1% | -
OK | well-vcp-watch-2026-05-14 | WELL | 2026-05-14 | Base en vigilancia (vcp_watch/watch) | watch | [SVG](vcp-visuals/well-vcp-watch-2026-05-14.svg) | contexto de base 42 < 45; estructura ok; pivot -1.8%; vol 0.98x; q 78; 1241 barras | 10.2% -> 7.5% -> 5.0% | -
OK | brk-b-observe-2022-07-11 | BRK-B | 2022-07-11 | Base medible (base_measurable/blocked) | observe | [SVG](vcp-visuals/brk-b-observe-2022-07-11.svg) | Base medible, pero pivot a -21.4%; fuera de zona de vigilancia.; estructura ok; pivot -21.4%; vol 0.79x; q 67; 276 barras | 17.4% -> 4.9% | -
OK | aapl-observe-2022-02-22 | AAPL | 2022-02-22 | Base medible (base_measurable/blocked) | observe | [SVG](vcp-visuals/aapl-observe-2022-02-22.svg) | Base medible, pero pivot a -10.1%; fuera de zona de vigilancia.; estructura ok; pivot -10.1%; vol 0.80x; q 68; 181 barras | 12.7% -> 5.7% | -
OK | msft-observe-2022-02-22 | MSFT | 2022-02-22 | Base medible (base_measurable/blocked) | observe | [SVG](vcp-visuals/msft-observe-2022-02-22.svg) | Base medible, pero pivot a -17.5%; fuera de zona de vigilancia.; estructura ok; pivot -17.5%; vol 0.93x; q 66; 181 barras | 19.8% -> 4.8% | -
OK | brk-b-lower-low-drift-2026-06-02 | BRK-B | 2026-06-02 | No VCP claro (not_actionable/blocked) | block | [SVG](vcp-visuals/brk-b-lower-low-drift-2026-06-02.svg) | mínimos no sostienen la base; estructura lower_low_drift; pivot -6.9%; vol 1.03x; q 67; 1253 barras | 6.7% -> 2.4% -> 6.0% | -
OK | 3988-hk-lower-low-drift-2026-06-03 | 3988.HK | 2026-06-03 | No VCP claro (not_actionable/blocked) | block | [SVG](vcp-visuals/3988-hk-lower-low-drift-2026-06-03.svg) | mínimos no sostienen la base; estructura lower_low_drift; pivot -1.1%; vol 0.94x; q 72; 1225 barras | 7.8% -> 4.6% -> 3.0% -> 4.2% | -
OK | isrg-lower-low-drift-2026-06-02 | ISRG | 2026-06-02 | No VCP claro (not_actionable/blocked) | block | [SVG](vcp-visuals/isrg-lower-low-drift-2026-06-02.svg) | mínimos no sostienen la base; estructura lower_low_drift; pivot -20.4%; vol 1.19x; q 43; 1253 barras | 13.8% -> 4.9% -> 10.5% | -
OK | aapl-lower-low-drift-2026-06-01 | AAPL | 2026-06-01 | No VCP claro (not_actionable/blocked) | block | [SVG](vcp-visuals/aapl-lower-low-drift-2026-06-01.svg) | mínimos no sostienen la base; estructura lower_low_drift; pivot -2.8%; vol 1.01x; q 60; 1252 barras | 9.0% -> 8.1% | -
OK | meta-reexpansion-2026-06-02 | META | 2026-06-02 | No VCP claro (not_actionable/blocked) | block | [SVG](vcp-visuals/meta-reexpansion-2026-06-02.svg) | mínimos no sostienen la base; estructura lower_low_drift; pivot -13.6%; vol 0.99x; q 53; 1253 barras | 22.6% -> 5.6% -> 12.1% | -
OK | msft-no-base-2026-06-02 | MSFT | 2026-06-02 | Sin base validada (no_base/blocked) | block | [SVG](vcp-visuals/msft-no-base-2026-06-02.svg) | base reciente no confirmada; estructura not_consolidating; pivot -5.4%; vol 1.09x; q 0; 1253 barras |  | -
