let cache = null;
let inflight = null;

export function loadTickers() {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch("/tickers.json")
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load ticker list (${res.status})`);
      return res.json();
    })
    .then((rows) => {
      cache = rows;
      return rows;
    });
  return inflight;
}

export function searchTickers(rows, query, limit = 8) {
  const q = query.trim().toUpperCase();
  if (!q) return [];

  const tickerStarts = [];
  const tickerContains = [];
  const nameContains = [];

  for (const row of rows) {
    const ticker = row.t;
    const name = row.n.toUpperCase();
    if (ticker === q) {
      tickerStarts.unshift(row);
    } else if (ticker.startsWith(q)) {
      tickerStarts.push(row);
    } else if (ticker.includes(q)) {
      tickerContains.push(row);
    } else if (name.includes(q)) {
      nameContains.push(row);
    }
    if (tickerStarts.length >= limit) break;
  }

  return [...tickerStarts, ...tickerContains, ...nameContains].slice(0, limit);
}
