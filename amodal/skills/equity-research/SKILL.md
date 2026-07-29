# Skill: Equity Research

Use this workflow whenever the user asks about a public company: its financials, valuation, business, stock price, strategy, leadership, revenue segments, capital allocation, risk factors, or how it makes money.
Trigger: the user names a ticker, a public company, or asks to "research", "profile", or "look up" a company.

This is a **factual research tool, not an advisory one**. Report what filings and market data say. Do not produce ratings, scores, opinions, predictions, or recommendations of any kind (no "bullish/bearish," no 1–10 scores, no "this is a strong/weak business"). If the user explicitly asks for your opinion, say this tool reports filing data and you're not positioned to give investment advice.

## Behavior

1. Identify the ticker or company name from the user's message.
2. Check the `company-profiles` store first (`store__company_profiles__get`). If a profile already exists and its `last_updated` is recent (within a few months) and the user isn't explicitly asking for the latest/current data, answer from the stored profile and skip straight to composing the answer (step 6) — do not call any tools below.
3. If there's no usable cached profile, call `get_company_snapshot` with the ticker or company name. This one call returns the CIK, company name, industry (`sicDescription`), headquarters, former names, financials (revenue, net income, assets, liabilities, equity, diluted EPS, EBITDA, cash, total debt, fiscal year), capital allocation (capex, R&D, SG&A, buybacks, dividends), 5-year history + CAGR for revenue/net income/EPS, valuation (shares outstanding, market cap, enterprise value, P/E, EV/EBITDA, EV/Sales, P/S, P/B, dividend yield — already computed, don't recalculate), current stock price, 52-week range, ~6 months of daily closes, and the most recent 10-K/DEF 14A (each with `archiveUrl` and `documentUrl`).
   - If it returns `found: false` with `reason: "not_found"`, tell the user the ticker/company couldn't be found and ask them to confirm it.
   - If `reason: "multiple_matches"`, show the `candidates` and ask which one they meant.
   - If `formerNames` is non-empty and the most recent change is relatively recent, note the transition (e.g. "X became Y in <date>") rather than trying to reconcile old and new financials.
   - Some financial/valuation/capital-allocation fields will be `null` when a company doesn't report that XBRL tag (varies by industry and filer) — that's expected; present what's available and don't guess at the rest.
4. Call `fetch_filing_document` once with `latest10K.archiveUrl` and once with `latestDEF14A.archiveUrl` (pass those strings through verbatim — don't edit them). From that text alone — **make no further tool calls to look for any of the following**: don't fetch `FilingSummary.xml`, any `R*.htm` XBRL viewer page, call `yahoo-finance` directly, or re-fetch either filing. Extract, as reported by the filing (no interpretation or judgment):
   - **Business description and strategy** from Item 1 (Business) and Item 7 (MD&A) — what the company itself says it does and where it says it's focused.
   - **Revenue segments**, if there's a segment breakdown in Item 7 or the segment footnote: each segment's name, revenue, percent of total revenue, growth rate vs. prior year, and a one-line description, all as stated. Most single-segment companies won't have one — skip `revenue_segments` entirely rather than searching further.
   - **Risk factors** from Item 1A (Risk Factors): list the major risk categories/headings the filing itself uses (e.g. "Competition," "Regulation," "Cybersecurity," "Supply Chain") with a one-to-two sentence summary of what the filing says under each, in its own words. This is a factual inventory of disclosed risks, not a likelihood/impact assessment — don't rank or score them.
   - **Employee count**, if Item 1 states one (commonly "As of [date], we had approximately N employees").
   - **Senior leadership** from the DEF 14A (and the 10-K's Item 10 if the DEF 14A doesn't cover it): for each named executive officer and key director, name, title, and a short career bio (prior roles/companies, tenure, relevant background) drawn from the filing's own biographical text. Include as many named executives as the filing covers, not just one or two. If a bio is thin (just a title, no background), say so rather than inventing detail. Identify the CEO by title for the header.
   - **Go-to-market / revenue model** — how the filing itself describes the company generating revenue.
5. **STOP. You now have every tool result you need — `get_company_snapshot`'s output plus the two documents from step 4. Call zero more tools from this point on, no matter what.** In particular, do not: query or list `research-notes` or `company-profiles` again, call `yahoo-finance` or `sec-data` directly, retry a lookup under a different key casing, or re-fetch anything. If a number or fact isn't in what you already have, it's simply not available — say so in the answer rather than looking for it elsewhere. Move straight to composing the answer (next step) and saving it to the store.
6. Compose the answer, presenting everything as reported facts with citations, not analysis:
   - Company background (name, industry, headquarters, employees, former-name transition if relevant)
   - Valuation (market cap, enterprise value, P/E, EV/EBITDA, EV/Sales, P/S, P/B, dividend yield) and key financials (with fiscal year noted)
   - 5-year trend / CAGR for revenue, net income, and EPS where available
   - Capital allocation (capex, R&D, SG&A, buybacks, dividends)
   - Current stock price and 52-week range
   - Revenue by segment, if disclosed
   - Business description and strategy (as stated in the filing)
   - Risk factors (as disclosed, not scored)
   - Senior leadership with career bios
   - Go-to-market / revenue model
   - Cite the source filings (form type + filing date) for each section.
7. Write or update the full profile in the `company-profiles` store: all financials (including `ebitda_usd`), `capital_allocation` (`{ capex_usd, research_and_development_usd, selling_general_and_administrative_usd, stock_buybacks_usd, dividends_paid_usd, dividend_per_share_usd }`), `revenue_history`/`net_income_history`/`eps_history` (each an array of `{ fiscal_year, value }`) and `revenue_cagr`/`net_income_cagr`/`eps_cagr`, valuation fields (`shares_outstanding`, `market_cap_usd`, `enterprise_value_usd`, `pe_ratio`, `price_to_sales_ratio`, `price_to_book_ratio`, `ev_to_ebitda`, `ev_to_sales`, `dividend_yield`), `current_price`, `price_currency`, `fifty_two_week_high`, `fifty_two_week_low`, `price_history`, `headquarters`, `employees`, `ceo_name`, `strategy`, `go_to_market`, `revenue_segments` (each `{ segment, revenue_usd, percent_of_total, growth_rate, description }`), `risk_factors` (each `{ category, summary }`), and `leadership` (each `{ name, title, bio }`). Save `sources` as a list of `{ label, url }` objects — `label` like `"10-K (Filing Date: 2026-02-27)"`, `url` copied verbatim from `latest10K.documentUrl` / `latestDEF14A.documentUrl`. Don't construct the URL yourself. Copy every numeric field straight from `get_company_snapshot`'s output — don't recompute ratios or CAGRs yourself. This store write is a single `store__company_profiles__set` call, not a query or list.
8. If the user asks a narrower follow-up about a company already loaded in this session, answer from what's already loaded rather than redoing the workflow.

## Constraints

- Use `get_company_snapshot` for every company lookup — never call `company_tickers.json`, `submissions/CIK{cik}.json`, or `companyfacts` directly. Those have all caused unreliable guessing in the past; the tool returns a small, exact result, including valuation ratios and trend data already computed.
- Stay efficient: one `get_company_snapshot` call, plus one `fetch_filing_document` call each for the 10-K and DEF 14A, is enough for a full profile — that's it, 3 tool calls total for a fresh lookup. Specifically avoid: calling `yahoo-finance` directly, fetching `FilingSummary.xml` or any `R*.htm` page, guessing at `sec-data`/`sec-tickers` paths that aren't `archiveUrl` verbatim, or querying `research-notes`/`company-profiles` beyond the one initial cache check. If you notice you're about to make a 4th or 5th data-gathering call, stop and answer with the best data you have instead.
- Never invent financial figures, prices, ratios, executive names, career history, segment figures, risk factors, or strategy language that isn't backed by data you actually retrieved.
- Never produce a rating, score, or opinion (bullish/bearish, strong/weak, 1–10, likelihood/impact, etc.) — this tool reports facts, not judgments. Risk factors are reported as the filing states them, not ranked or scored.
- Always attribute filing-derived facts to a specific filing (form type + filing date), not to "SEC records" in general.
- This is public, already-disclosed information; do not treat any of it as confidential. Price and valuation data is informational, not investment advice.
