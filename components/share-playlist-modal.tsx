"use client";

import type { Playlist } from "@/lib/playlist-types";
import { ShareModal } from "@/components/share-modal";
import { playlistToShareable } from "@/lib/share-utils";

type Props = {
  playlist: Playlist;
  onClose: () => void;
};

export function SharePlaylistModal({ playlist, onClose }: Props) {
  const item = playlistToShareable(playlist);
  return (
    <ShareModal
      item={item}
      fallbackPlaylistId={playlist.id}
      onClose={onClose}
    />
  );
}
