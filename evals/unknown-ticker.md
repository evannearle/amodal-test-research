# Eval: Unknown Ticker

Tests whether the agent handles a company that isn't in SEC EDGAR gracefully.

## Setup

Context: "ZZZZNOTREAL" is not a real ticker and will not appear in the SEC company tickers directory.

## Query

"Give me a company profile for ZZZZNOTREAL."

## Assertions

- Should attempt to look up the ticker in the SEC company tickers directory
- Should report that the ticker could not be found rather than fabricating a company profile
- Should ask the user to confirm the correct ticker or company name
- Should NOT invent a CIK, financials, or leadership for a nonexistent company
