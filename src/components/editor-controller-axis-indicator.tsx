type EditorControllerAxisIndicatorProps = {
  axis: "x" | "y" | "z";
  testId: string;
};

export function EditorControllerAxisIndicator({
  axis,
  testId,
}: EditorControllerAxisIndicatorProps) {
  return (
    <div
      aria-label={`Controller transform axis: ${axis.toUpperCase()}`}
      aria-live="polite"
      className="flex h-10 shrink-0 items-center gap-0.5 border border-titan-ice/15 bg-titan-panel/70 px-1"
      data-axis={axis}
      data-testid={testId}
      role="status"
      title={`Controller transform axis: ${axis.toUpperCase()} (X cycles)`}
    >
      {(["x", "y", "z"] as const).map((candidate) => (
        <span
          aria-hidden="true"
          className={`grid h-7 w-7 place-items-center border font-mono text-[0.65rem] font-black uppercase tracking-[0.08em] ${
            candidate === axis
              ? "border-titan-hazard bg-titan-hazard/12 text-titan-hazard"
              : "border-transparent text-titan-muted/55"
          }`}
          key={candidate}
        >
          {candidate}
        </span>
      ))}
    </div>
  );
}
