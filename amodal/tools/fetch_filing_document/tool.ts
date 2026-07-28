export default {
  id: "fetch_filing_document",
  exposure: { kind: "open" },
  llm_callable: true,
  base: {
    name: "fetch_filing_document",
    description:
      "Fetch the text of a SEC filing document using the archiveUrl returned by " +
      "get_filing_summary (in latest10K.archiveUrl or latestDEF14A.archiveUrl). " +
      "Pass that value straight through as `url` — do not try to construct or " +
      "edit the path yourself (it's case-sensitive and easy to get wrong).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The exact archiveUrl string from get_filing_summary.",
        },
      },
      required: ["url"],
    },
  },
  async handle(ctx) {
    const url = String(ctx.input.url || "").trim();
    if (!url.startsWith("/Archives/edgar/data/")) {
      return {
        error: "invalid_url",
        message:
          "url must be an archiveUrl copied verbatim from get_filing_summary's " +
          "latest10K/latestDEF14A result, starting with /Archives/edgar/data/.",
      };
    }
    const document = await ctx.request("sec-tickers", url);
    return { url, document };
  },
};
