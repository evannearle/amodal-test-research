const ARCHIVE_URL_PATTERN = /^\/Archives\/edgar\/data\/\d+\/\d+\/[^/]+$/;

export default {
  id: "fetch_filing_document",
  exposure: { kind: "open" },
  llm_callable: true,
  base: {
    name: "fetch_filing_document",
    description:
      "Fetch the text of a SEC filing document using the archiveUrl returned by " +
      "get_company_snapshot (in latest10K.archiveUrl or latestDEF14A.archiveUrl). " +
      "Pass that value straight through as `url`, character for character — do " +
      "not construct, edit, or retype the path yourself. In particular, the " +
      "accession number segment must have no dashes; if you find yourself " +
      "typing an accession number with dashes in it, you're not using the " +
      "provided archiveUrl.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The exact archiveUrl string from get_company_snapshot.",
        },
      },
      required: ["url"],
    },
  },
  async handle(ctx) {
    const url = String(ctx.input.url || "").trim();
    if (!ARCHIVE_URL_PATTERN.test(url)) {
      return {
        error: "invalid_url",
        message:
          "This url is not a valid archiveUrl — it must look exactly like " +
          "/Archives/edgar/data/{digits}/{digits}/{filename}, with no dashes " +
          "in the accession segment. Call get_company_snapshot again if needed " +
          "and copy its latest10K.archiveUrl or latestDEF14A.archiveUrl " +
          "verbatim instead of typing this path yourself.",
      };
    }
    const document = await ctx.request("sec-tickers", url);
    return { url, document };
  },
};
