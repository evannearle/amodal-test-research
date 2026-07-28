# Skill: Equity Research

Use this workflow whenever the user asks about a public company: its financials, business, strategy, leadership, or how it makes money.
Trigger: the user names a ticker, a public company, or asks to "research", "profile", or "look up" a company.

## Behavior

1. Identify the ticker or company name from the user's message.
2. Check the `company-profiles` store first (`store__company_profiles__get`). If a profile already exists and its `last_updated` is recent (within a few months) and the user isn't explicitly asking for the latest/current data, answer from the stored profile and skip straight to composing the answer (step 6) — do not call any tools below.
3. If there's no usable cached profile, call the `lookup_cik` tool with the ticker or company name to get its `cik10`. This is the *only* way to resolve a ticker — never load `company_tickers.json` yourself and scan it; that file has 10,000+ rows and cannot be reliably searched by reading. If `lookup_cik` returns `found: false`, follow its `reason`: for `not_found`, tell the user the ticker/company couldn't be found and ask them to confirm it; for `multiple_matches`, show the `candidates` and ask which one they meant. Do not guess a CIK.
4. Call the `get_filing_summary` tool with that `cik10` to get the company name, industry, former names, and the most recent 10-K and DEF 14A (accession number + primary document already resolved). This is the *only* way to get the filing list — never load `/submissions/CIK{cik}.json` yourself; a long-history company can have 700+ filings, too many to scan by reading.
   - If `formerNames` is non-empty and the most recent change is relatively recent, that's a signal the entity was reshaped (merger, reverse merger, spinoff) — call this out explicitly in your summary (e.g. "X became Y in <date>; financials below are from filings under the current business") rather than trying to reconcile old and new financials.
5. Call `GET /api/xbrl/companyfacts/CIK{cik10}.json` from `sec-data` **once** and pull the most recent annual (`form: "10-K"`, `fp: "FY"`) figures for revenue, net income, total assets, total liabilities, stockholders' equity, and diluted EPS from that single response. Note the fiscal year and period end date for each figure. Do not call `companyconcept` per tag afterward — only fall back to a single `companyconcept` call for a specific tag if that tag is genuinely absent from `companyfacts`, and only once per missing tag.
   - Fetch the `latest10K` and `latestDEF14A` documents by calling `fetch_filing_document` with the exact `archiveUrl` string from `get_filing_summary`'s result — don't construct the Archives path yourself.
   - From the 10-K, extract a concise business description and current strategy from Item 1 (Business) and Item 7 (MD&A).
   - From the DEF 14A, extract senior leadership (names and titles) and, if discussed, how the company generates revenue / goes to market.
6. Compose the answer:
   - Company background/summary
   - Key financials (with fiscal year/period noted)
   - Current strategy
   - Senior leadership
   - Go-to-market / revenue model
   - Cite the source filings (form type + filing date) for each section.
7. After compiling a fresh profile from SEC (steps 3–5 ran), write or update it in the `company-profiles` store so future questions about the same company are faster.
8. If the user asks a narrower follow-up (e.g. just financials, just leadership) about a company already loaded in this session, answer from what's already loaded rather than redoing the whole workflow.

## Constraints

- Use `lookup_cik`, `get_filing_summary`, and `fetch_filing_document` for every company lookup — never call `company_tickers.json`, `submissions/CIK{cik}.json`, or a hand-built `Archives/...` path directly. Those have all caused unreliable guessing in the past; the tools return small, exact results.
- Stay efficient: `lookup_cik` once, `get_filing_summary` once, one `companyfacts` call, and one `fetch_filing_document` call each for the 10-K and DEF 14A is enough for a full profile. If you notice you're about to repeat a call you've already made this pass for the same company, stop and answer with the best data you have instead of re-fetching.
- Never invent financial figures, executive names, or strategy language that isn't backed by a filing you actually retrieved.
- Always attribute facts to a specific filing (form type + filing date), not to "SEC records" in general.
- If a 10-K or DEF 14A can't be loaded or doesn't contain the requested detail, say what's missing rather than filling the gap from general knowledge.
- This is public, already-disclosed information; do not treat any of it as confidential.
