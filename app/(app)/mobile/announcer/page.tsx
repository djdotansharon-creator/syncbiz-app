import { MobileAnnouncer } from "@/components/mobile/mobile-announcer";

/**
 * /mobile/announcer — premium full-screen "Record My Performance" surface.
 * Lives under /mobile so phone user-agents aren't redirected away by middleware, but the
 * component renders a fixed full-screen takeover (z-index above the mobile mini-player + nav)
 * for a clean "professional recording device" feel. OFF-PLAYBACK.
 */
export default function MobileAnnouncerPage() {
  return <MobileAnnouncer />;
}
