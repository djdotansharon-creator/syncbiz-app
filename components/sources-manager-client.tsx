"use client";

import dynamic from "next/dynamic";
import type { UnifiedSource } from "@/lib/source-types";

/**
 * `SourcesManager` must not SSR: it uses `usePlayback` from the root `PlaybackProvider`.
 * As a child of a Server page, a plain client import can be pre-rendered outside that
 * provider in the RSC+SSR pass (Next 16), causing a recoverable error. Client-only
 * mount matches paste/hydration and keeps the same tree as other app routes.
 */
const SourcesManager = dynamic(
  () => import("@/components/sources-manager").then((m) => m.SourcesManager),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-12 text-center text-slate-500">Loading…</div>
    ),
  },
);

export type SourcesManagerClientProps = {
  initialSources: UnifiedSource[];
  pageTitle?: string;
  pageSubtitle?: string;
};

export function SourcesManagerClient(props: SourcesManagerClientProps) {
  return <SourcesManager {...props} />;
}
