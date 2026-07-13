/**
 * Instant navigation feedback for every workspace route (schedules, radio,
 * settings, …). These pages are force-dynamic and block on remote-DB fetches;
 * without this boundary a top-nav tab click froze on the old page until the
 * data arrived. The deck + rails live in the layout and stay put — only the
 * center column shows this quiet skeleton while the route streams in.
 */
export default function WorkspaceLoading() {
  return (
    <div className="sb-anim-rise space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2.5">
        <div className="h-6 w-44 animate-pulse rounded-lg bg-white/[0.06]" />
        <div className="h-3.5 w-72 animate-pulse rounded bg-white/[0.04]" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.04]"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
