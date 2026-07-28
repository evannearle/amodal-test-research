import { useState } from "react";
import { formatUsd } from "../lib/format";

const COLUMNS = [
  { key: "segment", label: "Segment" },
  { key: "revenue_usd", label: "Revenue", numeric: true },
  { key: "percent_of_total", label: "% of Total", numeric: true },
  { key: "growth_rate", label: "Growth" },
  { key: "description", label: "Description" },
];

export function RevenueSegmentsTable({ segments }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("desc");

  if (!Array.isArray(segments) || segments.length === 0) return null;

  const sorted = [...segments].sort((a, b) => {
    if (!sortKey) return 0;
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });

  function onSort(col) {
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir(col.numeric ? "desc" : "asc");
    }
  }

  return (
    <div className="segments-table-wrap">
      <table className="segments-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key} onClick={() => onSort(col)} className="sortable">
                {col.label}
                {sortKey === col.key && <span className="sort-arrow">{sortDir === "asc" ? " ▲" : " ▼"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((s, i) => (
            <tr key={i}>
              <td>{s.segment}</td>
              <td>{formatUsd(s.revenue_usd)}</td>
              <td>{s.percent_of_total != null ? `${s.percent_of_total}%` : "—"}</td>
              <td>{s.growth_rate ?? "—"}</td>
              <td className="segments-description">{s.description ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
