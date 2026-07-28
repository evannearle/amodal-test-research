export default {
  id: "get_filing_summary",
  exposure: { kind: "open" },
  llm_callable: true,
  base: {
    name: "get_filing_summary",
    description:
      "Given a zero-padded 10-digit CIK (from lookup_cik), fetch the company's " +
      "SEC filing history and return its name, industry, former names, and the " +
      "most recent 10-K and DEF 14A filings (accession number + primary document, " +
      "ready to fetch via the sec-tickers Archives endpoint). Always use this " +
      "instead of loading /submissions/CIK{cik}.json yourself — a company with a " +
      "long history can have 700+ filings, too many to reliably scan by reading.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        cik10: {
          type: "string",
          description: "Zero-padded 10-digit CIK, e.g. \"0001236275\".",
        },
      },
      required: ["cik10"],
    },
  },
  async handle(ctx) {
    const cik10 = String(ctx.input.cik10 || "").trim();
    const data = await ctx.request("sec-data", `/submissions/CIK${cik10}.json`);

    const recent = data?.filings?.recent ?? {};
    const forms = recent.form ?? [];
    const dates = recent.filingDate ?? [];
    const accessions = recent.accessionNumber ?? [];
    const docs = recent.primaryDocument ?? [];

    function findFirst(formName) {
      const idx = forms.findIndex((f) => f === formName);
      if (idx === -1) return null;
      return {
        filingDate: dates[idx],
        accessionNumber: accessions[idx],
        accessionNoDashes: String(accessions[idx] || "").replace(/-/g, ""),
        primaryDocument: docs[idx],
      };
    }

    return {
      cik10,
      name: data?.name,
      sicDescription: data?.sicDescription,
      formerNames: (data?.formerNames ?? []).map((n) => ({ name: n.name, from: n.from, to: n.to })),
      totalFilingsScanned: forms.length,
      latest10K: findFirst("10-K"),
      latestDEF14A: findFirst("DEF 14A"),
    };
  },
};
