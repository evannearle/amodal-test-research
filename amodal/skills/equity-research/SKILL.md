# Skill: Equity Research

Use this workflow whenever the user asks about a public company: its financials, business, stock price, strategy, leadership, or how it makes money.
Trigger: the user names a ticker, a public company, or asks to "research", "profile", or "look up" a company.

## Behavior

1. Identify the ticker or company name from the user's message.
2. Check the `company-profiles` store first (`store__company_profiles__get`). If a profile already exists and its `last_updated` is recent (within a few months) and the user isn't explicitly asking for the latest/current data, answer from the stored profile and skip straight to composing the answer (step 6) — do not call any tools below.
3. If there's no usable cached profile, call `get_company_snapshot` with the ticker or company name. This one call returns the CIK, company name, industry (`sicDescription`), former names, parsed financials (revenue, net income, assets, liabilities, equity, diluted EPS, fiscal year), current stock price, 52-week range, ~6 months of daily closes, and the most recent 10-K/DEF 14A (each with `archiveUrl` and `documentUrl`).
   - If it returns `found: false` with `reason: "not_found"`, tell the user the ticker/company couldn't be found and ask them to confirm it.
   - If `reason: "multiple_matches"`, show the `candidates` and ask which one they meant.
   - If `formerNames` is non-empty and the most recent change is relatively recent, note the transition (e.g. "X became Y in <date>") rather than trying to reconcile old and new financials.
4. Every profile includes leadership and strategy, not just financials. Call `fetch_filing_document` once with `latest10K.archiveUrl` and once with `latestDEF14A.archiveUrl` (pass those strings through verbatim — don't edit them):
   - From the 10-K: a concise business description and current strategy from Item 1 (Business) and Item 7 (MD&A).
   - From the DEF 14A (and the 10-K's Item 10 if the DEF 14A doesn't cover it): senior leadership. For each named executive officer and key director, capture name, title, **and a short career bio** — prior roles/companies, tenure at this company, relevant background — from whatever biographical text the filing gives you. Prioritize the CEO, CFO, and any executive the filing itself frames as central to strategy or results (e.g. named in the CEO's letter or MD&A). Include as many named executives as the filing actually covers — don't stop at just one or two if more are listed.
   - Also from the DEF 14A / 10-K: how the company generates revenue / goes to market.
   - If a filing's bio text for someone is thin (just a title, no background), say so for that person rather than padding it with invented detail.
5. Compose the answer:
   - Company background (name, industry, former-name transition if relevant)
   - Key financials (with fiscal year noted)
   - Current stock price and 52-week range
   - Current strategy
   - Senior leadership with career bios
   - Go-to-market / revenue model
   - Cite the source filings (form type + filing date) for each section.
6. After a fresh lookup (steps 3–4 ran), write or update the full profile in the `company-profiles` store: financials, `current_price`, `price_currency`, `fifty_two_week_high`, `fifty_two_week_low`, `price_history`, `strategy`, `go_to_market`, and `leadership` (each entry `{ name, title, bio }`). Save `sources` as a list of `{ label, url }` objects — `label` like `"10-K (Filing Date: 2026-02-27)"`, `url` copied verbatim from `latest10K.documentUrl` / `latestDEF14A.documentUrl`. Don't construct the URL yourself.
7. If the user asks a narrower follow-up about a company already loaded in this session, answer from what's already loaded rather than redoing the workflow.

## Constraints

- Use `get_company_snapshot` for every company lookup — never call `company_tickers.json`, `submissions/CIK{cik}.json`, or `companyfacts` directly. Those have all caused unreliable guessing in the past; the tool returns a small, exact result.
- Stay efficient: one `get_company_snapshot` call, plus one `fetch_filing_document` call each for the 10-K and DEF 14A, is enough for a full profile. If you notice you're about to repeat a call you've already made this pass for the same company, stop and answer with the best data you have instead of re-fetching.
- Never invent financial figures, prices, executive names, career history, or strategy language that isn't backed by data you actually retrieved.
- Always attribute filing-derived facts to a specific filing (form type + filing date), not to "SEC records" in general.
- This is public, already-disclosed information; do not treat any of it as confidential. Price data is informational, not investment advice.
