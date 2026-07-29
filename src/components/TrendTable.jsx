import { formatPercent } from "../lib/format";

export function TrendTable({ label, history, cagr, formatValue }) {
  if (!Array.isArray(history) || history.length === 0) return null;

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
