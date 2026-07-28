# Skill: Equity Research

Use this workflow whenever the user asks about a public company: its financials, business, strategy, leadership, or how it makes money.
Trigger: the user names a ticker, a public company, or asks to "research", "profile", or "look up" a company.

## Behavior

1. Identify the ticker or company name from the user's message.
2. Load `GET /files/company_tickers.json` from `sec-tickers` (or reuse it if already loaded this session) and find the matching row to get the CIK. Zero-pad the CIK so it is exactly 10 characters total (prepend `10 - digit_count` zeros — e.g. a 6-digit `cik_str` gets 4 leading zeros, a 7-digit one gets 3). Double-check the padded string is exactly 10 characters before calling `sec-data`; a wrong length will 404.
3. Load `GET /submissions/CIK{cik10}.json` from `sec-data` to get the company name, industry (`sicDescription`), and filing history.
4. Load `GET /api/xbrl/companyfacts/CIK{cik10}.json` from `sec-data` and pull the most recent annual (`form: "10-K"`, `fp: "FY"`) figures for revenue, net income, total assets, total liabilities, stockholders' equity, and diluted EPS. Note the fiscal year and period end date for each figure.
5. From the submissions filing list, find the most recent `10-K` and the most recent `DEF 14A`. Fetch both documents via the `sec-tickers` Archives endpoint.
   - From the 10-K, extract a concise business description and current strategy from Item 1 (Business) and Item 7 (MD&A).
   - From the DEF 14A, extract senior leadership (names and titles) and, if discussed, how the company generates revenue / goes to market.
6. Compose the answer:
   - Company background/summary
   - Key financials (with fiscal year/period noted)
   - Current strategy
   - Senior leadership
   - Go-to-market / revenue model
   - Cite the source filings (form type + filing date) for each section.
7. If the user is asking about a company you've already profiled this session or in a prior session, check the `company-profiles` store first (`store__company_profiles__get`) before re-fetching everything from SEC. Refresh from SEC if the stored `last_updated` is more than a few months old or the user asks for current data.
8. After compiling a profile, write or update it in the `company-profiles` store so future questions about the same company are faster.
9. If the user asks a narrower follow-up (e.g. just financials, just leadership), answer from what's already loaded in the session or the store rather than redoing the whole workflow.

## Constraints

- Never invent financial figures, executive names, or strategy language that isn't backed by a filing you actually retrieved.
- Always attribute facts to a specific filing (form type + filing date), not to "SEC records" in general.
- If a company can't be found in the ticker directory, say so and ask the user to confirm the ticker or company name — do not guess a CIK.
- If a 10-K or DEF 14A can't be loaded or doesn't contain the requested detail, say what's missing rather than filling the gap from general knowledge.
- This is public, already-disclosed information; do not treat any of it as confidential.
