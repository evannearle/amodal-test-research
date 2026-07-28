# Skill: Equity Research

Use this workflow whenever the user asks about a public company: its financials, business, stock price, strategy, leadership, or how it makes money.
Trigger: the user names a ticker, a public company, or asks to "research", "profile", or "look up" a company.

## Behavior

1. Identify the ticker or company name from the user's message.
2. Check the `company-profiles` store first (`store__company_profiles__get`). If a profile already exists and its `last_updated` is recent (within a few months) and the user isn't explicitly asking for the latest/current data, answer from the stored profile and skip straight to composing the answer (step 5) — do not call any tools below.
3. If there's no usable cached profile, call `get_company_snapshot` with the ticker or company name. This one call returns everything needed for the default profile: CIK, company name, industry (`sicDescription`), former names, parsed financials (revenue, net income, assets, liabilities, equity, diluted EPS, fiscal year), current stock price, 52-week range, and ~6 months of daily closes.
   - If it returns `found: false` with `reason: "not_found"`, tell the user the ticker/company couldn't be found and ask them to confirm it.
   - If `reason: "multiple_matches"`, show the `candidates` and ask which one they meant.
   - If `formerNames` is non-empty and the most recent change is relatively recent, note the transition (e.g. "X became Y in <date>") rather than trying to reconcile old and new financials.
4. Compose the default profile from `get_company_snapshot` alone — do not call `fetch_filing_document` yet:
   - Company background: name, industry, and a one-line note on former names/transitions if relevant.
   - Key financials (with fiscal year noted).
   - Current stock price and 52-week range.
   - Cite the source as the company's most recent 10-K (you have its filing date from `get_company_snapshot`'s `latest10K`).
5. Only if the user specifically asks about strategy, leadership, or go-to-market/revenue model (either in the original question or a follow-up), fetch the narrative detail: call `fetch_filing_document` with `latest10K.archiveUrl` for strategy (Item 1 Business, Item 7 MD&A) and `latestDEF14A.archiveUrl` for leadership (names/titles) and go-to-market detail. Pass those `archiveUrl` strings through verbatim — don't edit them. This step is slower (large documents); only do it when actually asked.
6. After a fresh `get_company_snapshot` lookup, write or update the profile in the `company-profiles` store — financials, `current_price`, `price_currency`, `fifty_two_week_high`, `fifty_two_week_low`, and `price_history` at minimum. Add `strategy`, `leadership`, and `go_to_market` to the same record if step 5 ran.
7. If the user asks a narrower follow-up about a company already loaded in this session, answer from what's already loaded rather than redoing the workflow.

## Constraints

- Use `get_company_snapshot` for every company lookup — never call `company_tickers.json`, `submissions/CIK{cik}.json`, or `companyfacts` directly. Those have all caused unreliable guessing in the past; the tool returns a small, exact result.
- Don't call `fetch_filing_document` unless the user asked about strategy, leadership, or go-to-market — it's the slowest step and isn't needed for a basic financials/price profile.
- Stay efficient: one `get_company_snapshot` call is enough for a default profile; at most one `fetch_filing_document` call each for the 10-K and DEF 14A when narrative detail is actually requested. If you notice you're about to repeat a call you've already made this pass for the same company, stop and answer with the best data you have instead of re-fetching.
- Never invent financial figures, prices, executive names, or strategy language that isn't backed by data you actually retrieved.
- Always attribute filing-derived facts to a specific filing (form type + filing date), not to "SEC records" in general.
- This is public, already-disclosed information; do not treat any of it as confidential. Price data is informational, not investment advice.
