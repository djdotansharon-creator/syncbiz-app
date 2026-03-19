/**
 * Guest recommendation types and data shape.
 * Used for guest-to-operator recommendation flow.
 */

export type GuestRecommendationStatus = "pending" | "approved" | "rejected";

export type GuestRecommendation = {
  id: string;
  sourceUrl: string;
  sourceType: string;
  guestName?: string;
  guestMessage?: string;
  createdAt: string;
  /** Target session/user – for MVP: userId. */
  targetSessionId: string;
  status: GuestRecommendationStatus;
};

export function guestRecommendationId(): string {
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function inferSourceType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("youtube") || u.includes("youtu.be")) return "youtube";
  if (u.includes("soundcloud")) return "soundcloud";
  if (u.includes("spotify")) return "spotify";
  if (u.match(/\.(m3u8?|pls)(\?|$)/i)) return "winamp";
  if (u.startsWith("http")) return "stream-url";
  return "local";
}
