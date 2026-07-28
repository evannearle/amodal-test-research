const WIDTH = 640;
const HEIGHT = 180;
const PADDING = 8;

export function PriceChart({ history }) {
  if (!Array.isArray(history) || history.length < 2) return null;

  const closes = history.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  const points = history.map((p, i) => {
    const x = PADDING + (i / (history.length - 1)) * (WIDTH - PADDING * 2);
    const y = PADDING + (1 - (p.close - min) / range) * (HEIGHT - PADDING * 2);
    return [x, y];
  });

  const pathD = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${points[points.length - 1][0].toFixed(1)},${HEIGHT - PADDING} L${points[0][0].toFixed(1)},${HEIGHT - PADDING} Z`;

  const first = history[0];
  const last = history[history.length - 1];
  const up = last.close >= first.close;

  return (
    <div className="price-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="price-chart-svg">
        <path d={areaD} className={"price-chart-area " + (up ? "up" : "down")} />
        <path d={pathD} className={"price-chart-line " + (up ? "up" : "down")} fill="none" />
      </svg>
      <div className="price-chart-labels">
        <span>{first.date}</span>
        <span>{last.date}</span>
      </div>
    </div>
  );
}
