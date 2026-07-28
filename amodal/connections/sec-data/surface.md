# SEC EDGAR: Submissions & XBRL Financial Facts

Structured data endpoints. All CIKs here must be zero-padded to **exactly 10 characters** (e.g. `0000320193`, not `000000320193`). See the zero-padding rule in the `sec-tickers` connection's surface doc — count the digits in the raw `cik_str` and prepend only enough zeros to reach 10 total characters. A wrong-length CIK 404s.

- `GET /submissions/CIK{cik10}.json`: company profile plus filing history.
  - `name`, `sicDescription` (industry), `addresses`, `tickers`, `exchanges`, `fiscalYearEnd`, `formerNames`.
  - `filings.recent` is a set of parallel arrays (`form`, `filingDate`, `accessionNumber`, `primaryDocument`, `reportDate`, ...) — the same index across arrays describes one filing, ordered **most recent first**. A company with a long history can have 500+ entries here; take the *first* match for `"10-K"` (annual business + strategy narrative) and the *first* match for `"DEF 14A"` (proxy statement — leadership, director/officer bios, compensation) and stop looking — do not fetch this endpoint again to double-check. Older filings are paginated via `filings.files`; you don't need them for a current profile.
  - `formerNames` lists prior company/ticker names with date ranges. A recent entry here means the entity was reshaped (merger, reverse merger, rebrand) — treat filings from before that change as a different business and don't try to reconcile their financials with the current ones.
  - Use the matching `accessionNumber` and `primaryDocument` with the `sec-tickers` connection's Archives endpoint to fetch the actual document text.

- `GET /api/xbrl/companyfacts/CIK{cik10}.json`: all XBRL-tagged financial facts the company has ever reported, organized by taxonomy (`facts.us-gaap`) and tag (e.g. `Revenues`, `NetIncomeLoss`, `Assets`, `Liabilities`, `StockholdersEquity`, `EarningsPerShareDiluted`, `OperatingIncomeLoss`). Each tag has a `units` object (usually `USD` or `USD-per-shares`) containing an array of reported values with `end` (period end date), `val`, `fy` (fiscal year), `fp` (fiscal period, e.g. `FY`, `Q1`), and `form` (which filing reported it). To report "current" financials, pick the most recent `fy`/`fp` entries with `form` of `10-K` (annual) or `10-Q` (quarterly).

- `GET /api/xbrl/companyconcept/CIK{cik10}/us-gaap/{tag}.json`: same shape as above but scoped to one tag — use this when you only need one metric's history instead of the full companyfacts dump.

Not every company reports every tag under `us-gaap` — some use different tags or the `dei` taxonomy. If a tag is missing, check `facts.us-gaap` for the closest equivalent before concluding the data isn't available.

Read-only. There are no write endpoints on this connection.
