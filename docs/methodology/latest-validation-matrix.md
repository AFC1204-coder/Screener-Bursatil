# Methodology Validation Matrix

Dataset version: 1
Base URL: http://127.0.0.1:3000
Refresh: no · Profile max age: 14d · Price max age: 5d
Cases: 34 · Passed: 34 · Failed: 0
Calibration: checked 26 · mismatches 0 · actual block 27 / observe 2 / watch 5 / plan 0
Calibration guardrails: OK

| Result | Symbol | Theme | Display verdict | Calibration | Claim block | Confidence | Plan valid | Evidence | Failed checks |
|---|---|---|---|---|---:|---|---:|---|---|
OK | AAPL | Consumer tech / hardware | Base en vigilancia (constructive_base/watch) | watch/not_plan | no | Dato usable | no | 9.0% -> 3.9%; solo 2 contracciones utiles; 2 contr.; pivot -2.8%; vol 0.95x; q 76; 1000 barras | -
OK | NVDA | Semis / fotonica | No VCP claro (not_actionable/blocked) | block/not_plan | no | Dato usable | no | 16.9% -> 9.1% -> 9.4% -> 10.2%; ultima contraccion se re-expande; 4 contr.; pivot -8.7%; vol 1.14x; q 48; 1000 barras | -
OK | MSFT | Software / IA | Sin base validada (no_base/blocked) | block/not_plan | no | Dato usable | no | Base 23.8%; base reciente no confirmada; 0 contr.; pivot -5.4%; vol 1.10x; q 0; 668 barras | -
OK | META | Internet / plataformas | No VCP claro (not_actionable/blocked) | block/block | no | Dato usable | no | 15.6% -> 5.2% -> 5.6%; ultima contraccion se re-expande; 3 contr.; pivot -13.6%; vol 0.61x; q 66; 667 barras | -
OK | GOOGL | Internet / plataformas | No VCP claro (not_actionable/blocked) | block/block | no | Dato usable | no | 15.1% -> 3.5% -> 14.1% -> 6.3%; contracciones no decrecientes; 4 contr.; pivot -11.4%; vol 0.68x; q 57; 757 barras | -
OK | AMZN | Internet / plataformas | No VCP claro (not_actionable/blocked) | block/block | no | Dato usable | no | 20.9% -> 20.4% -> 6.5% -> 5.3%; contracciones no decrecientes; 4 contr.; pivot -7.9%; vol 0.54x; q 74; 846 barras | -
OK | TSLA | Autos / movilidad | No VCP claro (not_actionable/blocked) | block/block | no | Dato usable | no | 16.2% -> 6.7% -> 12.5% -> 11.1%; contracciones no decrecientes; 4 contr.; pivot -6.5%; vol 0.44x; q 65; 689 barras | -
OK | AVGO | Semis / fotonica | No VCP claro (not_actionable/blocked) | block/block | no | Dato usable | no | 12.6% -> 8.1% -> 9.8% -> 8.3%; contracciones no decrecientes; 4 contr.; pivot -1.5%; vol 0.64x; q 47; 1000 barras | -
OK | AMD | Semis / fotonica | Sin base validada (no_base/blocked) | block/block | no | Dato usable | no | Base 64.3%; base reciente no confirmada; 0 contr.; pivot -1.1%; vol 0.85x; q 0; 1000 barras | -
OK | TSM | Semis / fotonica | No VCP claro (not_actionable/blocked) | block/block | no | Dato usable | no | 19.6% -> 5.9% -> 10.5% -> 13.0%; ultima contraccion se re-expande; 4 contr.; pivot -0.6%; vol 0.50x; q 55; 835 barras | -
OK | ASML.AS | Semis / fotonica | Sin base validada (no_base/blocked) | block/block | no | Dato usable | no | Base 29.3%; base reciente no confirmada; 0 contr.; pivot 0.4%; vol 0.47x; q 0; 837 barras | -
OK | ARM | Semis / fotonica | Sin base validada (no_base/blocked) | block/block | no | Dato usable | no | Base 74.0%; base reciente no confirmada; 0 contr.; pivot -5.9%; vol 1.19x; q 0; 552 barras | -
OK | PANW | Software / IA | Sin base validada (no_base/blocked) | block/block | no | Dato usable | no | Base 52.6%; base reciente no confirmada; 0 contr.; pivot -1.9%; vol 0.76x; q 0; 667 barras | -
OK | CRWD | Software / IA | Sin base validada (no_base/blocked) | block/block | no | Dato usable | no | Base 54.3%; base reciente no confirmada; 0 contr.; pivot -2.1%; vol 1.05x; q 0; 777 barras | -
OK | NET | Software / IA | Sin base validada (no_base/blocked) | block/block | no | Dato usable | no | Base 40.3%; base reciente no confirmada; 0 contr.; pivot -0.7%; vol 0.83x; q 0; 762 barras | -
OK | PLTR | Software / IA | No VCP claro (not_actionable/blocked) | block/block | no | Dato usable | no | 23.5% -> 10.4% -> 8.0% -> 16.1%; ultima contraccion se re-expande; 4 contr.; pivot -7.0%; vol 0.83x; q 50; 707 barras | -
OK | SAP.DE | Software / IA | Base en vigilancia (vcp_watch/watch) | watch/not_plan | no | Dato usable | no | 21.4% -> 8.5% -> 7.0%; contexto de base 42 < 45; 3 contr.; pivot -7.4%; vol 0.58x; q 67; 838 barras | -
OK | LLY | Medtech / biotech | No VCP claro (not_actionable/blocked) | block / - | no | Dato usable | no | 13.3% -> 8.0% -> 7.9% -> 5.3%; contracciones no decrecientes; 4 contr.; pivot -7.2%; vol 0.95x; q 61; 673 barras | -
OK | NVO | Medtech / biotech | Sin base validada (no_base/blocked) | block / - | no | Dato usable | no | Base 95.8%; subida persistente sin base clara; 0 contr.; pivot -69.0%; vol 2.18x; q 0; 182 barras | -
OK | ISRG | Medtech / biotech | Base medible (base_measurable/blocked) | observe/observe | no | Dato usable | no | 15.6% -> 9.7%; Base medible, pero pivot a -21.4%; fuera de zona de vigilancia.; 2 contr.; pivot -21.4%; vol 0.71x; q 54; 807 barras | -
OK | TMO | Medtech / biotech | Base no confirmada (not_actionable/blocked) | block / - | no | Dato usable | no | 23.3%; solo 1 contracciones utiles; 1 contr.; pivot -10.5%; vol 1.15x; q 35; 673 barras | -
OK | JPM | Finanzas | Base en vigilancia (constructive_base/watch) | watch/not_plan | no | Dato usable | no | 10.7% -> 8.3%; solo 2 contracciones utiles; 2 contr.; pivot -6.0%; vol 1.00x; q 72; 673 barras | -
OK | BRK-B | Finanzas | Base en vigilancia (vcp_watch/watch) | watch / - | no | Dato usable | no | 6.6% -> 4.9% -> 2.8%; pivot a -6.9%; 3 contr.; pivot -6.9%; vol 0.59x; q 89; 858 barras | -
OK | XOM | Energia / red | Base medible (base_measurable/blocked) | observe/observe | no | Dato usable | no | 19.5% -> 7.6%; Base medible, pero pivot a -14.6%; fuera de zona de vigilancia.; 2 contr.; pivot -14.6%; vol 0.47x; q 65; 672 barras | -
OK | COST | Consumo / marca | Sin base validada (no_base/blocked) | block / - | no | Dato usable | no | Base 14.7%; base reciente no confirmada; 0 contr.; pivot -13.0%; vol 0.62x; q 0; 663 barras | -
OK | MCD | Consumo / marca | No VCP claro (not_actionable/blocked) | block / - | no | Dato usable | no | 18.3% -> 3.1% -> 13.0%; ultima contraccion se re-expande; 3 contr.; pivot -18.7%; vol 0.57x; q 62; 667 barras | -
OK | LULU | Consumo / marca | Sin base validada (no_base/blocked) | block / - | no | Dato usable | no | Base 77.4%; base reciente no confirmada; 0 contr.; pivot -75.5%; vol 1.20x; q 0; 228 barras | -
OK | RHM.DE | Defensa / aeroespacial | No VCP claro (not_actionable/blocked) | block / - | no | Dato usable | no | 24.3% -> 12.3% -> 13.8%; ultima contraccion se re-expande; 3 contr.; pivot -32.4%; vol 0.51x; q 39; 834 barras | -
OK | 0700.HK | Internet / plataformas | Base no confirmada (not_actionable/blocked) | block/block | no | Dato usable | no | 20.2%; solo 1 contracciones utiles; 1 contr.; pivot -18.4%; vol 0.88x; q 33; 749 barras | -
OK | 9988.HK | Internet / plataformas | No VCP claro (not_actionable/blocked) | block/block | no | Dato usable | no | 23.1% -> 9.0% -> 12.8%; ultima contraccion se re-expande; 3 contr.; pivot -12.1%; vol 1.23x; q 43; 837 barras | -
OK | 1810.HK | Consumer tech / hardware | No VCP claro (not_actionable/blocked) | block/block | no | Dato usable | no | 16.8% -> 5.2% -> 15.2%; ultima contraccion se re-expande; 3 contr.; pivot -23.1%; vol 1.13x; q 36; 905 barras | -
OK | 3988.HK | Finanzas | Compresion de pivot (pivot_squeeze/watch) | watch/watch | no | Dato usable | no | 5.7% -> 3.0%; rango estrecho cerca de pivot -1.1%; 2 contr.; pivot -1.1%; vol 0.59x; q 85; 719 barras | -
OK | WELL | Inmobiliario / REIT | Base no confirmada (not_actionable/blocked) | block/block | no | Dato usable | no | 10.2% -> 7.5% -> 5.0% -> 4.5%; calidad 62 < 65; 4 contr.; pivot -11.9%; vol 1.25x; q 62; 678 barras | -
OK | MAR | Consumo / marca | No VCP claro (not_actionable/blocked) | block/block | no | Dato usable | no | 12.2% -> 4.1% -> 5.1%; ultima contraccion se re-expande; 3 contr.; pivot -2.9%; vol 0.51x; q 76; 839 barras | -
