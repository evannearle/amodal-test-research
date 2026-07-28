import { useEffect, useRef, useState } from "react";
import { loadTickers, searchTickers } from "../lib/tickers";

export function SearchBar({ autoFocus, onSelect, placeholder }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState(null);
  const [results, setResults] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    loadTickers()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    if (!rows || !query.trim()) {
      setResults([]);
      setActiveIndex(-1);
      return;
    }
    setResults(searchTickers(rows, query));
    setActiveIndex(-1);
  }, [query, rows]);

  useEffect(() => {
    function onClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function pick(row) {
    setQuery("");
    setOpen(false);
    onSelect(row);
  }

  function onKeyDown(e) {
    if (!open || results.length === 0) {
      if (e.key === "Enter" && results.length > 0) {
        pick(results[0]);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(results[activeIndex >= 0 ? activeIndex : 0]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="search-bar" ref={containerRef}>
      <input
        type="text"
        className="search-input"
        placeholder={placeholder ?? "Search by ticker or company name…"}
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label="Search for a public company"
        aria-autocomplete="list"
        aria-expanded={open && results.length > 0}
      />
      {open && results.length > 0 && (
        <ul className="search-suggestions" role="listbox">
          {results.map((row, i) => (
            <li
              key={row.t}
              role="option"
              aria-selected={i === activeIndex}
              className={"search-suggestion" + (i === activeIndex ? " active" : "")}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(row);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="suggestion-ticker">{row.t}</span>
              <span className="suggestion-name">{row.n}</span>
            </li>
          ))}
        </ul>
      )}
      {rows === null && <div className="search-hint">Loading ticker directory…</div>}
    </div>
  );
}
