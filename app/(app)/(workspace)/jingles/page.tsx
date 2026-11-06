"use client";

import { JinglesPageContent } from "@/components/jingles-control/jingles-page-content";

/**
 * Jingles — a tab of the top bar of its own (owner 2026-10-26). The jingles used to live inside the player (a tab next to the queue, with a "+" that opened the console in the
 * library's centre); now the player is closed on this page (same mechanism as the management pages: UI only, nothing re-mounts, playback keeps running) and the console that
 * used to open from the "+" fills the pane: create, library and schedule of jingles in one place.
 */
export default function JinglesPage() {
  return <JinglesPageContent />;
}
