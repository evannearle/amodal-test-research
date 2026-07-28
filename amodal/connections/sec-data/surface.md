# SEC EDGAR: Submissions & XBRL Financial Facts

Structured data endpoints. All CIKs here must be zero-padded to 10 digits (e.g. `0000320193`).

- `GET /submissions/CIK{cik10}.json`: company profile plus filing history.
  - `name`, `sicDescription` (industry), `addresses`, `tickers`, `exchanges`, `fiscalYearEnd`, `formerNames`.
  - `filings.recent` is a set of parallel arrays (`form`, `filingDate`, `accessionNumber`, `primaryDocument`, `reportDate`, ...) — the same index across arrays describes one filing. Filter `form` for `"10-K"` (annual business + strategy narrative) or `"DEF 14A"` (proxy statement — leadership, director/officer bios, compensation) to find the filings worth reading. Older filings are paginated via `filings.files`; usually the most recent 10-K and most recent DEF 14A in `filings.recent` are enough.
  - Use the matching `accessionNumber` and `primaryDocument` with the `sec-tickers` connection's Archives endpoint to fetch the actual document text.

- `GET /api/xbrl/companyfacts/CIK{cik10}.json`: all XBRL-tagged financial facts the company has ever reported, organized by taxonomy (`facts.us-gaap`) and tag (e.g. `Revenues`, `NetIncomeLoss`, `Assets`, `Liabilities`, `StockholdersEquity`, `EarningsPerShareDiluted`, `OperatingIncomeLoss`). Each tag has a `units` object (usually `USD` or `USD-per-shares`) containing an array of reported values with `end` (period end date), `val`, `fy` (fiscal year), `fp` (fiscal period, e.g. `FY`, `Q1`), and `form` (which filing reported it). To report "current" financials, pick the most recent `fy`/`fp` entries with `form` of `10-K` (annual) or `10-Q` (quarterly).

- `GET /api/xbrl/companyconcept/CIK{cik10}/us-gaap/{tag}.json`: same shape as above but scoped to one tag — use this when you only need one metric's history instead of the full companyfacts dump.

Not every company reports every tag under `us-gaap` — some use different tags or the `dei` taxonomy. If a tag is missing, check `facts.us-gaap` for the closest equivalent before concluding the data isn't available.

Read-only. There are no write endpoints on this connection.
