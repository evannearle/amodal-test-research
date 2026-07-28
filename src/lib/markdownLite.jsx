function renderInline(line, keyPrefix) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

// Small formatter for typical LLM markdown output: paragraphs, bullet lists,
// and **bold** — enough for research prose without pulling in a full parser.
export function MarkdownLite({ text }) {
  if (!text) return null;
  const blocks = text.split(/\n{2,}/);

  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim().length > 0);
        const isList = lines.length > 0 && lines.every((l) => /^\s*[-*]\s+/.test(l));

        if (isList) {
          return (
            <ul className="prose-list" key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\s*[-*]\s+/, ""), `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <span key={li}>
                {renderInline(l, `${bi}-${li}`)}
                {li < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}
