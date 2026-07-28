// Hard ceiling on repeated calls to the same SEC connection within one
// session. Prompt instructions ("call this at most once") are not reliably
// followed by faster/cheaper models on long-history companies (many former
// names, hundreds of filings) — this makes the stop condition deterministic
// instead of advisory.

const callCounts = new Map(); // `${sessionId}:${connection}` -> count
const MAX_TRACKED_SESSIONS = 500;

export function createHook(config) {
  const maxCalls = config.maxCallsPerConnection ?? 4;
  const guardedConnections = new Set(config.connections ?? []);

  return {
    async run(point, payload, ctx) {
      if (point !== "preToolUse") return { action: "allow" };

      const connection = payload.connection;
      if (!connection || !guardedConnections.has(connection)) {
        return { action: "allow" };
      }

      if (callCounts.size > MAX_TRACKED_SESSIONS) {
        callCounts.clear();
      }

      const key = `${ctx.sessionId ?? "unknown"}:${connection}`;
      const count = (callCounts.get(key) ?? 0) + 1;
      callCounts.set(key, count);

      if (count > maxCalls) {
        ctx.log(
          `blocked ${connection} call #${count} (limit ${maxCalls}) for session ${ctx.sessionId}`
        );
        return {
          action: "block",
          reason:
            `You've already called ${connection} ${maxCalls} times in this research pass. ` +
            `Stop calling it and answer now with the data you already have, noting what you couldn't retrieve.`,
        };
      }

      return { action: "allow" };
    },
  };
}
