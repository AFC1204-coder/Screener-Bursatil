# StatsEdge data licensing audit

Last reviewed: 2026-05-19.

This is an engineering compliance checklist, not legal advice. Before turning StatsEdge into a public/commercial product, validate the final data model and UI display with counsel or with each provider in writing.

## Operating rule

StatsEdge should treat third-party market data as licensed input, not as owned content.

- Prefer official public/regulatory datasets for universe membership, issuer filings and delayed regulatory short-interest data.
- Cache data server-side only to reduce load and preserve reproducibility; do not expose raw bulk provider datasets through public APIs.
- Display provider, delay, methodology and coverage score when data affects a screen/filter.
- Store derived screener outputs and normalized internal fields, but avoid reselling or exporting provider OHLCV/fundamental datasets.
- Productize leaderboards and watchlists as derived rankings: Top country/sector lists are acceptable product output when they do not expose complete raw exchange/provider datasets.
- Treat hidden universes as an internal processing pattern, not as a legal workaround. If a source prohibits bulk, non-display, redistribution or commercial use without a license, hiding the rows from the UI is not enough.
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
| TWSE ISIN listed equities | Taiwan universe | Official public listed-equities page. Related Taiwan open-data materials use OGDL-Taiwan-1.0 with free, non-exclusive use and attribution requirements; still avoid turning it into a bulk redistribution feed. | Keep for universe discovery and derived rankings; attribute TWSE/FSC/data.gov.tw where shown. |
| ESMA FIRDS / FCA FIRDS | Europe/EEA and UK reference-data universe | Regulatory reference data files are machine-readable and include ISIN/MIC/reference fields. ESMA is useful for Europe/EEA; UK is handled with FCA FIRDS separately. They are good for universe discovery and mapping, not for OHLCV, fundamentals or direct Yahoo tickers. | ESMA and FCA FIRDS are implemented as opt-in internal reference adapters with capped OpenFIGI ISIN resolution. Cache internally and expose derived/capped output; do not treat them as exchange price/display rights. |
| Curated core universes | Canada, Singapore, South Africa plus deferred India/Israel seed universes | Manual high-liquidity ticker lists, not copied from exchange bulk directories. Avoids scraping TMX/NSE/BSE/TASE/SGX/JSE data products while preserving useful screening coverage. | Keep Canada/SG/ZA as useful partial coverage. Keep India/Israel deferred/manual unless user demand justifies licensing work. |
| TMX / TSX / TSXV listed issuer data | Canada full official universe | TMX materials describe listed issuer data as proprietary/copyrighted and not public domain; use/display depends on agreements/distributors. | Do not scrape or redistribute as free full universe. Use curated CA core or licensed provider. |
| Euronext/Nasdaq Nordic/SIX/LSE exchange feeds | Europe/Nordics official exchange reference/price feeds | Exchange reference data and EOD/real-time products are generally licensed products. Nasdaq Nordic sells EOD/historical feeds; Euronext reference files are sold through data products; SIX/LSE need separate review. | Use ESMA/FCA FIRDS for free universe discovery first; use exchange feeds only with permission/licence. |
| NSE/BSE market data | India full official universe/OHLCV | NSE policy treats identifiers, prices, volumes, EOD, historical and corporate data as Market Data subject to agreements; BSE sells/reference-data products. | Do not bulk ingest from NSE/BSE as free product backbone. Use curated IN core until licensed. |
| TASE market data/API/data files | Israel full universe/OHLCV/short data | TASE publishes securities pages, but its Data Hub/API and current/historical securities products have internal-use/distribution pricing. | Do not bypass paid data products. Use curated IL core; paid/permissioned TASE later. |
| SGX market data | Singapore full universe/OHLCV | SGX Market Data Policy explicitly covers use, redistribution, display and non-display usage of SGX market data. | Do not bulk ingest/redistribute as free backbone. Use curated SG core; SGX/proveedor licensed later. |
| JSE market data | South Africa full universe/OHLCV | JSE Market Data Policies treat display, end-of-day, live snapshots, feeds and external end users as licensed/fee-sensitive use cases. | Do not bulk ingest/redistribute as free backbone. Use curated JSE core; licensed source later. |
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
7. For Taiwan, keep TWSE/TPEx source data server-side and expose capped derived results, not a public bulk copy of the listing table.
8. For Canada, Singapore and South Africa, keep the free path as curated core lists plus derived rankings; do not scrape complete exchange directories or data-product endpoints. For India/Israel, keep only deferred/manual curated coverage until demand changes.
9. For Europe, start with ESMA FIRDS for EEA universe/reference mapping, FCA FIRDS for UK as a separate step, and filings.xbrl.org/ESEF for annual issuer facts; avoid exchange price feeds until licensing is clear.
10. Leaderboard endpoints should cap results and omit raw provider payloads; use them as the public discovery surface instead of exposing full universes.
11. J-Quants refresh jobs should stay bounded by `limit` and feed derived rankings/fichas, not public bulk downloads.
12. Price freshness must gate ranking-eligible output: cached stale prices may support diagnostics/history, but not current leadership claims.
13. Shadow universe persistence (`shadow_instruments`, `symbol_resolutions`) is internal reference plumbing. It does not grant rights to expose raw exchange datasets, and it should feed only freshness-gated scans and capped derived leaderboards.

## Source links reviewed

- SEC data APIs and fair access: https://data.sec.gov/ and https://www.sec.gov/about/developer-resources
- NasdaqTrader Symbol Directory: https://nasdaqtrader.com/Trader.aspx?id=symbollookup
- OpenFIGI terms and FAQ: https://www.openfigi.com/docs/terms-of-service and https://www.openfigi.com/docs/faqs
- ASIC short selling reports: https://www.asic.gov.au/regulatory-resources/markets/short-selling/
- HKEX securities lists and market data licensing pages: https://www.hkex.com.hk/services/trading/securities/securities-lists?sc_lang=en and https://www.hkex.com.hk/Services/Market-Data-Services/Real-Time-Data-Services/Data-Licensing/
- TWSE ISIN listed equities and Taiwan open-data license: https://isin.twse.com.tw/isin/e_C_public.jsp?strMode=2 and https://data.gov.tw/en/license
- Taiwan FSC government website open-information statement: https://www.sfb.gov.tw/en/main.jsp?dataserno=201605130002&mtitle=Government+Website+Open+Information+Announcement&websitelink=artsublink.jsp
- ESMA FIRDS instructions: https://www.esma.europa.eu/sites/default/files/library/esma65-8-5014_firds_-_instructions_for_download_of_full_and_delta_reference_files.pdf
- FCA instrument reference data and FIRDS access: https://www.fca.org.uk/markets/transaction-reporting/instrument-reference-data and https://www.fca.org.uk/publication/systems-information/fca-firds-tech-spec.pdf
- Euronext reference data products: https://live.euronext.com/en/datashop/reference-data
- Nasdaq Nordic & Baltic equity data products: https://www.nasdaq.com/solutions/data/equities/Nordic-Baltic
- TMX listed issuer data agreement: https://www.tsx.com/en/resource/2908/
- NSE data usage and sharing policy: https://www.nseindia.com/static/market-data/nse-data-policy
- BSE market data products: https://www.bseindia.com/market_data_products.html
- TASE securities page and 2026 data product price list: https://market.tase.co.il/en/market_data/securities and https://content.tase.co.il/media/4imn13pz/2001_api_pricelist_2026_eng.pdf
- SGX Market Data Policy: https://www.datadirect.sgx.com/Market-Data-Policy
- JSE Market Data Policies: https://www.jse.co.za/sites/default/files/jse_document_manager/RW/Internal/JSE%20Data%20Agreements/Equities%2C%20Derivatives%20and%20Interest%20Rates/01.%20JSE%20Market%20Data%20Policies.pdf
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
