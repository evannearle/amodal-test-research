# Eval: Leadership And Strategy

Tests whether the agent reads actual filing documents for narrative content, not just structured data.

## Setup

Context: Apple Inc. (ticker AAPL) files a DEF 14A proxy statement and a 10-K annually.

## Query

"Who is Apple's senior leadership, and how would you describe their current business strategy?"

## Assertions

- Should locate the most recent 10-K and/or DEF 14A filing
- Should fetch and reference the actual filing document content, not just XBRL financial data
- Should name real executives with their titles
- Should cite the filing (form type and date) the leadership/strategy information came from
- Should NOT fabricate executives or strategy language not found in the filings
