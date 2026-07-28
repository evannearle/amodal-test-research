export default {
  id: "lookup_cik",
  exposure: { kind: "open" },
  llm_callable: true,
  base: {
    name: "lookup_cik",
    description:
      "Resolve a stock ticker or company name to its exact SEC CIK number. " +
      "Always use this instead of loading company_tickers.json yourself — that " +
      "file has 10,000+ rows and cannot be reliably found by reading it. Returns " +
      "the matched ticker, title, and a zero-padded 10-digit CIK ready to use " +
      "with the sec-data connection or the get_filing_summary tool.",
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
    const data = await ctx.request("sec-tickers", "/files/company_tickers.json");
    const rows = Object.values(data);

    function toResult(row) {
      const cik10 = String(row.cik_str).padStart(10, "0");
      return { found: true, ticker: row.ticker, title: row.title, cik10 };
    }

    const exact = rows.find((r) => String(r.ticker).toUpperCase() === query);
    if (exact) return toResult(exact);

    const nameMatches = rows.filter((r) =>
      String(r.title).toUpperCase().includes(query)
    );
    if (nameMatches.length === 1) return toResult(nameMatches[0]);
    if (nameMatches.length > 1) {
      return {
        found: false,
        reason: "multiple_matches",
        candidates: nameMatches
          .slice(0, 10)
          .map((r) => ({ ticker: r.ticker, title: r.title })),
      };
    }

    return { found: false, reason: "not_found", query: raw };
  },
};
