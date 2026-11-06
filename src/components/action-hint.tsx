import type { ReactNode } from "react";

// The editors' tooltip look, shown above a button.
const HINT_CLASS =
  "pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max -translate-x-1/2 border border-titan-ice/20 bg-titan-black/96 px-2 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.08em] text-titan-ice shadow-[0_8px_30px_rgb(0_0_0/0.6)] transition-opacity duration-150";

/**
 * A tooltip over a button, on hover or focus, or while `shown`. It is
 * hidden from screen readers, which hear the button's own name.
 */
export function ActionHint({
  align = "center",
  children,
  className = "",
  hint,
  shown = null,
}: {
  /** "end" keeps a hint by its container's right edge on screen. */
  align?: "center" | "end";
  children: ReactNode;
  /** For the wrapper around the button, such as to let it stretch. */
  className?: string;
  hint: string;
  /** Shown regardless of hover or focus; false hides it even then. */
  shown?: boolean | null;
}) {
  return (
    <span className={`group relative ${className}`}>
      {children}
      <span
        aria-hidden="true"
        className={`${HINT_CLASS} ${
          align === "end" ? "left-auto right-0 translate-x-0" : ""
        } ${
          shown
            ? "opacity-100"
            : shown === false
              ? "opacity-0"
              : "opacity-0 group-has-[:focus-visible]:opacity-100 group-hover:opacity-100"
        }`}
      >
        {hint}
      </span>
    </span>
  );
}
