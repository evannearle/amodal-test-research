# SEC EDGAR: XBRL Financial Facts

Structured financial data. All CIKs here must be zero-padded to **exactly 10 characters** (e.g. `0000320193`, not `000000320193`) — `lookup_cik` already returns the CIK pre-padded, so just use its `cik10` field as-is.

**For a company's filing history (name, industry, former names, most recent 10-K/DEF 14A), call the `get_filing_summary` tool — do not call `GET /submissions/CIK{cik}.json` yourself.** A company with a long history can have 700+ filings in that response; `get_filing_summary` finds the right ones in code instead of asking a model to scan a huge array.

- `GET /api/xbrl/companyfacts/CIK{cik10}.json`: all XBRL-tagged financial facts the company has ever reported, organized by taxonomy (`facts.us-gaap`) and tag (e.g. `Revenues`, `NetIncomeLoss`, `Assets`, `Liabilities`, `StockholdersEquity`, `EarningsPerShareDiluted`, `OperatingIncomeLoss`). Each tag has a `units` object (usually `USD` or `USD-per-shares`) containing an array of reported values with `end` (period end date), `val`, `fy` (fiscal year), `fp` (fiscal period, e.g. `FY`, `Q1`), and `form` (which filing reported it). To report "current" financials, pick the most recent `fy`/`fp` entries with `form` of `10-K` (annual) or `10-Q` (quarterly). Call this **once** per company — read all the tags you need from that single response.

- `GET /api/xbrl/companyconcept/CIK{cik10}/us-gaap/{tag}.json`: same shape as above but scoped to one tag. Only use this as a fallback, and only for a specific tag you confirmed is genuinely absent from `companyfacts` — not as a way to probe multiple tags one at a time.

Not every company reports every tag under `us-gaap` — some use different tags or the `dei` taxonomy. If a tag is missing, check `facts.us-gaap` for the closest equivalent before concluding the data isn't available.

Read-only. There are no write endpoints on this connection.
