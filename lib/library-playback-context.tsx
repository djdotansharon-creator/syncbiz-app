"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { LibraryItem } from "./library-types";
import type { Playlist } from "./playlist-types";
import type { Source } from "./types";
import { getPlaylistTracks } from "./playlist-types";
import { canEmbedInCard } from "./playlist-utils";
import { supportsEmbedded } from "./player-utils";

export type LibraryPlaybackStatus = "idle" | "playing" | "paused" | "stopped";

type LibraryPlaybackState = {
  currentItem: LibraryItem | null;
  currentTrackIndex: number;
  status: LibraryPlaybackStatus;
  volume: number;
  items: LibraryItem[];
  shuffle: boolean;
};

type LibraryPlaybackContextValue = LibraryPlaybackState & {
  playItem: (item: LibraryItem, trackIndex?: number) => void;
  pause: () => void;
  stop: () => void;
  prev: () => void;
  next: () => void;
  setVolume: (v: number) => void;
  setItems: (items: LibraryItem[]) => void;
  setShuffle: (v: boolean) => void;
  isActive: (item: LibraryItem, trackIndex?: number) => boolean;
  /** Current playable URL for embedded player (YT/SC). */
  currentPlayUrl: string | null;
  /** Whether current item uses embedded player. */
  isEmbedded: boolean;
};

const LibraryPlaybackContext = createContext<LibraryPlaybackContextValue | null>(null);

function sourceToTarget(source: Source): string {
  return (source.target ?? source.uriOrPath ?? "").trim();
}

export function LibraryPlaybackProvider({
  children,
  items: initialItems,
}: {
  children: ReactNode;
  items: LibraryItem[];
}) {
  const [items, setItemsState] = useState(initialItems);
  const [currentItem, setCurrentItem] = useState<LibraryItem | null>(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [status, setStatus] = useState<LibraryPlaybackStatus>("idle");
  const [volume, setVolumeState] = useState(80);
  const [shuffle, setShuffleState] = useState(false);

  useEffect(() => {
    setItemsState(initialItems);
  }, [initialItems]);

  const getPlayUrl = useCallback((item: LibraryItem, trackIdx: number): string | null => {
    if (item.kind === "playlist") {
      const tracks = getPlaylistTracks(item.data);
      const track = tracks[trackIdx];
      return track?.url ?? item.data.url ?? null;
    }
    return sourceToTarget(item.data);
  }, []);

  const isEmbeddedItem = useCallback((item: LibraryItem, trackIdx?: number): boolean => {
    if (item.kind === "playlist") {
      const tracks = getPlaylistTracks(item.data);
      const idx = trackIdx ?? (item === currentItem ? currentTrackIndex : 0);
      const track = tracks[idx] ?? tracks[0];
      return track ? canEmbedInCard(track.type) : canEmbedInCard(item.data.type);
    }
    return supportsEmbedded(item.data);
  }, [currentItem, currentTrackIndex]);

  const currentPlayUrl = currentItem ? getPlayUrl(currentItem, currentTrackIndex) : null;
  const isEmbedded = currentItem ? isEmbeddedItem(currentItem) : false;

  const stopPrevious = useCallback(() => {
    fetch("/api/commands/stop-local", { method: "POST" }).catch(() => {});
  }, []);

  const playItem = useCallback(
    (item: LibraryItem, trackIndex = 0) => {
      setCurrentItem(item);
      setCurrentTrackIndex(trackIndex);
      setStatus("playing");

      if (item.kind === "playlist") {
        const tracks = getPlaylistTracks(item.data);
        const track = tracks[trackIndex];
        const url = track?.url ?? item.data.url;
        if (track && canEmbedInCard(track.type)) {
          stopPrevious();
          return;
        }
        stopPrevious();
        fetch("/api/commands/play-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: url }),
        }).catch(() => {});
      } else {
        const target = sourceToTarget(item.data);
        if (supportsEmbedded(item.data)) {
          stopPrevious();
          return;
        }
        stopPrevious();
        fetch("/api/commands/play-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target,
            browserPreference: item.data.browserPreference ?? "default",
          }),
        }).catch(() => {});
      }
    },
    [stopPrevious],
  );

  const pause = useCallback(() => setStatus("paused"), []);
  const stop = useCallback(() => {
    setStatus("stopped");
    fetch("/api/commands/stop-local", { method: "POST" }).catch(() => {});
  }, []);

  const playLocalForCurrent = useCallback(() => {
    if (!currentItem) return;
    const url = getPlayUrl(currentItem, currentTrackIndex);
    if (!url) return;
    fetch("/api/commands/play-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: url,
        browserPreference: currentItem.kind === "source" ? currentItem.data.browserPreference ?? "default" : undefined,
      }),
    }).catch(() => {});
  }, [currentItem, currentTrackIndex, getPlayUrl]);

  useEffect(() => {
    if (!currentItem || status !== "playing") return;
    if (isEmbeddedItem(currentItem)) return;
    playLocalForCurrent();
  }, [currentItem, currentTrackIndex, status, isEmbeddedItem, playLocalForCurrent]);

  const prev = useCallback(() => {
    if (!currentItem) return;
    if (currentItem.kind === "playlist") {
      const tracks = getPlaylistTracks(currentItem.data);
      const nextIdx = currentTrackIndex <= 0 ? tracks.length - 1 : currentTrackIndex - 1;
      setCurrentTrackIndex(nextIdx);
      setStatus("playing");
      const track = tracks[nextIdx];
      if (track && !canEmbedInCard(track.type)) {
        stopPrevious();
        fetch("/api/commands/play-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: track.url }),
        }).catch(() => {});
      }
    } else {
      const idx = items.findIndex((i) => i === currentItem);
      if (idx <= 0) return;
      const prevItem = items[idx - 1];
      playItem(prevItem);
    }
  }, [currentItem, currentTrackIndex, items, playItem, stopPrevious]);

  const next = useCallback(() => {
    if (!currentItem) return;
    if (currentItem.kind === "playlist") {
      const tracks = getPlaylistTracks(currentItem.data);
      const nextIdx = currentTrackIndex >= tracks.length - 1 ? 0 : currentTrackIndex + 1;
      setCurrentTrackIndex(nextIdx);
      setStatus("playing");
      const track = tracks[nextIdx];
      if (track && !canEmbedInCard(track.type)) {
        stopPrevious();
        fetch("/api/commands/play-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: track.url }),
        }).catch(() => {});
      }
    } else {
      const idx = items.findIndex((i) => i === currentItem);
      const nextIdx = idx < 0 ? 0 : idx >= items.length - 1 ? 0 : idx + 1;
      const nextItem = items[nextIdx];
      if (nextItem) playItem(nextItem);
    }
  }, [currentItem, currentTrackIndex, items, playItem, stopPrevious]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.max(0, Math.min(100, v)));
  }, []);

  const setItems = useCallback((p: LibraryItem[]) => setItemsState(p), []);
  const setShuffle = useCallback((v: boolean) => setShuffleState(v), []);

  const isActive = useCallback(
    (item: LibraryItem, trackIndex?: number) => {
      if (currentItem !== item) return false;
      if (item.kind === "playlist" && trackIndex !== undefined) {
        return currentTrackIndex === trackIndex;
      }
      return true;
    },
    [currentItem, currentTrackIndex],
  );

  const value = useMemo<LibraryPlaybackContextValue>(
    () => ({
      items,
      currentItem,
      currentTrackIndex,
      status,
      volume,
      shuffle,
      playItem,
      pause,
      stop,
      prev,
      next,
      setVolume,
      setItems,
      setShuffle,
      isActive,
      currentPlayUrl,
      isEmbedded,
    }),
    [
      items,
      currentItem,
      currentTrackIndex,
      status,
      volume,
      shuffle,
      playItem,
      pause,
      stop,
      prev,
      next,
      setVolume,
      setItems,
      setShuffle,
      isActive,
      currentPlayUrl,
      isEmbedded,
    ],
  );

  return (
    <LibraryPlaybackContext.Provider value={value}>
      {children}
    </LibraryPlaybackContext.Provider>
  );
}

export function useLibraryPlayback() {
  const ctx = useContext(LibraryPlaybackContext);
  if (!ctx) throw new Error("useLibraryPlayback must be used within LibraryPlaybackProvider");
  return ctx;
}
