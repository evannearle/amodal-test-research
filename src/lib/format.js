export function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toLocaleString()}`;
}

export function formatPrice(value, currency) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const symbol = currency === "USD" || !currency ? "$" : `${currency} `;
  return `${symbol}${value.toFixed(2)}`;
}

export function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatRatio(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}×`;
}
