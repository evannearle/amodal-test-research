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
      "range, ~26 weekly closes (about 6 months), and the most recent annual " +
      "report + proxy filing, each with an archiveUrl (for " +
      "fetch_filing_document) and a documentUrl (absolute sec.gov link — use " +
      "this verbatim as the url when saving a source citation, don't " +
      "reassemble it). latest10K.formType is \"10-K\" for US filers or " +
      "\"20-F\" for foreign private issuers (Shell, Unilever, etc., who never " +
      "file a 10-K) — same idea, different item numbering, still readable " +
      "with fetch_filing_document. latestDEF14A can legitimately be null for " +
      "foreign filers that don't file a US-style proxy — that's normal, not " +
      "missing data. Financials are read from whichever of US-GAAP or IFRS " +
      "the company actually reports under. If the result includes a " +
      "non-null dataNote, that field is authoritative and final — follow it " +
      "exactly, especially any instruction not to call this tool again. " +
      "Always use this single tool instead of loading company_tickers.json, " +
      "submissions/CIK{cik}.json, or companyfacts yourself — those are too " +
      "large to scan reliably by reading.",
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

    // formNames tried in order — lets the annual-report lookup fall back to
    // 20-F (foreign private issuers file this instead of a 10-K and never
    // have one).
    function findFirst(formNames) {
      const candidates = Array.isArray(formNames) ? formNames : [formNames];
      for (const formName of candidates) {
        const idx = forms.findIndex((f) => f === formName);
        if (idx === -1) continue;
        const accessionNoDashes = String(accessions[idx] || "").replace(/-/g, "");
        const primaryDocument = docs[idx];
        const archiveUrl = `/Archives/edgar/data/${cikNoZeros}/${accessionNoDashes}/${primaryDocument}`;
        // Deliberately not returning accessionNumber/primaryDocument as
        // separate fields — giving the model raw pieces invited it to
        // reassemble the URL itself (with the dashed accessionNumber)
        // instead of copying archiveUrl verbatim, which 404s. archiveUrl/
        // documentUrl are the only paths out.
        return {
          formType: formName,
          filingDate: dates[idx],
          archiveUrl,
          documentUrl: `https://www.sec.gov${archiveUrl}`,
        };
      }
      return null;
    }

    // 20-F is the annual report for foreign private issuers (e.g. Shell,
    // Unilever) — they never file a 10-K. Its content covers the same ground
    // (business, financial review, risk factors, leadership) under different
    // item numbers; fetch_filing_document works the same way either way.
    const latest10K = findFirst(["10-K", "20-F"]);
    // Foreign private issuers often don't file a DEF 14A at all — that's
    // normal, not an error; latestDEF14A can legitimately be null.
    const latestDEF14A = findFirst("DEF 14A");

    const businessAddress = submissions?.addresses?.business;
    const headquarters = businessAddress
      ? [businessAddress.city, businessAddress.stateOrCountry].filter(Boolean).join(", ")
      : null;

    let financials = null;
    let sharesOutstanding = null;
    try {
      const facts = await ctx.request("sec-data", `/api/xbrl/companyfacts/CIK${cik10}.json`);
      // Foreign private issuers (Shell, Unilever, etc.) report under IFRS,
      // not US-GAAP, and use different tag names for the same concepts —
      // search both taxonomies for every metric below rather than assuming
      // us-gaap.
      const gaap = facts?.facts?.["us-gaap"] ?? {};
      const ifrs = facts?.facts?.["ifrs-full"] ?? {};
      const dei = facts?.facts?.dei ?? {};

      function mergedSeries(taxonomies, tags) {
        const taxonomyList = Array.isArray(taxonomies) ? taxonomies : [taxonomies];
        const tagList = Array.isArray(tags) ? tags : [tags];
        let combined = [];
        for (const taxonomy of taxonomyList) {
          for (const tag of tagList) {
            const units = taxonomy[tag]?.units;
            if (!units) continue;
            combined = combined.concat(Object.values(units).flat());
          }
        }
        return combined;
      }

      // A company can switch which XBRL tag it reports a metric under (e.g.
      // after a merger, an accounting standard change, or reporting under a
      // different taxonomy). Merge every candidate tag's series together
      // and pick the globally most recent entry — picking the first tag
      // that merely *exists* would silently prefer a stale tag over a
      // newer one under a different name.
      function latestAnnual(tags) {
        const combined = mergedSeries([gaap, ifrs], tags);
        if (!combined.length) return null;
        const annual = combined.filter(
          (v) => (v.form === "10-K" || v.form === "20-F") && v.fp === "FY"
        );
        const pool = annual.length ? annual : combined;
        if (!pool.length) return null;
        return [...pool].sort((a, b) => (a.end < b.end ? 1 : -1))[0];
      }

      // Balance-sheet items (cash, debt, shares outstanding) are point-in-time
      // "instant" facts, not annual totals — just take the single freshest
      // value regardless of form/fiscal-period.
      function mostRecentInstant(taxonomies, tags) {
        const combined = mergedSeries(taxonomies, tags);
        if (!combined.length) return null;
        return [...combined].sort((a, b) => (a.end < b.end ? 1 : -1))[0];
      }

      // Last N annual (10-K/FY) values for a metric, one per fiscal year,
      // oldest first — for trend/CAGR display. Group by the year in `end`
      // (period end date), not the `fy` field: a single filing can report
      // several comparative years (common for 20-F filers, which show 3
      // years of income statement data per filing), all sharing one filing-
      // level `fy` — grouping by that produced mislabeled and even
      // wrongly-ordered years (verified against real Shell data). The period
      // end date is the one thing that's always period-specific.
      function annualHistory(tags, maxYears = 5) {
        const combined = mergedSeries([gaap, ifrs], tags).filter(
          (v) => (v.form === "10-K" || v.form === "20-F") && v.fp === "FY" && v.end
        );
        const byYear = new Map();
        for (const v of combined) {
          const year = Number(String(v.end).slice(0, 4));
          if (!Number.isFinite(year)) continue;
          const existing = byYear.get(year);
          if (!existing || (v.filed ?? "") > (existing.filed ?? "")) byYear.set(year, v);
        }
        return [...byYear.entries()]
          .sort((a, b) => a[0] - b[0])
          .slice(-maxYears)
          .map(([year, v]) => ({ fiscalYear: year, periodEnd: v.end, value: v.val }));
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
        "Revenue", // IFRS
      ];
      const revenue = latestAnnual(revenueTags);
      const netIncome = latestAnnual([
        "NetIncomeLoss",
        "ProfitLoss", // IFRS
        "ProfitLossAttributableToOwnersOfParent", // IFRS
      ]);
      const assets = latestAnnual("Assets"); // same tag name in both taxonomies
      const liabilities = latestAnnual("Liabilities"); // same tag name in both taxonomies
      const equity = latestAnnual([
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
        "Equity", // IFRS
        "EquityAttributableToOwnersOfParent", // IFRS
      ]);
      const epsTags = [
        "EarningsPerShareDiluted",
        "DilutedEarningsLossPerShareFromContinuingOperations", // IFRS
      ];
      const eps = latestAnnual(epsTags);
      const operatingIncome = latestAnnual([
        "OperatingIncomeLoss",
        "ProfitLossFromOperatingActivities", // IFRS
      ]);
      const depreciationAmortization = latestAnnual([
        "DepreciationDepletionAndAmortization",
        "DepreciationAmortizationAndAccretionNet",
        "DepreciationAndAmortization",
        "DepreciationAndAmortisationExpense", // IFRS
      ]);
      const capex = latestAnnual("PaymentsToAcquirePropertyPlantAndEquipment");
      const researchAndDevelopment = latestAnnual("ResearchAndDevelopmentExpense"); // same tag name in both
      const sgAndA = latestAnnual("SellingGeneralAndAdministrativeExpense"); // same tag name in both
      const stockBuybacks = latestAnnual([
        "PaymentsForRepurchaseOfCommonStock",
        "PurchaseOfTreasuryShares", // IFRS
      ]);
      const dividendsPaid = latestAnnual([
        "PaymentsOfDividendsCommonStock",
        "PaymentsOfDividends",
        "DividendsPaid", // IFRS
        "DividendsPaidToEquityHoldersOfParentClassifiedAsFinancingActivities", // IFRS
      ]);
      const dividendPerShare = latestAnnual([
        "CommonStockDividendsPerShareDeclared",
        "DividendsPaidOrdinarySharesPerShare", // IFRS
      ]);

      const cash = mostRecentInstant(
        [gaap, ifrs],
        ["CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalents"]
      );
      const debtNoncurrent = mostRecentInstant([gaap, ifrs], ["LongTermDebtNoncurrent"]);
      const debtCurrent = mostRecentInstant(
        [gaap, ifrs],
        ["LongTermDebtCurrent", "CurrentPortionOfLongtermBorrowings"]
      );
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
      const epsHistory = annualHistory(epsTags);

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

    // Rare but real: a brand-new CIK (e.g. a just-formed holding company from
    // a corporate reorganization) can resolve correctly and have zero XBRL
    // history — this is a genuine, permanent data gap, not a transient
    // failure. Say so explicitly and forcefully in the result itself, right
    // where the model is looking, rather than relying on the skill's system
    // prompt alone — repeated live tests showed the model retrying this tool
    // many times over when it saw an all-null financials block instead of
    // accepting it, even with an explicit "don't retry" instruction upstream.
    let dataNote = null;
    if (
      !financials ||
      (financials.revenueUsd == null && financials.netIncomeUsd == null && financials.totalAssetsUsd == null)
    ) {
      dataNote =
        "This CIK has no historical financial data in SEC's system — most likely a very " +
        "recently created entity (e.g. a new holding company from a corporate reorganization). " +
        "This is final, not an error: calling get_company_snapshot again will return the same " +
        "result. Report the data you do have (price, industry, headquarters) and state plainly " +
        "that financial history isn't available for this entity yet — do not call this tool " +
        "again for this company.";
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
        const daily = timestamps
          .map((t, i) => ({
            date: new Date(t * 1000).toISOString().slice(0, 10),
            close: closes[i],
          }))
          .filter((p) => typeof p.close === "number");
        // Every store save re-sends this whole array (the store's set is a
        // full replace, not a merge — confirmed directly against the live
        // store). A ~124-point daily series is exactly the kind of large,
        // repetitive JSON a model garbles when regenerating it by hand;
        // downsampling to ~1 point/week keeps the chart useful at a fraction
        // of the size and risk.
        const weekStep = Math.max(1, Math.round(daily.length / 26));
        const points = daily.filter((_, i) => i % weekStep === 0 || i === daily.length - 1);
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
      dataNote,
    };
  },
};
