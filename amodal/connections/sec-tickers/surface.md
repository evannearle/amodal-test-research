# SEC EDGAR: Ticker Lookup & Filing Documents

Use this connection to resolve a company to its SEC CIK number, and to fetch the raw text/HTML of a specific filing document once you know its accession number.

- `GET /files/company_tickers.json`: full ticker → CIK directory. Returns an object keyed by row index, each row `{ "cik_str": <number>, "ticker": "<TICKER>", "title": "<Company Name>" }`. Load this once per session and search it locally for the ticker or company name the user asked about. The CIK from this file is **not** zero-padded — you must zero-pad it yourself before using it with the `sec-data` connection or the Archives path below.

  **Zero-padding rule:** the final CIK string must be exactly 10 characters, digits only. Count the digits in `cik_str` and prepend `(10 - digit_count)` zeros — do not just prepend a fixed number of zeros regardless of length.
  - `320193` has 6 digits → prepend 4 zeros → `0000320193`
  - `1045810` has 7 digits → prepend 3 zeros → `0001045810`
  - `1018724` has 7 digits → prepend 3 zeros → `0001018724`
  A wrong-length CIK (e.g. `000000320193`, which is 12 characters) will 404 against `data.sec.gov`. Before calling `sec-data`, count the characters in your zero-padded CIK and confirm it is exactly 10.

- `GET /Archives/edgar/data/{cik_no_leading_zeros}/{accession_no_dashes}/{primary_document}`: fetch the actual filing document (10-K, DEF 14A, 8-K, etc.) as HTML or text. Build this URL from a filing entry you got from the `sec-data` connection's submissions endpoint:
  - `{cik_no_leading_zeros}` is the CIK as a plain number, no leading zeros.
  - `{accession_no_dashes}` is the filing's accession number with the dashes removed (e.g. `0000320193-23-000106` → `000032019323000106` — remove all `-` characters).
  - `{primary_document}` is the `primaryDocument` filename from the submissions filing entry (e.g. `aapl-20230930.htm`).

  These documents can be large (10-Ks especially). When looking for leadership or strategy narrative, prefer the proxy statement (`DEF 14A`) for executive officer/director bios, and the 10-K's Item 1 (Business) and Item 7 (MD&A) sections for strategy and go-to-market description.

Read-only. There are no write endpoints on this connection.
