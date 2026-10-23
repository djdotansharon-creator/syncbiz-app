"use client";
import { createContext, useContext } from "react";

/**
 * Identifies which item the player's Edit action wants to open inline
 * inside the library center workspace panel.
 *   - `kind: "playlist"` → `<EditPlaylistForm id />`
 *   - `kind: "source"`   → `<EditSourceForm id />`
 * Radio sources fall through to URL navigation (own route `/radio/[id]/edit`).
 */
export type CenterModuleEditTarget = { kind: "playlist" | "source"; id: string };

/** An album from the search shelf (iTunes metadata) opened as a screen of its own in the center (owner 2026-10-22). */
export type CenterModuleAlbum = { id: string; name: string; artist: string; cover: string | null; tracks: number; year: number | null; url: string };

export type CenterModule =
  | "jingles"
  | "royalty-free-music"
  | "shufersal-bank"
  | "my-music-library"
  | "music-library-metadata"
  | "dj-creator-hub"
  | "dj-creator-assistant"
  | "guests"
  | { kind: "edit-current"; target: CenterModuleEditTarget }
  | { kind: "album"; album: CenterModuleAlbum }
  | null;

type CenterModuleCtx = {
  active: CenterModule;
  setActive: (m: CenterModule) => void;
  /** the active workspace id (the library bar needs it to decide who sees the Shufersal bank button) */
  workspaceId?: string | null;
};

export const CenterModuleContext = createContext<CenterModuleCtx>({
  active: null,
  setActive: () => {},
  workspaceId: null,
});

export function useCenterModule(): CenterModuleCtx {
  return useContext(CenterModuleContext);
}

export function isJinglesModule(m: CenterModule): m is "jingles" {
  return m === "jingles";
}

export function isRoyaltyFreeMusicModule(m: CenterModule): m is "royalty-free-music" {
  return m === "royalty-free-music";
}

export function isShufersalBankModule(m: CenterModule): m is "shufersal-bank" {
  return m === "shufersal-bank";
}

export function isMyMusicLibraryModule(m: CenterModule): m is "my-music-library" {
  return m === "my-music-library";
}

export function isMusicLibraryMetadataModule(m: CenterModule): m is "music-library-metadata" {
  return m === "music-library-metadata";
}

export function isDjCreatorHubModule(m: CenterModule): m is "dj-creator-hub" {
  return m === "dj-creator-hub";
}

export function isGuestsModule(m: CenterModule): m is "guests" {
  return m === "guests";
}

export function isDjCreatorAssistantModule(m: CenterModule): m is "dj-creator-assistant" {
  return m === "dj-creator-assistant";
}

export function isEditCurrentModule(
  m: CenterModule,
): m is { kind: "edit-current"; target: CenterModuleEditTarget } {
  return typeof m === "object" && m !== null && m.kind === "edit-current";
}

export function isAlbumModule(m: CenterModule): m is { kind: "album"; album: CenterModuleAlbum } {
  return typeof m === "object" && m !== null && m.kind === "album";
}
