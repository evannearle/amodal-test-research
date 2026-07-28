// Minimal client for the Amodal runtime's documented /chat/stream SSE contract.
// POST { message } and parse "data: {...}\n\n" lines. Same-origin cookie auth
// (hosted_auth_mode: user_auth) is sent automatically by the browser.

export async function runResearchQuery(message, { onEvent, signal } = {}) {
  const res = await fetch(`${window.location.origin}/chat/stream`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal,
  });

  if (res.status === 401 || res.status === 403) {
    const err = new Error("UNAUTHENTICATED");
    err.code = "UNAUTHENTICATED";
    throw err;
  }
  if (!res.ok || !res.body) {
    throw new Error(`Chat request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const toolCalls = [];
  const widgets = [];
  let sessionId = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;

      let evt;
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }

      onEvent?.(evt);

      switch (evt.type) {
        case "init":
          sessionId = evt.session_id;
          break;
        case "text_delta":
          text += evt.text ?? evt.delta ?? "";
          break;
        case "tool_call_start":
          toolCalls.push({
            id: evt.tool_id,
            name: evt.tool_name,
            label: evt.running_label ?? evt.tool_name,
            status: "running",
          });
          break;
        case "tool_call_result": {
          const call = toolCalls.find((c) => c.id === evt.tool_id);
          if (call) {
            call.status = evt.status ?? "done";
          }
          break;
        }
        case "widget":
          widgets.push(evt.data ?? evt);
          break;
        default:
          break;
      }
    }
  }

  return { text, toolCalls, widgets, sessionId };
}
