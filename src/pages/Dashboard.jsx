import { useEffect, useRef, useState } from "react";
import { SearchBar } from "../components/SearchBar";
import { PriceChart } from "../components/PriceChart";
import { ExpandableCard } from "../components/ExpandableCard";
import { RevenueSegmentsTable } from "../components/RevenueSegmentsTable";
import { runResearchQuery } from "../lib/chat";
import { fetchCompanyProfile } from "../lib/profile";
import { MarkdownLite } from "../lib/markdownLite";
import { formatUsd, formatPrice } from "../lib/format";
import { METRIC_INFO } from "../lib/metricInfo";

const RESEARCH_TIMEOUT_MS = 120_000;

function buildPrompt(ticker) {
  return (
    `Give me a full factual research profile for ${ticker} — report what the ` +
    `filings and market data say, no ratings, scores, or opinions. Include: ` +
    `company background (name, industry, headquarters, employee count, any ` +
    `recent name/business change), market cap and enterprise value, most ` +
    `recent annual key financials (revenue, net income, total assets, total ` +
    `liabilities, stockholders' equity, diluted EPS, cash, total debt, with ` +
    `fiscal year), current stock price with 52-week range, revenue by segment ` +
    `if disclosed, business description and strategy as stated in the filing, ` +
    `senior leadership with a short career bio for each (prior roles, tenure, ` +
    `relevant background), and how they go to market / generate revenue. Cite ` +
    `the source filings.`
  );
}

function StatTile({ label, value }) {
  const info = METRIC_INFO[label];
  return (
    <div className="info-card-item" title={info}>
      <div className="info-card-label">{label}</div>
      <div className="info-card-value">{value}</div>
    </div>
  );
}

function HeaderStat({ label, value }) {
  if (value == null) return null;
  const info = METRIC_INFO[label];
  return (
    <div className="header-stat" title={info}>
      <span className="header-stat-label">{label}</span>
      <span className="header-stat-value">{value}</span>
    </div>
  );
}

export function Dashboard({ ticker, navigate }) {
  const [status, setStatus] = useState("loading"); // loading | done | error | timeout | unauthenticated
  const [toolGroups, setToolGroups] = useState([]);
  const [profile, setProfile] = useState(null);
  const [fallbackText, setFallbackText] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const runIdRef = useRef(0);

  useEffect(() => {
    const runId = ++runIdRef.current;
    const controller = new AbortController();
    let tick = null;
    let timeout = null;

    setStatus("loading");
    setToolGroups([]);
    setProfile(null);
    setFallbackText(null);
    setErrorMessage(null);
    setElapsedSeconds(0);

    async function run() {
      // Fast path: already-researched companies are served straight from the
      // store, no chat round-trip needed.
      try {
        const cached = await fetchCompanyProfile(ticker);
        if (runId !== runIdRef.current) return;
        if (cached) {
          setProfile(cached);
          setStatus("done");
          return;
        }
      } catch (err) {
        if (runId !== runIdRef.current) return;
        if (err.code === "UNAUTHENTICATED") {
          setStatus("unauthenticated");
          return;
        }
        // otherwise fall through and try research anyway
      }

      const startedAt = Date.now();
      tick = setInterval(() => {
        setElapsedSeconds(Math.round((Date.now() - startedAt) / 1000));
      }, 1000);
      timeout = setTimeout(() => controller.abort("timeout"), RESEARCH_TIMEOUT_MS);

      const idToKey = new Map();

      try {
        const res = await runResearchQuery(buildPrompt(ticker), {
          signal: controller.signal,
          onEvent: (evt) => {
            if (runId !== runIdRef.current) return;
            if (evt.type !== "tool_call_start" && evt.type !== "tool_call_result") return;
            setToolGroups((prev) => {
              if (evt.type === "tool_call_start") {
                const label = evt.running_label ?? evt.tool_name;
                const doneLabel = evt.completed_label ?? label;
                idToKey.set(evt.tool_id, doneLabel);
                const idx = prev.findIndex((g) => g.key === doneLabel);
                if (idx === -1) {
                  return [...prev, { key: doneLabel, label, doneLabel, count: 1, active: 1 }];
                }
                const next = [...prev];
                next[idx] = { ...next[idx], count: next[idx].count + 1, active: next[idx].active + 1 };
                return next;
              }
              const key = idToKey.get(evt.tool_id);
              const idx = prev.findIndex((g) => g.key === key);
              if (idx === -1) return prev;
              const next = [...prev];
              next[idx] = { ...next[idx], active: Math.max(0, next[idx].active - 1) };
              return next;
            });
          },
        });

        if (runId !== runIdRef.current) return;

        const fresh = await fetchCompanyProfile(ticker);
        if (runId !== runIdRef.current) return;

        if (fresh) {
          setProfile(fresh);
        } else {
          // Model finished but didn't save a structured profile — fall back
          // to whatever prose it produced rather than showing nothing.
          setFallbackText(res.text || "No profile data was returned.");
        }
        setStatus("done");
      } catch (err) {
        if (runId !== runIdRef.current) return;
        if (err.code === "UNAUTHENTICATED") {
          setStatus("unauthenticated");
        } else if (err.name === "AbortError") {
          if (controller.signal.reason === "timeout") setStatus("timeout");
        } else {
          setErrorMessage(err.message ?? "Something went wrong.");
          setStatus("error");
        }
      }
    }

    run().finally(() => {
      clearInterval(tick);
      clearTimeout(timeout);
    });

    return () => {
      clearInterval(tick);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [ticker]);

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <button className="back-link" onClick={() => navigate("/")}>
          ← New search
        </button>
        <div className="dashboard-search">
          <SearchBar
            placeholder="Search another company…"
            onSelect={(row) => navigate(`/company/${encodeURIComponent(row.t)}`)}
          />
        </div>
      </div>

      <h1 className="dashboard-ticker">
        {profile?.company_name ? `${profile.company_name} (${ticker})` : ticker}
        {profile?.current_price != null && (
          <span className="price-headline">
            {" "}
            {formatPrice(profile.current_price, profile.price_currency)}
          </span>
        )}
      </h1>

      {status === "unauthenticated" && (
        <div className="panel panel-warning">
          <p>You need to sign in to run research queries.</p>
          <a className="button" href="/auth/login">
            Sign in
          </a>
        </div>
      )}

      {status === "error" && (
        <div className="panel panel-error">
          <p>Couldn't complete this research request: {errorMessage}</p>
          <button className="button" onClick={() => navigate(`/company/${ticker}`)}>
            Try again
          </button>
        </div>
      )}

      {status === "timeout" && (
        <div className="panel panel-error">
          <p>
            This is taking longer than {RESEARCH_TIMEOUT_MS / 1000}s and was stopped. Try again, or
            ask a narrower question.
          </p>
          <button className="button" onClick={() => navigate(`/company/${ticker}`)}>
            Try again
          </button>
        </div>
      )}

      {(status === "loading" || toolGroups.length > 0) && status !== "unauthenticated" && (
        <div className="progress-list">
          {status === "loading" && toolGroups.length === 0 && (
            <div className="progress-item running">Checking for a cached profile…</div>
          )}
          {toolGroups.map((g) => (
            <div className={"progress-item " + (g.active > 0 ? "running" : "done")} key={g.key}>
              {g.active > 0 ? g.label : g.doneLabel}
              {g.count > 1 ? ` ×${g.count}` : ""}
            </div>
          ))}
          {status === "loading" && toolGroups.length > 0 && (
            <div className="progress-item running progress-elapsed">
              Still working… {elapsedSeconds}s
            </div>
          )}
        </div>
      )}

      {status === "done" && profile && (
        <div className="results">
          <div className="header-stats">
            <HeaderStat label="Industry" value={profile.industry} />
            <HeaderStat label="Headquarters" value={profile.headquarters} />
            <HeaderStat label="CEO" value={profile.ceo_name} />
            <HeaderStat label="Employees" value={profile.employees} />
            <HeaderStat label="Market Cap" value={formatUsd(profile.market_cap_usd)} />
            <HeaderStat label="Enterprise Value" value={formatUsd(profile.enterprise_value_usd)} />
          </div>

          <ExpandableCard title="Financials">
            <div className="info-card-grid">
              <StatTile label="Fiscal Year" value={profile.fiscal_year ?? "—"} />
              <StatTile label="Revenue" value={formatUsd(profile.revenue_usd)} />
              <StatTile label="Net Income" value={formatUsd(profile.net_income_usd)} />
              <StatTile label="Total Assets" value={formatUsd(profile.total_assets_usd)} />
              <StatTile label="Total Liabilities" value={formatUsd(profile.total_liabilities_usd)} />
              <StatTile label="Stockholders' Equity" value={formatUsd(profile.stockholders_equity_usd)} />
              <StatTile label="Diluted EPS" value={profile.diluted_eps_usd != null ? `$${profile.diluted_eps_usd}` : "—"} />
              <StatTile label="Cash" value={formatUsd(profile.cash_usd)} />
              <StatTile label="Total Debt" value={formatUsd(profile.total_debt_usd)} />
              {profile.fifty_two_week_high != null && (
                <StatTile
                  label="52-Week Range"
                  value={`${formatPrice(profile.fifty_two_week_low, profile.price_currency)} – ${formatPrice(profile.fifty_two_week_high, profile.price_currency)}`}
                />
              )}
            </div>
          </ExpandableCard>

          {profile.price_history?.length > 1 && (
            <ExpandableCard title="Price History">
              <PriceChart history={profile.price_history} />
            </ExpandableCard>
          )}

          {profile.revenue_segments?.length > 0 && (
            <ExpandableCard title="Revenue by Segment">
              <RevenueSegmentsTable segments={profile.revenue_segments} />
              <p className="segments-note">As disclosed in the company's most recent 10-K.</p>
            </ExpandableCard>
          )}

          {profile.summary && (
            <ExpandableCard title="Background">
              <MarkdownLite text={profile.summary} />
            </ExpandableCard>
          )}

          {profile.strategy && (
            <ExpandableCard title="Strategy">
              <MarkdownLite text={profile.strategy} />
            </ExpandableCard>
          )}

          {profile.leadership?.length > 0 && (
            <ExpandableCard title="Senior Leadership">
              <ul className="leadership-list">
                {profile.leadership.map((p, i) => (
                  <li key={i}>
                    <div className="leadership-name">
                      <strong>{p.name}</strong> — {p.title}
                    </div>
                    {p.bio && <div className="leadership-bio">{p.bio}</div>}
                  </li>
                ))}
              </ul>
            </ExpandableCard>
          )}

          {profile.go_to_market && (
            <ExpandableCard title="Go-To-Market">
              <MarkdownLite text={profile.go_to_market} />
            </ExpandableCard>
          )}

          {profile.sources?.length > 0 && (
            <ExpandableCard title="Sources" defaultOpen={false}>
              <ul className="prose-list">
                {profile.sources.map((s, i) => {
                  // Older cached profiles saved sources as plain strings;
                  // newer ones save { label, url }. Handle both.
                  const label = typeof s === "string" ? s : s.label;
                  const url = typeof s === "string" ? null : s.url;
                  return (
                    <li key={i}>
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          {label}
                        </a>
                      ) : (
                        label
                      )}
                    </li>
                  );
                })}
              </ul>
            </ExpandableCard>
          )}
        </div>
      )}

      {status === "done" && !profile && fallbackText && (
        <div className="results">
          <div className="prose">
            <MarkdownLite text={fallbackText} />
          </div>
        </div>
      )}
    </div>
  );
}
