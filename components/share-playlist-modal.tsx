"use client";

import type { Playlist } from "@/lib/playlist-types";
import { ShareModal } from "@/components/share-modal";

type Props = {
  playlist: Playlist;
  onClose: () => void;
};

export function SharePlaylistModal({ playlist, onClose }: Props) {
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/sources?playlist=${encodeURIComponent(playlist.id)}`
      : "";

  return <ShareModal title={playlist.name} shareUrl={shareUrl} onClose={onClose} />;
}
