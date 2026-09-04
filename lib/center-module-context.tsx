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

export type CenterModule =
  | "jingles"
  | "royalty-free-music"
  | "my-music-library"
  | "music-library-metadata"
  | "dj-creator-hub"
  | "dj-creator-assistant"
  | "guests"
  | { kind: "edit-current"; target: CenterModuleEditTarget }
  | null;

type CenterModuleCtx = {
  active: CenterModule;
  setActive: (m: CenterModule) => void;
  /**
   * Navigation convention (locked): tools/categories are the center's navigation — there are no X
   * close buttons. `toggle(m)` opens module `m` in the center; calling it again with the SAME active
   * module returns the center to the default Library view (null). Launchers should call this, not
   * setActive, so "same-button → Library" is consistent everywhere.
   */
  toggle: (m: CenterModule) => void;
};

export const CenterModuleContext = createContext<CenterModuleCtx>({
  active: null,
  setActive: () => {},
  toggle: () => {},
});

/** True when two CenterModule values point at the same module (handles the edit-current object case). */
export function sameCenterModule(a: CenterModule, b: CenterModule): boolean {
  if (a === b) return true;
  if (isEditCurrentModule(a) && isEditCurrentModule(b)) {
    return a.target.kind === b.target.kind && a.target.id === b.target.id;
  }
  return false;
}

export function useCenterModule(): CenterModuleCtx {
  return useContext(CenterModuleContext);
}

export function isJinglesModule(m: CenterModule): m is "jingles" {
  return m === "jingles";
}

export function isRoyaltyFreeMusicModule(m: CenterModule): m is "royalty-free-music" {
  return m === "royalty-free-music";
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
