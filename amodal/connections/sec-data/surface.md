# SEC EDGAR: XBRL Financial Facts

Don't call this connection's endpoints directly — **`get_company_snapshot`** already returns parsed financials (revenue, net income, assets, liabilities, equity, diluted EPS, fiscal year) in one call. Don't load `/submissions/CIK{cik}.json` or `/api/xbrl/companyfacts/CIK{cik}.json` yourself; a long-history company can have 700+ filings, too many to reliably scan by reading.

If `get_company_snapshot`'s `financials` is missing a specific figure, you may fall back to a single `GET /api/xbrl/companyconcept/CIK{cik10}/us-gaap/{tag}.json` call for that one tag — but only as a last resort, once, for a tag you've confirmed is genuinely missing.

Read-only. There are no write endpoints on this connection.
