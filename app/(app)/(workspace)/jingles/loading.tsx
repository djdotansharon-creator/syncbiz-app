import { JinglesPageContent } from "@/components/jingles-control/jingles-page-content";

/**
 * Overrides the generic workspace skeleton (app/(app)/(workspace)/loading.tsx — a title + six pulsing cards) for the Jingles tab only: the page is built in the browser and needs
 * nothing from the server, so the real screen is shown straight away while the route streams in (owner 2026-11-06).
 */
export default function JinglesLoading() {
  return <JinglesPageContent />;
}
