# SEC EDGAR: Filing Documents

Don't call this connection's endpoints directly.

- **`get_company_snapshot`** resolves a ticker/company name and returns everything structured (CIK, financials, filing pointers, price) in one call. Don't load `GET /files/company_tickers.json` yourself — it has 10,000+ rows and can't be reliably scanned by reading.
- **`fetch_filing_document`** fetches a filing's text given the `archiveUrl` from `get_company_snapshot`'s `latest10K`/`latestDEF14A`. Don't build the `GET /Archives/edgar/data/{cik}/{accession}/{document}` path yourself — it's case-sensitive with a fixed literal segment (`edgar/data`) and a no-leading-zero CIK, and hand-built paths have consistently 404'd.

Read-only. There are no write endpoints on this connection.
