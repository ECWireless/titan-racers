// Sets an alternative apart from the choices above it.
export function OrDivider() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-3 font-mono text-xs font-bold uppercase tracking-[0.16em] text-titan-muted"
    >
      <span className="h-px flex-1 bg-titan-ice/15" />
      or
      <span className="h-px flex-1 bg-titan-ice/15" />
    </div>
  );
}
