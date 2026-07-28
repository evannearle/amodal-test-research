# SEC EDGAR: Ticker Lookup & Filing Documents

Use this connection to resolve a company to its SEC CIK number, and to fetch the raw text/HTML of a specific filing document once you know its accession number.

- `GET /files/company_tickers.json`: full ticker → CIK directory. Returns an object keyed by row index, each row `{ "cik_str": <number>, "ticker": "<TICKER>", "title": "<Company Name>" }`. Load this once per session and search it locally for the ticker or company name the user asked about. The CIK from this file is **not** zero-padded — zero-pad it to 10 digits (e.g. `320193` → `0000320193`) before using it with the `sec-data` connection.

- `GET /Archives/edgar/data/{cik_no_leading_zeros}/{accession_no_dashes}/{primary_document}`: fetch the actual filing document (10-K, DEF 14A, 8-K, etc.) as HTML or text. Build this URL from a filing entry you got from the `sec-data` connection's submissions endpoint:
  - `{cik_no_leading_zeros}` is the CIK as a plain number, no leading zeros.
  - `{accession_no_dashes}` is the filing's accession number with the dashes removed (e.g. `0000320193-23-000106` → `000032019323000106` — remove all `-` characters).
  - `{primary_document}` is the `primaryDocument` filename from the submissions filing entry (e.g. `aapl-20230930.htm`).

  These documents can be large (10-Ks especially). When looking for leadership or strategy narrative, prefer the proxy statement (`DEF 14A`) for executive officer/director bios, and the 10-K's Item 1 (Business) and Item 7 (MD&A) sections for strategy and go-to-market description.

Read-only. There are no write endpoints on this connection.
