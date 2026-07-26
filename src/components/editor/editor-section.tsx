"use client";

import { useId, useState, type ReactNode } from "react";

export function EditorSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="grid gap-3">
      <h2 className="border-b border-titan-ice/15">
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-3 pb-2 text-left font-mono text-xs font-black uppercase tracking-[0.16em] text-titan-hazard hover:text-titan-ice focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
          title={`${expanded ? "Collapse" : "Expand"} ${title}`}
          type="button"
          onClick={() => setExpanded((current) => !current)}
        >
          <span>{title}</span>
          <svg
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
          >
            <path d="m7 9 5 5 5-5" />
          </svg>
        </button>
      </h2>
      <div className="grid gap-3" hidden={!expanded} id={contentId}>
        {children}
      </div>
    </section>
  );
}
