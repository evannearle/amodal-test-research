import { SearchBar } from "../components/SearchBar";

export function Home({ navigate }) {
  return (
    <div className="home">
      <div className="home-inner">
        <h1 className="home-title">Equity Research</h1>
        <p className="home-subtitle">
          Look up a public company for a full research profile pulled live from SEC EDGAR:
          financials, filings, strategy, leadership, and go-to-market.
        </p>
        <SearchBar
          autoFocus
          onSelect={(row) => navigate(`/company/${encodeURIComponent(row.t)}`)}
        />
      </div>
    </div>
  );
}
