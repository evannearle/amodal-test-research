import { useState } from "react";

export function ExpandableCard({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="prose expandable-card">
      <button
        className="expandable-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <h3>{title}</h3>
        <span className={"expandable-chevron" + (open ? " open" : "")}>▾</span>
      </button>
      {open && <div className="expandable-body">{children}</div>}
    </div>
  );
}
