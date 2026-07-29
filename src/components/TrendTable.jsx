import { formatPercent } from "../lib/format";

export function TrendTable({ label, history: rawHistory, cagr, formatValue }) {
  // Defensive: only render entries that actually look like a fiscal year and
  // a number — never trust a store record blindly (see PriceChart for why).
  const history = Array.isArray(rawHistory)
    ? rawHistory.filter((h) => Number.isFinite(h?.fiscal_year) && Number.isFinite(h?.value))
    : [];

  if (history.length === 0) return null;

  return (
    <div className="trend-block">
      <div className="trend-header">
        <span className="trend-label">{label}</span>
        {cagr != null && (
          <span className={"trend-cagr " + (cagr >= 0 ? "up" : "down")}>
            {formatPercent(cagr)} CAGR
          </span>
        )}
      </div>
      <div className="trend-row">
        {history.map((h) => (
          <div className="trend-year" key={h.fiscal_year}>
            <div className="trend-year-value">{formatValue(h.value)}</div>
            <div className="trend-year-label">FY{h.fiscal_year}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
