"use client";

import { useRouter } from "next/navigation";
import { JinglesWorkspacePanel } from "@/components/jingles-control/JinglesShell";

/**
 * The Jingles tab's page body — shared by the page and by its route-level loading boundary (app/(app)/(workspace)/jingles/loading.tsx), so the tab shows the real
 * jingles screen at once instead of the generic workspace skeleton (owner 2026-11-06: "four rectangles flash before the jingle creation I designed appears").
 * Nothing here needs the server — the panel is built in the browser.
 */
export function JinglesPageContent() {
  const router = useRouter();
  return (
    <div className="sb-jingles-page mx-auto w-full max-w-[1240px] px-3 pb-8 pt-3 sm:px-4">
      <JinglesWorkspacePanel onClose={() => router.push("/sources")} />
    </div>
  );
}
