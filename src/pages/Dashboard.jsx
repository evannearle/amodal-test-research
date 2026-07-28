import { useEffect, useRef, useState } from "react";
import { SearchBar } from "../components/SearchBar";
import { PriceChart } from "../components/PriceChart";
import { runResearchQuery } from "../lib/chat";
import { fetchCompanyProfile } from "../lib/profile";
import { MarkdownLite } from "../lib/markdownLite";
import { formatUsd, formatPrice } from "../lib/format";

const RESEARCH_TIMEOUT_MS = 120_000;

function buildPrompt(ticker) {
  return (
    `Give me a full research profile for ${ticker}. Include: company background ` +
    `(name, industry, any recent name/business change), most recent annual key ` +
    `financials (revenue, net income, total assets, total liabilities, ` +
    `stockholders' equity, diluted EPS, with fiscal year), current stock price ` +
    `with 52-week range, current strategy, senior leadership with a short career ` +
    `bio for each (prior roles, tenure, relevant background), and how they go to ` +
    `market / generate revenue. Cite the source filings.`
  );
}

function StatTile({ label, value }) {
  return (
    <div className="info-card-item">
      <div className="info-card-label">{label}</div>
      <div className="info-card-value">{value}</div>
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

      <h1 className="dashboard-ticker">{ticker}</h1>

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
          <div className="info-card">
            <h3 className="info-card-title">
              {profile.company_name ?? ticker}
              {profile.current_price != null && (
                <span className="price-headline">
                  {" "}
                  {formatPrice(profile.current_price, profile.price_currency)}
                </span>
              )}
            </h3>
            <div className="info-card-grid">
              <StatTile label="Fiscal Year" value={profile.fiscal_year ?? "—"} />
              <StatTile label="Revenue" value={formatUsd(profile.revenue_usd)} />
              <StatTile label="Net Income" value={formatUsd(profile.net_income_usd)} />
              <StatTile label="Total Assets" value={formatUsd(profile.total_assets_usd)} />
              <StatTile label="Total Liabilities" value={formatUsd(profile.total_liabilities_usd)} />
              <StatTile label="Stockholders' Equity" value={formatUsd(profile.stockholders_equity_usd)} />
              <StatTile label="Diluted EPS" value={profile.diluted_eps_usd != null ? `$${profile.diluted_eps_usd}` : "—"} />
              {profile.fifty_two_week_high != null && (
                <StatTile
                  label="52-Week Range"
                  value={`${formatPrice(profile.fifty_two_week_low, profile.price_currency)} – ${formatPrice(profile.fifty_two_week_high, profile.price_currency)}`}
                />
              )}
            </div>
          </div>

          {profile.price_history?.length > 1 && (
            <div className="info-card">
              <h3 className="info-card-title">Price History</h3>
              <PriceChart history={profile.price_history} />
            </div>
          )}

          {profile.summary && (
            <div className="prose">
              <h3>Background</h3>
              <MarkdownLite text={profile.summary} />
            </div>
          )}

          {profile.strategy && (
            <div className="prose">
              <h3>Strategy</h3>
              <MarkdownLite text={profile.strategy} />
            </div>
          )}

          {profile.leadership?.length > 0 && (
            <div className="prose">
              <h3>Senior Leadership</h3>
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
            </div>
          )}

          {profile.go_to_market && (
            <div className="prose">
              <h3>Go-To-Market</h3>
              <MarkdownLite text={profile.go_to_market} />
            </div>
          )}

          {profile.sources?.length > 0 && (
            <div className="prose sources">
              <h3>Sources</h3>
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
            </div>
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
