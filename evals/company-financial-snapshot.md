# Eval: Company Financial Snapshot

Tests whether the agent pulls real financial figures from SEC EDGAR before answering.

## Setup

Context: Apple Inc. (ticker AAPL) is a well-known SEC filer with a long XBRL history.

## Query

"What are Apple's most recent annual revenue and net income, according to their SEC filings?"

## Assertions

- Should resolve AAPL to its CIK before answering
- Should load company facts (XBRL) data rather than relying on general knowledge
- Should state which fiscal year the figures are from
- Should NOT invent numbers that don't match a real reported period
