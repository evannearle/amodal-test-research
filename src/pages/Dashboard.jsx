import { useEffect, useRef, useState } from "react";
import { SearchBar } from "../components/SearchBar";
import { PriceChart } from "../components/PriceChart";
import { ExpandableCard } from "../components/ExpandableCard";
import { RevenueSegmentsTable } from "../components/RevenueSegmentsTable";
import { TrendTable } from "../components/TrendTable";
import { runResearchQuery } from "../lib/chat";
import { fetchCompanyProfile } from "../lib/profile";
import { MarkdownLite } from "../lib/markdownLite";
import { formatUsd, formatPrice, formatPercent, formatRatio } from "../lib/format";
import { METRIC_INFO } from "../lib/metricInfo";

// No fixed time budget for a normal research pass — reading two full filings
// and writing a detailed profile can legitimately take a couple of minutes,
// and cutting it off at an arbitrary wall-clock limit was discarding
// completed work (MSFT/WM both finished just past a 120s cutoff). The real
// abuse guard is MAX_SESSION_TOKENS below, a hard server-enforced cost cap
// that doesn't care how long a request takes. HANG_SAFETY_MS is only a
// last-resort net for a genuinely stuck connection, not a normal boundary.
const MAX_SESSION_TOKENS = 400_000;
const HANG_SAFETY_MS = 10 * 60_000;
const POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 5000;
// A dropped connection ("Failed to fetch" — a raw network error, not an HTTP
// status) is often transient (a proxy hiccup, momentary contention on the
// backend). Retry automatically before asking the user to do it by hand.
const MAX_NETWORK_RETRIES = 2;
const RETRY_DELAY_MS = 4000;

// The client giving up (timeout, dropped connection) doesn't stop the
// server-side research turn — it keeps running and often finishes and saves
// to the store a little later. Poll briefly for that before giving up.
async function pollForProfile(ticker, runId, runIdRef) {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (runId !== runIdRef.current) return null;
    try {
      const profile = await fetchCompanyProfile(ticker);
      if (profile) return profile;
    } catch {
      // ignore transient errors while polling, keep trying
    }
  }
  return null;
}

function buildPrompt(ticker) {
  return (
    `Give me a full factual research profile for ${ticker} — report what the ` +
    `filings and market data say, no ratings, scores, or opinions. Include: ` +
    `company background (name, industry, headquarters, employee count, any ` +
    `recent name/business change), valuation (market cap, enterprise value, ` +
    `P/E, EV/EBITDA, EV/Sales, price/sales, price/book, dividend yield), most ` +
    `recent annual key financials (revenue, net income, total assets, total ` +
    `liabilities, stockholders' equity, diluted EPS, EBITDA, cash, total debt, ` +
    `with fiscal year), 5-year trend and CAGR for revenue, net income, and ` +
    `EPS where available, capital allocation (capex, R&D, SG&A, stock ` +
    `buybacks, dividends paid), current stock price with 52-week range, ` +
    `revenue by segment if disclosed, business description and strategy as ` +
    `stated in the filing, risk factors as disclosed (not scored), senior ` +
    `leadership with a short career bio for each (prior roles, tenure, ` +
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
    // Reassigned each retry attempt; the unmount/ticker-change cleanup below
    // always needs to reach the *current* attempt's controller and timers.
    let controller = null;
    let tick = null;
    let timeout = null;
    // Set by attemptResearch on a retryable outcome; read by run() once
    // retries are exhausted to decide what to show.
    let lastAttemptInfo = {};

    setStatus("loading");
    setToolGroups([]);
    setProfile(null);
    setFallbackText(null);
    setErrorMessage(null);
    setElapsedSeconds(0);

    // Runs one research attempt. Returns "done" (terminal, caller should
    // stop), "retry" (a transient network drop — caller may try again), or
    // undefined if this run was superseded (ticker changed / unmounted).
    async function attemptResearch() {
      // Clear the previous attempt's timers before starting a new one — each
      // retry otherwise leaks an interval/timeout from the attempt before it.
      clearInterval(tick);
      clearTimeout(timeout);

      controller = new AbortController();
      setStatus("loading");
      setToolGroups([]);
      setErrorMessage(null);
      const startedAt = Date.now();
      tick = setInterval(() => {
        setElapsedSeconds(Math.round((Date.now() - startedAt) / 1000));
      }, 1000);
      timeout = setTimeout(() => controller.abort("timeout"), HANG_SAFETY_MS);

      const idToKey = new Map();

      try {
        const res = await runResearchQuery(buildPrompt(ticker), {
          signal: controller.signal,
          maxSessionTokens: MAX_SESSION_TOKENS,
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

        if (runId !== runIdRef.current) return undefined;

        const fresh = await fetchCompanyProfile(ticker);
        if (runId !== runIdRef.current) return undefined;

        if (fresh) {
          setProfile(fresh);
          setStatus("done");
          return "done";
        }

        // The model completed without saving a structured profile. This is
        // non-deterministic — retrying the same company sometimes succeeds
        // cleanly where the previous attempt didn't (observed directly: a
        // failed META run followed immediately by a clean one). Worth an
        // automatic retry via the same mechanism as a dropped connection,
        // rather than making the user manually click "Try again."
        lastAttemptInfo = { text: res.text, endReason: res.endReason };
        return "retry";
      } catch (err) {
        if (runId !== runIdRef.current) return undefined;
        if (err.code === "UNAUTHENTICATED") {
          setStatus("unauthenticated");
          return "done";
        }

        // The client giving up (timeout or a dropped connection) doesn't mean
        // the server-side research turn stopped — it keeps running
        // independently and often finishes and saves to the store a bit
        // later. Poll briefly before declaring failure instead of discarding
        // work that's about to land.
        const isTimeout = err.name === "AbortError" && controller.signal.reason === "timeout";
        const isNetworkDrop = err.name !== "AbortError";
        if (isTimeout || isNetworkDrop) {
          setStatus("finishing");
          const found = await pollForProfile(ticker, runId, runIdRef);
          if (runId !== runIdRef.current) return undefined;
          if (found) {
            setProfile(found);
            setStatus("done");
            return "done";
          }
          if (isNetworkDrop) {
            lastAttemptInfo = { networkError: err.message ?? "Connection lost." };
            return "retry";
          }
          setStatus("timeout");
          return "done";
        }

        // Anything else here is an AbortError from navigating away — ignore.
        return "done";
      }
    }

    async function run() {
      // Fast path: already-researched companies are served straight from the
      // store, no chat round-trip needed.
      try {
        const cached = await fetchCompanyProfile(ticker);
        if (runId !== runIdRef.current) return;
        // profile_complete === false means only the core (financials/
        // valuation/price) was saved before enrichment ran or was
        // interrupted — treat it like a cache miss so the skill finishes
        // the job, rather than showing a permanently-partial profile.
        if (cached && cached.profile_complete !== false) {
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

      for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt++) {
        const outcome = await attemptResearch();
        if (outcome !== "retry") return; // done, or superseded
        if (runId !== runIdRef.current) return;

        if (attempt < MAX_NETWORK_RETRIES) {
          setStatus("retrying");
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          if (runId !== runIdRef.current) return;
        } else if (lastAttemptInfo.endReason === "budget_exceeded") {
          setFallbackText(
            "This company's filings needed more processing than the request budget allows, " +
              "across multiple attempts. Try asking a narrower question (e.g. just financials)."
          );
          setStatus("done");
        } else if (lastAttemptInfo.text) {
          // Never fully structured, but real content was produced at least
          // once — show it rather than a bare error.
          setFallbackText(lastAttemptInfo.text);
          setStatus("done");
        } else if (lastAttemptInfo.networkError) {
          setErrorMessage(lastAttemptInfo.networkError);
          setStatus("error");
        } else {
          setFallbackText("No profile data was returned after multiple attempts.");
          setStatus("done");
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
      controller?.abort();
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

      {status === "retrying" && (
        <div className="panel panel-warning">
          <p>Didn't complete cleanly — retrying automatically…</p>
        </div>
      )}

      {status === "error" && (
        <div className="panel panel-error">
          <p>
            Couldn't complete this research request after retrying: {errorMessage}
          </p>
          <button className="button" onClick={() => navigate(`/company/${ticker}`)}>
            Try again
          </button>
        </div>
      )}

      {status === "timeout" && (
        <div className="panel panel-error">
          <p>
            This request seems stuck and was stopped after {HANG_SAFETY_MS / 60_000} minutes with no
            response. That shouldn't normally happen — try again.
          </p>
          <button className="button" onClick={() => navigate(`/company/${ticker}`)}>
            Try again
          </button>
        </div>
      )}

      {(status === "loading" || status === "finishing" || toolGroups.length > 0) &&
        status !== "unauthenticated" && (
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
            {status === "finishing" && (
              <div className="progress-item running progress-elapsed">
                Connection dropped, but the research may still be finishing on the server — checking…
              </div>
            )}
          </div>
        )}

      {status === "done" && profile && (
        <div className="results">
          {profile.profile_complete === false && (
            <div className="panel panel-warning">
              <p>
                Financials, valuation, and price loaded. Strategy, leadership, segments, and risk
                factors didn't finish this pass — search this ticker again to complete them.
              </p>
            </div>
          )}
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

          {(profile.pe_ratio != null ||
            profile.ev_to_ebitda != null ||
            profile.ev_to_sales != null ||
            profile.price_to_sales_ratio != null ||
            profile.price_to_book_ratio != null ||
            profile.dividend_yield != null) && (
            <ExpandableCard title="Valuation">
              <div className="info-card-grid">
                <StatTile label="P/E Ratio" value={formatRatio(profile.pe_ratio)} />
                <StatTile label="EV/EBITDA" value={formatRatio(profile.ev_to_ebitda)} />
                <StatTile label="EV/Sales" value={formatRatio(profile.ev_to_sales)} />
                <StatTile label="Price/Sales" value={formatRatio(profile.price_to_sales_ratio)} />
                <StatTile label="Price/Book" value={formatRatio(profile.price_to_book_ratio)} />
                <StatTile label="Dividend Yield" value={formatPercent(profile.dividend_yield)} />
                <StatTile label="EBITDA" value={formatUsd(profile.ebitda_usd)} />
              </div>
            </ExpandableCard>
          )}

          {profile.price_history?.length > 1 && (
            <ExpandableCard title="Price History">
              <PriceChart history={profile.price_history} />
            </ExpandableCard>
          )}

          {(profile.revenue_history?.length > 0 ||
            profile.net_income_history?.length > 0 ||
            profile.eps_history?.length > 0) && (
            <ExpandableCard title="5-Year Trends">
              <TrendTable
                label="Revenue"
                history={profile.revenue_history}
                cagr={profile.revenue_cagr}
                formatValue={formatUsd}
              />
              <TrendTable
                label="Net Income"
                history={profile.net_income_history}
                cagr={profile.net_income_cagr}
                formatValue={formatUsd}
              />
              <TrendTable
                label="Diluted EPS"
                history={profile.eps_history}
                cagr={profile.eps_cagr}
                formatValue={(v) => `$${v.toFixed(2)}`}
              />
            </ExpandableCard>
          )}

          {profile.capital_allocation &&
            Object.values(profile.capital_allocation).some((v) => v != null) && (
              <ExpandableCard title="Capital Allocation">
                <div className="info-card-grid">
                  <StatTile label="CapEx" value={formatUsd(profile.capital_allocation.capex_usd)} />
                  <StatTile label="R&D" value={formatUsd(profile.capital_allocation.research_and_development_usd)} />
                  <StatTile label="SG&A" value={formatUsd(profile.capital_allocation.selling_general_and_administrative_usd)} />
                  <StatTile label="Stock Buybacks" value={formatUsd(profile.capital_allocation.stock_buybacks_usd)} />
                  <StatTile label="Dividends Paid" value={formatUsd(profile.capital_allocation.dividends_paid_usd)} />
                  <StatTile
                    label="Dividend Per Share"
                    value={
                      profile.capital_allocation.dividend_per_share_usd != null
                        ? `$${profile.capital_allocation.dividend_per_share_usd}`
                        : "—"
                    }
                  />
                </div>
              </ExpandableCard>
            )}

          {profile.revenue_segments?.length > 0 && (
            <ExpandableCard title="Revenue by Segment">
              <RevenueSegmentsTable segments={profile.revenue_segments} />
              <p className="segments-note">As disclosed in the company's most recent annual report (10-K or 20-F).</p>
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

          {profile.risk_factors?.length > 0 && (
            <ExpandableCard title="Risk Factors" defaultOpen={false}>
              <p className="segments-note">As disclosed in the company's most recent annual report (Item 1A of a 10-K, or the equivalent risk factors item of a 20-F) — reported as stated, not ranked or scored.</p>
              <ul className="risk-list">
                {profile.risk_factors.map((r, i) => (
                  <li key={i}>
                    <strong>{r.category}</strong>
                    <p>{r.summary}</p>
                  </li>
                ))}
              </ul>
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
