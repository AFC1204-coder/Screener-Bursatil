# StatsEdge data licensing audit

Last reviewed: 2026-05-17.

This is an engineering compliance checklist, not legal advice. Before turning StatsEdge into a public/commercial product, validate the final data model and UI display with counsel or with each provider in writing.

## Operating rule

StatsEdge should treat third-party market data as licensed input, not as owned content.

- Prefer official public/regulatory datasets for universe membership, issuer filings and delayed regulatory short-interest data.
- Cache data server-side only to reduce load and preserve reproducibility; do not expose raw bulk provider datasets through public APIs.
- Display provider, delay, methodology and coverage score when data affects a screen/filter.
- Store derived screener outputs and normalized internal fields, but avoid reselling or exporting provider OHLCV/fundamental datasets.
- Productize leaderboards and watchlists as derived rankings: Top country/sector lists are acceptable product output when they do not expose complete raw exchange/provider datasets.
- Keep Yahoo/Stooq-style web endpoints as prototype/fallback sources, not as the legal backbone of a commercial screener.
- Add a provider only after deciding whether the intended use is personal research, internal business use, public display, or redistribution.

## Current providers

| Provider | Current use | Legal posture | Decision |
| --- | --- | --- | --- |
| SEC EDGAR | US fundamentals fallback | Official public API. Requires fair-access behavior, proper `User-Agent`, caching and no abusive automation. | Keep. Low legal risk if rate-limited and attributed. |
| NasdaqTrader Symbol Directory | US universe | NasdaqTrader states symbol directory data is available without further licensing restriction on its Symbol Search page, but this is universe metadata only. | Keep for universe, not for quote data. |
| OpenFIGI | ISIN/FIGI/MIC/symbol mapping | FIGI identifiers are public-domain/open for use and redistribution; related descriptions have disclaimers and no trademark endorsement. | Keep. Best low-risk global identifier layer. |
| ASIC short position reports | Australia short-interest proxy | Official regulator publication. Data is aggregated, delayed and methodology-specific. | Keep, label as ASIC aggregate `% of total product in issue`, not US short float. |
| HKEX Full List of Securities | Hong Kong universe | Public exchange workbook, but HKEX market data licensing is strict for data display/redistribution. | Keep for internal universe discovery; do not redistribute full workbook or market prices. |
| J-Quants | Japan universe/OHLCV/fundamentals once configured | Official JPX/J-Quants service with Free/paid plans. V2 uses API-key authentication and includes official Japan equity data. Needs plan-specific review for display, redistribution, caching and public/commercial use. | Use Free for private prototype/internal cache; before public release, move to a plan/permission matching the product. |
| filings.xbrl.org / ESEF | Planned Europe annual filings | Public XBRL repository/API, not comprehensive and not fully validated against all country rules. Filing content may originate from issuers/OAMs. | Good next free source for annual fundamentals, with source links and validation warnings. |
| Yahoo Finance-style endpoints | Primary chart/profile/news/fundamentals | High risk for commercial reliance: unofficial/fragile endpoints and Yahoo API terms are revocable/restrictive. | Keep only for local research/prototype and fallback. Replace for production backbone. |
| Stooq CSV | OHLCV fallback | Terms are not clear enough for public product reliance; automated/bulk access may be blocked. | Use cautiously as private fallback only. Do not build broad public coverage on it. |
| Alpha Vantage | Optional OHLCV fallback | Free key exists, but terms and quotas must match use case; commercial/public display may require permission/paid plan. | Use as low-volume fallback only. |
| Financial Modeling Prep | Optional profile/fundamentals | API license is limited/revocable and plan-dependent; redistribution/display needs the right subscription. | Use only if configured; validate paid/commercial tier before production. |
| Google News RSS / Yahoo News | News headlines/links | Google News RSS endpoints are not a clean official product API; publisher content rights remain with publishers. | Avoid storing article bodies/images. Store title, source, URL and tiny derived sentiment only. |
| X API v2 | Social sentiment | X API content has strict developer agreement, display, retention and redistribution rules. | Optional only. Do not redistribute post content; store aggregate sentiment if allowed by plan. |

## Planned premium candidates

| Provider | Legal note | Practical stance |
| --- | --- | --- |
| EODHD | Terms distinguish personal/commercial use; ask provider if unsure. | Strong low-cost candidate, but only after confirming commercial/display rights. |
| Twelve Data | Commercial use/display and redistribution are plan/exchange-license dependent; ASX public display may require official ASX redistribution rights. | Good API shape, but licensing can become the real cost. |
| Marketstack | Terms allow limited in-app display to end users but restrict transfer/public redistribution outside the app. | Possible for EOD display, not as public downloadable dataset. |
| Finnhub | Treat as plan-limited and not a safe free global backbone without written confirmation. | Defer until there is a specific feature need. |

## Implementation guardrails

1. Add a `legalUse` profile per provider: `internal-research`, `public-display`, `redistribution`, `unknown`.
2. Keep scan/cache endpoints authenticated or server-only when they can expose bulk data.
3. Public UI should show derived metrics, rankings and single-symbol chart views, not bulk downloadable provider data.
4. Add per-provider throttling and daily batch jobs instead of live mass scans.
5. Keep source attribution fields in `daily_bars`, `fundamental_snapshots`, `universe_snapshot_symbols` and scan exports.
6. For Japan, do not activate broad public J-Quants display until the selected plan permits our exact use case.
7. For Europe, start with filings.xbrl.org/ESEF annual issuer facts; avoid exchange price feeds until licensing is clear.
8. Leaderboard endpoints should cap results and omit raw provider payloads; use them as the public discovery surface instead of exposing full universes.
9. J-Quants refresh jobs should stay bounded by `limit` and feed derived rankings/fichas, not public bulk downloads.

## Source links reviewed

- SEC data APIs and fair access: https://data.sec.gov/ and https://www.sec.gov/about/developer-resources
- NasdaqTrader Symbol Directory: https://nasdaqtrader.com/Trader.aspx?id=symbollookup
- OpenFIGI terms and FAQ: https://www.openfigi.com/docs/terms-of-service and https://www.openfigi.com/docs/faqs
- ASIC short selling reports: https://www.asic.gov.au/regulatory-resources/markets/short-selling/
- HKEX securities lists and market data licensing pages: https://www.hkex.com.hk/services/trading/securities/securities-lists?sc_lang=en and https://www.hkex.com.hk/Services/Market-Data-Services/Real-Time-Data-Services/Data-Licensing/
- J-Quants API overview and V2 update: https://www.jpx.co.jp/english/markets/other-data-services/j-quants-api/ and https://www.jpx.co.jp/english/corporate/news/news-releases/6020/20260119.html
- filings.xbrl.org about/API: https://filings.xbrl.org/docs/about and https://filings.xbrl.org/docs/api
- Yahoo API terms: https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html
- Alpha Vantage support/terms: https://www.alphavantage.co/support/ and https://www.alphavantage.co/terms_of_service/
- FMP terms/pricing: https://site.financialmodelingprep.com/developer/docs/terms-of-service and https://site.financialmodelingprep.com/developer/docs/pricing
- Google terms: https://policies.google.com/terms
- X Developer Agreement/Policy: https://docs.x.com/developer-terms/agreement and https://docs.x.com/developer-terms/policy
- EODHD terms: https://eodhd.com/financial-apis/terms-conditions
- Twelve Data commercial/attribution notes: https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage and https://support.twelvedata.com/en/articles/12647398-attribution-guidelines-for-using-twelve-data
- Marketstack terms: https://marketstack.com/terms
