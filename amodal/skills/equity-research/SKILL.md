# Skill: Equity Research

Use this workflow whenever the user asks about a public company: its financials, business, strategy, leadership, stock price, or how it makes money.
Trigger: the user names a ticker, a public company, or asks to "research", "profile", or "look up" a company.

## Behavior

1. Identify the ticker or company name from the user's message.
2. Check the `company-profiles` store first (`store__company_profiles__get`). If a profile already exists and its `last_updated` is recent (within a few months) and the user isn't explicitly asking for the latest/current data, answer from the stored profile and skip straight to composing the answer (step 5) — do not call any tools below.
3. If there's no usable cached profile, call `get_company_snapshot` with the ticker or company name. This one call returns the CIK, industry, former names, parsed financials (revenue, net income, assets, liabilities, equity, diluted EPS, fiscal year), current stock price, 52-week range, ~6 months of daily closes, and pointers to the latest 10-K and DEF 14A (each with a ready `archiveUrl`).
   - If it returns `found: false` with `reason: "not_found"`, tell the user the ticker/company couldn't be found and ask them to confirm it.
   - If `reason: "multiple_matches"`, show the `candidates` and ask which one they meant.
   - If `formerNames` is non-empty and the most recent change is relatively recent, that's a signal the entity was reshaped (merger, reverse merger, spinoff) — call this out explicitly in your summary rather than trying to reconcile old and new financials.
4. Call `fetch_filing_document` once for `latest10K.archiveUrl` and once for `latestDEF14A.archiveUrl` (pass those strings through verbatim — don't edit them).
   - From the 10-K, extract a concise business description and current strategy from Item 1 (Business) and Item 7 (MD&A).
   - From the DEF 14A, extract senior leadership (names and titles) and, if discussed, how the company generates revenue / goes to market.
5. Compose the answer:
   - Company background/summary
   - Key financials (with fiscal year/period noted)
   - Current stock price and 52-week range
   - Current strategy
   - Senior leadership
   - Go-to-market / revenue model
   - Cite the source filings (form type + filing date) for each section.
6. After a fresh lookup (steps 3–4 ran), write or update the full profile in the `company-profiles` store — including `current_price`, `price_currency`, `fifty_two_week_high`, `fifty_two_week_low`, and `price_history` from `get_company_snapshot`'s `price` field — so future questions about the same company are faster and the dashboard can render it directly.
7. If the user asks a narrower follow-up (e.g. just financials, just leadership) about a company already loaded in this session, answer from what's already loaded rather than redoing the whole workflow.

## Constraints

- Use `get_company_snapshot` and `fetch_filing_document` for every company lookup — never call `company_tickers.json`, `submissions/CIK{cik}.json`, `companyfacts`, or a hand-built `Archives/...` path directly. Those have all caused unreliable guessing in the past; the tools return small, exact results.
- Stay efficient: one `get_company_snapshot` call and one `fetch_filing_document` call each for the 10-K and DEF 14A is enough for a full profile. If you notice you're about to repeat a call you've already made this pass for the same company, stop and answer with the best data you have instead of re-fetching.
- Never invent financial figures, prices, executive names, or strategy language that isn't backed by data you actually retrieved.
- Always attribute filing-derived facts to a specific filing (form type + filing date), not to "SEC records" in general.
- If a 10-K or DEF 14A can't be loaded or doesn't contain the requested detail, say what's missing rather than filling the gap from general knowledge.
- This is public, already-disclosed information; do not treat any of it as confidential. Price data is informational, not investment advice.
