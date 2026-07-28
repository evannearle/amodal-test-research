export default {
  id: "get_company_snapshot",
  exposure: { kind: "open" },
  llm_callable: true,
  base: {
    name: "get_company_snapshot",
    description:
      "Given a stock ticker or company name, resolves it and returns everything " +
      "needed for a financial profile in one call: CIK, company name, industry, " +
      "former names, most recent annual financials (revenue, net income, assets, " +
      "liabilities, equity, diluted EPS, fiscal year), current stock price, " +
      "52-week range, ~6 months of daily closing prices, and the most recent " +
      "10-K/DEF 14A filings (each with a ready-to-use archiveUrl for " +
      "fetch_filing_document). Always use this single tool instead of loading " +
      "company_tickers.json, submissions/CIK{cik}.json, or companyfacts yourself " +
      "— those are too large to scan reliably by reading.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A stock ticker (e.g. \"QXO\") or company name (e.g. \"QXO Inc\").",
        },
      },
      required: ["query"],
    },
  },
  async handle(ctx) {
    const raw = String(ctx.input.query || "").trim();
    const query = raw.toUpperCase();

    const tickerData = await ctx.request("sec-tickers", "/files/company_tickers.json");
    const rows = Object.values(tickerData);

    let matched = rows.find((r) => String(r.ticker).toUpperCase() === query);
    if (!matched) {
      const nameMatches = rows.filter((r) => String(r.title).toUpperCase().includes(query));
      if (nameMatches.length === 1) {
        matched = nameMatches[0];
      } else if (nameMatches.length > 1) {
        return {
          found: false,
          reason: "multiple_matches",
          candidates: nameMatches.slice(0, 10).map((r) => ({ ticker: r.ticker, title: r.title })),
        };
      }
    }
    if (!matched) {
      return { found: false, reason: "not_found", query: raw };
    }

    const ticker = matched.ticker;
    const cik10 = String(matched.cik_str).padStart(10, "0");
    const cikNoZeros = String(Number(cik10));

    const submissions = await ctx.request("sec-data", `/submissions/CIK${cik10}.json`);
    const recent = submissions?.filings?.recent ?? {};
    const forms = recent.form ?? [];
    const dates = recent.filingDate ?? [];
    const accessions = recent.accessionNumber ?? [];
    const docs = recent.primaryDocument ?? [];

    function findFirst(formName) {
      const idx = forms.findIndex((f) => f === formName);
      if (idx === -1) return null;
      const accessionNoDashes = String(accessions[idx] || "").replace(/-/g, "");
      const primaryDocument = docs[idx];
      return {
        filingDate: dates[idx],
        accessionNumber: accessions[idx],
        accessionNoDashes,
        primaryDocument,
        archiveUrl: `/Archives/edgar/data/${cikNoZeros}/${accessionNoDashes}/${primaryDocument}`,
      };
    }

    const latest10K = findFirst("10-K");
    const latestDEF14A = findFirst("DEF 14A");

    let financials = null;
    try {
      const facts = await ctx.request("sec-data", `/api/xbrl/companyfacts/CIK${cik10}.json`);
      const gaap = facts?.facts?.["us-gaap"] ?? {};

      function latestAnnual(tag) {
        const units = gaap[tag]?.units;
        if (!units) return null;
        const series = Object.values(units).flat();
        const annual = series.filter((v) => v.form === "10-K" && v.fp === "FY");
        const pool = annual.length ? annual : series;
        if (!pool.length) return null;
        return [...pool].sort((a, b) => (a.end < b.end ? 1 : -1))[0];
      }

      const revenue =
        latestAnnual("Revenues") ??
        latestAnnual("RevenueFromContractWithCustomerExcludingAssessedTax");
      const netIncome = latestAnnual("NetIncomeLoss");
      const assets = latestAnnual("Assets");
      const liabilities = latestAnnual("Liabilities");
      const equity = latestAnnual("StockholdersEquity");
      const eps = latestAnnual("EarningsPerShareDiluted");

      financials = {
        fiscalYear: revenue?.fy ?? netIncome?.fy ?? null,
        periodEnd: revenue?.end ?? netIncome?.end ?? null,
        revenueUsd: revenue?.val ?? null,
        netIncomeUsd: netIncome?.val ?? null,
        totalAssetsUsd: assets?.val ?? null,
        totalLiabilitiesUsd: liabilities?.val ?? null,
        stockholdersEquityUsd: equity?.val ?? null,
        dilutedEpsUsd: eps?.val ?? null,
      };
    } catch (err) {
      ctx.log(`companyfacts fetch failed for ${cik10}: ${err}`);
    }

    let price = null;
    try {
      const chart = await ctx.request(
        "yahoo-finance",
        `/v8/finance/chart/${ticker}?range=6mo&interval=1d`
      );
      const result = chart?.chart?.result?.[0];
      if (result) {
        const timestamps = result.timestamp ?? [];
        const closes = result.indicators?.quote?.[0]?.close ?? [];
        const points = timestamps
          .map((t, i) => ({
            date: new Date(t * 1000).toISOString().slice(0, 10),
            close: closes[i],
          }))
          .filter((p) => typeof p.close === "number");
        price = {
          currency: result.meta?.currency ?? null,
          currentPrice: result.meta?.regularMarketPrice ?? null,
          fiftyTwoWeekHigh: result.meta?.fiftyTwoWeekHigh ?? null,
          fiftyTwoWeekLow: result.meta?.fiftyTwoWeekLow ?? null,
          history: points,
        };
      }
    } catch (err) {
      ctx.log(`price fetch failed for ${ticker}: ${err}`);
    }

    return {
      found: true,
      ticker,
      title: matched.title,
      cik10,
      name: submissions?.name ?? matched.title,
      sicDescription: submissions?.sicDescription ?? null,
      formerNames: (submissions?.formerNames ?? []).map((n) => ({
        name: n.name,
        from: n.from,
        to: n.to,
      })),
      latest10K,
      latestDEF14A,
      financials,
      price,
    };
  },
};
