# Skill: Equity Research

Use this workflow whenever the user asks about a public company: its financials, business, stock price, strategy, leadership, revenue segments, or how it makes money.
Trigger: the user names a ticker, a public company, or asks to "research", "profile", or "look up" a company.

This is a **factual research tool, not an advisory one**. Report what filings and market data say. Do not produce ratings, scores, opinions, predictions, or recommendations of any kind (no "bullish/bearish," no 1–10 scores, no "this is a strong/weak business"). If the user explicitly asks for your opinion, say this tool reports filing data and you're not positioned to give investment advice.

## Behavior

1. Identify the ticker or company name from the user's message.
2. Check the `company-profiles` store first (`store__company_profiles__get`). If a profile already exists and its `last_updated` is recent (within a few months) and the user isn't explicitly asking for the latest/current data, answer from the stored profile and skip straight to composing the answer (step 6) — do not call any tools below.
3. If there's no usable cached profile, call `get_company_snapshot` with the ticker or company name. This one call returns the CIK, company name, industry (`sicDescription`), headquarters, former names, parsed financials (revenue, net income, assets, liabilities, equity, diluted EPS, cash, total debt, fiscal year), valuation (shares outstanding, market cap, enterprise value), current stock price, 52-week range, ~6 months of daily closes, and the most recent 10-K/DEF 14A (each with `archiveUrl` and `documentUrl`).
   - If it returns `found: false` with `reason: "not_found"`, tell the user the ticker/company couldn't be found and ask them to confirm it.
   - If `reason: "multiple_matches"`, show the `candidates` and ask which one they meant.
   - If `formerNames` is non-empty and the most recent change is relatively recent, note the transition (e.g. "X became Y in <date>") rather than trying to reconcile old and new financials.
4. Call `fetch_filing_document` once with `latest10K.archiveUrl` and once with `latestDEF14A.archiveUrl` (pass those strings through verbatim — don't edit them). Extract, as reported by the filing (no interpretation or judgment):
   - **Business description and strategy** from the 10-K's Item 1 (Business) and Item 7 (MD&A) — what the company itself says it does and where it says it's focused.
   - **Revenue segments**, if the 10-K discloses segment-level or product/service-line revenue (common in Item 7 or the segment footnote): each segment's name, revenue, percent of total revenue, growth rate vs. prior year, and a one-line description — all as stated in the filing. Many single-segment companies won't have this; that's fine, just omit it.
   - **Employee count**, if the 10-K's Item 1 states one (commonly "As of [date], we had approximately N employees").
   - **Senior leadership** from the DEF 14A (and the 10-K's Item 10 if the DEF 14A doesn't cover it): for each named executive officer and key director, name, title, and a short career bio (prior roles/companies, tenure, relevant background) drawn from the filing's own biographical text. Include as many named executives as the filing covers, not just one or two. If a bio is thin (just a title, no background), say so rather than inventing detail. Identify the CEO by title for the header.
   - **Go-to-market / revenue model** — how the filing itself describes the company generating revenue.
5. Compose the answer, presenting everything as reported facts with citations, not analysis:
   - Company background (name, industry, headquarters, employees, former-name transition if relevant)
   - Valuation (market cap, enterprise value) and key financials (with fiscal year noted)
   - Current stock price and 52-week range
   - Revenue by segment, if disclosed
   - Business description and strategy (as stated in the filing)
   - Senior leadership with career bios
   - Go-to-market / revenue model
   - Cite the source filings (form type + filing date) for each section.
6. After a fresh lookup, write or update the full profile in the `company-profiles` store: all financials, `cash_usd`, `total_debt_usd`, `shares_outstanding`, `market_cap_usd`, `enterprise_value_usd`, `current_price`, `price_currency`, `fifty_two_week_high`, `fifty_two_week_low`, `price_history`, `headquarters`, `employees`, `ceo_name`, `strategy`, `go_to_market`, `revenue_segments` (each `{ segment, revenue_usd, percent_of_total, growth_rate, description }`), and `leadership` (each `{ name, title, bio }`). Save `sources` as a list of `{ label, url }` objects — `label` like `"10-K (Filing Date: 2026-02-27)"`, `url` copied verbatim from `latest10K.documentUrl` / `latestDEF14A.documentUrl`. Don't construct the URL yourself.
7. If the user asks a narrower follow-up about a company already loaded in this session, answer from what's already loaded rather than redoing the workflow.

## Constraints

- Use `get_company_snapshot` for every company lookup — never call `company_tickers.json`, `submissions/CIK{cik}.json`, or `companyfacts` directly. Those have all caused unreliable guessing in the past; the tool returns a small, exact result.
- Stay efficient: one `get_company_snapshot` call, plus one `fetch_filing_document` call each for the 10-K and DEF 14A, is enough for a full profile. If you notice you're about to repeat a call you've already made this pass for the same company, stop and answer with the best data you have instead of re-fetching.
- Never invent financial figures, prices, executive names, career history, segment figures, or strategy language that isn't backed by data you actually retrieved.
- Never produce a rating, score, or opinion (bullish/bearish, strong/weak, 1–10, etc.) — this tool reports facts, not judgments.
- Always attribute filing-derived facts to a specific filing (form type + filing date), not to "SEC records" in general.
- This is public, already-disclosed information; do not treat any of it as confidential. Price data is informational, not investment advice.
