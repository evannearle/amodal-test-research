import { useEffect, useRef, useState } from "react";
import { SearchBar } from "../components/SearchBar";
import { runResearchQuery } from "../lib/chat";
import { MarkdownLite } from "../lib/markdownLite";

const RESEARCH_TIMEOUT_MS = 120_000;

function buildPrompt(ticker) {
  return (
    `Give me a full research profile for ${ticker}. Include: ` +
    `company background/summary, most recent annual key financials ` +
    `(revenue, net income, total assets, total liabilities, stockholders' equity, ` +
    `diluted EPS, with fiscal year), current strategy, senior leadership (names and titles), ` +
    `and how they go to market / generate revenue. Cite the source filings.`
  );
}

function InfoCard({ widget }) {
  if (!widget || !Array.isArray(widget.properties)) return null;
  return (
    <div className="info-card">
      {widget.title && <h3 className="info-card-title">{widget.title}</h3>}
      <div className="info-card-grid">
        {widget.properties.map((p, i) => (
          <div className="info-card-item" key={i}>
            <div className="info-card-label">{p.label}</div>
            <div className="info-card-value">{p.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Dashboard({ ticker, navigate }) {
  const [status, setStatus] = useState("loading"); // loading | done | error | timeout | unauthenticated
  const [toolCalls, setToolCalls] = useState([]);
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const runIdRef = useRef(0);

  useEffect(() => {
    const runId = ++runIdRef.current;
    const controller = new AbortController();
    setStatus("loading");
    setToolCalls([]);
    setResult(null);
    setErrorMessage(null);
    setElapsedSeconds(0);

    const startedAt = Date.now();
    const tick = setInterval(() => {
      setElapsedSeconds(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    const timeout = setTimeout(() => controller.abort("timeout"), RESEARCH_TIMEOUT_MS);

    runResearchQuery(buildPrompt(ticker), {
      signal: controller.signal,
      onEvent: (evt) => {
        if (runId !== runIdRef.current) return;
        if (evt.type === "tool_call_start" || evt.type === "tool_call_result") {
          setToolCalls((prev) => {
            const next = [...prev];
            const idx = next.findIndex((c) => c.id === evt.tool_id);
            if (evt.type === "tool_call_start") {
              if (idx === -1) {
                next.push({
                  id: evt.tool_id,
                  label: evt.running_label ?? evt.tool_name,
                  doneLabel: evt.completed_label ?? evt.running_label ?? evt.tool_name,
                  status: "running",
                });
              }
            } else if (idx !== -1) {
              next[idx] = { ...next[idx], status: evt.status ?? "success" };
            }
            return next;
          });
        }
      },
    })
      .then((res) => {
        if (runId !== runIdRef.current) return;
        setResult(res);
        setStatus("done");
      })
      .catch((err) => {
        if (runId !== runIdRef.current) return;
        if (err.code === "UNAUTHENTICATED") {
          setStatus("unauthenticated");
        } else if (err.name === "AbortError") {
          if (controller.signal.reason === "timeout") {
            setStatus("timeout");
          }
          // otherwise navigated away; ignore
        } else {
          setErrorMessage(err.message ?? "Something went wrong.");
          setStatus("error");
        }
      })
      .finally(() => {
        clearInterval(tick);
        clearTimeout(timeout);
      });

    return () => {
      clearInterval(tick);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [ticker]);

  const infoCardWidget = result?.widgets?.find((w) => w.widget === "info-card")?.data;

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
            This is taking longer than {RESEARCH_TIMEOUT_MS / 1000}s and was stopped. Companies with a
            long filing history can be slow to research; try again, or ask a narrower question.
          </p>
          <button className="button" onClick={() => navigate(`/company/${ticker}`)}>
            Try again
          </button>
        </div>
      )}

      {(status === "loading" || toolCalls.length > 0) && status !== "unauthenticated" && (
        <div className="progress-list">
          {status === "loading" && toolCalls.length === 0 && (
            <div className="progress-item running">Starting research…</div>
          )}
          {toolCalls.map((c) => (
            <div className={"progress-item " + c.status} key={c.id}>
              {c.status === "running" ? c.label : c.doneLabel}
            </div>
          ))}
          {status === "loading" && (
            <div className="progress-item running progress-elapsed">
              Still working… {elapsedSeconds}s
            </div>
          )}
        </div>
      )}

      {status === "done" && result && (
        <div className="results">
          {infoCardWidget && <InfoCard widget={infoCardWidget} />}
          <div className="prose">
            <MarkdownLite text={result.text} />
          </div>
        </div>
      )}
    </div>
  );
}
