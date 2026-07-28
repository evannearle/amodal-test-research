# SEC EDGAR: Filing Documents

Don't call this connection's endpoints directly. Two tools cover everything it's used for:

- **`lookup_cik`** resolves a ticker or company name to a CIK. Don't load `GET /files/company_tickers.json` yourself — it has 10,000+ rows and can't be reliably scanned by reading, which has caused wrong-CIK guessing before.
- **`fetch_filing_document`** fetches a filing's text given the `archiveUrl` from `get_filing_summary`. Don't build the `GET /Archives/edgar/data/{cik}/{accession}/{document}` path yourself — it's case-sensitive with a fixed literal segment (`edgar/data`) and a no-leading-zero CIK, and hand-built paths have consistently 404'd.

Read-only. There are no write endpoints on this connection.
