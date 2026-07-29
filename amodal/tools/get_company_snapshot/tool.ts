export default {
  id: "get_company_snapshot",
  exposure: { kind: "open" },
  llm_callable: true,
  base: {
    name: "get_company_snapshot",
    description:
      "Given a stock ticker or company name, resolves it and returns everything " +
      "needed for a financial profile in one call: CIK, company name, industry, " +
      "headquarters, former names, most recent annual financials (revenue, net " +
      "income, assets, liabilities, equity, diluted EPS, EBITDA, cash, total " +
      "debt, fiscal year), capital allocation (capex, R&D, SG&A, buybacks, " +
      "dividends), 5-year history + CAGR for revenue/net income/EPS, valuation " +
      "(shares outstanding, market cap, enterprise value, P/E, EV/EBITDA, " +
      "EV/Sales, P/S, P/B, dividend yield — all computed from the same fetched " +
      "figures, don't recompute them yourself), current stock price, 52-week " +
      "range, ~6 months of daily closing prices, and the most recent 10-K/DEF " +
      "14A filings, each with an archiveUrl (for fetch_filing_document) and a " +
      "documentUrl (absolute sec.gov link — use this verbatim as the url when " +
      "saving a source citation, don't reassemble it). Always use this single " +
      "tool instead of loading company_tickers.json, submissions/CIK{cik}.json, " +
      "or companyfacts yourself — those are too large to scan reliably by reading.",
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
      const archiveUrl = `/Archives/edgar/data/${cikNoZeros}/${accessionNoDashes}/${primaryDocument}`;
      // Deliberately not returning accessionNumber/primaryDocument as separate
      // fields — giving the model raw pieces invited it to reassemble the URL
      // itself (with the dashed accessionNumber) instead of copying archiveUrl
      // verbatim, which 404s. archiveUrl/documentUrl are the only paths out.
      return {
        filingDate: dates[idx],
        archiveUrl,
        documentUrl: `https://www.sec.gov${archiveUrl}`,
      };
    }

    const latest10K = findFirst("10-K");
    const latestDEF14A = findFirst("DEF 14A");

    const businessAddress = submissions?.addresses?.business;
    const headquarters = businessAddress
      ? [businessAddress.city, businessAddress.stateOrCountry].filter(Boolean).join(", ")
      : null;

    let financials = null;
    let sharesOutstanding = null;
    try {
      const facts = await ctx.request("sec-data", `/api/xbrl/companyfacts/CIK${cik10}.json`);
      const gaap = facts?.facts?.["us-gaap"] ?? {};
      const dei = facts?.facts?.dei ?? {};

      function mergedSeries(taxonomy, tags) {
        const tagList = Array.isArray(tags) ? tags : [tags];
        let combined = [];
        for (const tag of tagList) {
          const units = taxonomy[tag]?.units;
          if (!units) continue;
          combined = combined.concat(Object.values(units).flat());
        }
        return combined;
      }

      // A company can switch which XBRL tag it reports a metric under (e.g.
      // after a merger or accounting standard change). Merge every candidate
      // tag's series together and pick the globally most recent entry —
      // picking the first tag that merely *exists* would silently prefer a
      // stale tag over a newer one under a different name.
      function latestAnnual(tags) {
        const combined = mergedSeries(gaap, tags);
        if (!combined.length) return null;
        const annual = combined.filter((v) => v.form === "10-K" && v.fp === "FY");
        const pool = annual.length ? annual : combined;
        if (!pool.length) return null;
        return [...pool].sort((a, b) => (a.end < b.end ? 1 : -1))[0];
      }

      // Balance-sheet items (cash, debt, shares outstanding) are point-in-time
      // "instant" facts, not annual totals — just take the single freshest
      // value regardless of form/fiscal-period.
      function mostRecentInstant(taxonomy, tags) {
        const combined = mergedSeries(taxonomy, tags);
        if (!combined.length) return null;
        return [...combined].sort((a, b) => (a.end < b.end ? 1 : -1))[0];
      }

      // Last N annual (10-K/FY) values for a metric, one per fiscal year
      // (a company can restate a prior year, so dedupe by fy keeping the
      // most recently filed value), oldest first — for trend/CAGR display.
      function annualHistory(tags, maxYears = 5) {
        const combined = mergedSeries(gaap, tags).filter(
          (v) => v.form === "10-K" && v.fp === "FY" && v.fy != null
        );
        const byYear = new Map();
        for (const v of combined) {
          const existing = byYear.get(v.fy);
          if (!existing || (v.filed ?? "") > (existing.filed ?? "")) byYear.set(v.fy, v);
        }
        return [...byYear.values()]
          .sort((a, b) => a.fy - b.fy)
          .slice(-maxYears)
          .map((v) => ({ fiscalYear: v.fy, periodEnd: v.end, value: v.val }));
      }

      function cagr(history) {
        if (history.length < 2) return null;
        const first = history[0];
        const last = history[history.length - 1];
        const years = last.fiscalYear - first.fiscalYear;
        if (years <= 0 || first.value <= 0 || last.value <= 0) return null;
        return Math.pow(last.value / first.value, 1 / years) - 1;
      }

      const revenueTags = [
        "Revenues",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
      ];
      const revenue = latestAnnual(revenueTags);
      const netIncome = latestAnnual("NetIncomeLoss");
      const assets = latestAnnual("Assets");
      const liabilities = latestAnnual("Liabilities");
      const equity = latestAnnual([
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
      ]);
      const epsTag = "EarningsPerShareDiluted";
      const eps = latestAnnual(epsTag);
      const operatingIncome = latestAnnual("OperatingIncomeLoss");
      const depreciationAmortization = latestAnnual([
        "DepreciationDepletionAndAmortization",
        "DepreciationAmortizationAndAccretionNet",
        "DepreciationAndAmortization",
      ]);
      const capex = latestAnnual("PaymentsToAcquirePropertyPlantAndEquipment");
      const researchAndDevelopment = latestAnnual("ResearchAndDevelopmentExpense");
      const sgAndA = latestAnnual("SellingGeneralAndAdministrativeExpense");
      const stockBuybacks = latestAnnual("PaymentsForRepurchaseOfCommonStock");
      const dividendsPaid = latestAnnual(["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"]);
      const dividendPerShare = latestAnnual("CommonStockDividendsPerShareDeclared");

      const cash = mostRecentInstant(gaap, ["CashAndCashEquivalentsAtCarryingValue"]);
      const debtNoncurrent = mostRecentInstant(gaap, ["LongTermDebtNoncurrent"]);
      const debtCurrent = mostRecentInstant(gaap, ["LongTermDebtCurrent"]);
      const shares = mostRecentInstant(dei, ["EntityCommonStockSharesOutstanding"]);
      sharesOutstanding = shares?.val ?? null;

      const totalDebtUsd =
        debtNoncurrent?.val != null || debtCurrent?.val != null
          ? (debtNoncurrent?.val ?? 0) + (debtCurrent?.val ?? 0)
          : null;

      const ebitdaUsd =
        operatingIncome?.val != null
          ? operatingIncome.val + (depreciationAmortization?.val ?? 0)
          : null;

      const revenueHistory = annualHistory(revenueTags);
      const netIncomeHistory = annualHistory(["NetIncomeLoss"]);
      const epsHistory = annualHistory([epsTag]);

      financials = {
        fiscalYear: revenue?.fy ?? netIncome?.fy ?? null,
        periodEnd: revenue?.end ?? netIncome?.end ?? null,
        revenueUsd: revenue?.val ?? null,
        netIncomeUsd: netIncome?.val ?? null,
        totalAssetsUsd: assets?.val ?? null,
        totalLiabilitiesUsd: liabilities?.val ?? null,
        stockholdersEquityUsd: equity?.val ?? null,
        dilutedEpsUsd: eps?.val ?? null,
        cashUsd: cash?.val ?? null,
        totalDebtUsd,
        ebitdaUsd,
        capitalAllocation: {
          capExUsd: capex?.val ?? null,
          researchAndDevelopmentUsd: researchAndDevelopment?.val ?? null,
          sellingGeneralAndAdministrativeUsd: sgAndA?.val ?? null,
          stockBuybacksUsd: stockBuybacks?.val ?? null,
          dividendsPaidUsd: dividendsPaid?.val ?? null,
          dividendPerShareUsd: dividendPerShare?.val ?? null,
        },
        trends: {
          revenueHistory,
          netIncomeHistory,
          epsHistory,
          revenueCagr: cagr(revenueHistory),
          netIncomeCagr: cagr(netIncomeHistory),
          epsCagr: cagr(epsHistory),
        },
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

    let valuation = null;
    if (price?.currentPrice != null && sharesOutstanding != null) {
      const marketCapUsd = price.currentPrice * sharesOutstanding;
      const hasDebtAndCash = financials?.totalDebtUsd != null && financials?.cashUsd != null;
      const enterpriseValueUsd = hasDebtAndCash
        ? marketCapUsd + financials.totalDebtUsd - financials.cashUsd
        : null;

      const eps = financials?.dilutedEpsUsd;
      const revenue = financials?.revenueUsd;
      const equity = financials?.stockholdersEquityUsd;
      const ebitda = financials?.ebitdaUsd;
      const dividendPerShare = financials?.capitalAllocation?.dividendPerShareUsd;

      valuation = {
        sharesOutstanding,
        marketCapUsd,
        enterpriseValueUsd,
        // Simple ratios computed from figures already fetched above — no
        // interpretation, just arithmetic. null when an input is missing or
        // a ratio would be nonsensical (e.g. negative-earnings P/E).
        peRatio: eps > 0 ? price.currentPrice / eps : null,
        priceToSalesRatio: revenue > 0 ? marketCapUsd / revenue : null,
        priceToBookRatio: equity > 0 ? marketCapUsd / equity : null,
        evToEbitda: enterpriseValueUsd != null && ebitda > 0 ? enterpriseValueUsd / ebitda : null,
        evToSales: enterpriseValueUsd != null && revenue > 0 ? enterpriseValueUsd / revenue : null,
        dividendYield:
          dividendPerShare > 0 ? dividendPerShare / price.currentPrice : null,
      };
    }

    return {
      found: true,
      ticker,
      title: matched.title,
      cik10,
      name: submissions?.name ?? matched.title,
      sicDescription: submissions?.sicDescription ?? null,
      headquarters,
      formerNames: (submissions?.formerNames ?? []).map((n) => ({
        name: n.name,
        from: n.from,
        to: n.to,
      })),
      latest10K,
      latestDEF14A,
      financials,
      valuation,
      price,
    };
  },
};
