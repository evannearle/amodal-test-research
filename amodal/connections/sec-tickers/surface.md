# SEC EDGAR: Filing Documents

**To resolve a ticker or company name to a CIK, call the `lookup_cik` tool — do not call `GET /files/company_tickers.json` yourself.** That directory has 10,000+ rows; it isn't something a model can reliably scan by reading, and trying to do so has caused agents to guess wrong CIKs repeatedly. `lookup_cik` does the exact match in code and returns a single small result.

This connection is for fetching the actual filing document once you have an accession number and primary document filename (from the `get_filing_summary` tool):

- `GET /Archives/edgar/data/{cik_no_leading_zeros}/{accession_no_dashes}/{primary_document}`: fetch the filing document (10-K, DEF 14A, 8-K, etc.) as HTML or text.
  - `{cik_no_leading_zeros}` is the CIK as a plain number, no leading zeros.
  - `{accession_no_dashes}` and `{primary_document}` come directly from `get_filing_summary`'s `latest10K` / `latestDEF14A` result — use its `accessionNoDashes` and `primaryDocument` fields as-is.

  These documents can be large (10-Ks especially). When looking for leadership or strategy narrative, prefer the proxy statement (`DEF 14A`) for executive officer/director bios, and the 10-K's Item 1 (Business) and Item 7 (MD&A) sections for strategy and go-to-market description.

Read-only. There are no write endpoints on this connection.
