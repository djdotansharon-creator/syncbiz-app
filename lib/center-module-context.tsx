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
  | { kind: "edit-current"; target: CenterModuleEditTarget }
  | null;

type CenterModuleCtx = {
  active: CenterModule;
  setActive: (m: CenterModule) => void;
};

export const CenterModuleContext = createContext<CenterModuleCtx>({
  active: null,
  setActive: () => {},
});

export function useCenterModule(): CenterModuleCtx {
  return useContext(CenterModuleContext);
}

export function isJinglesModule(m: CenterModule): m is "jingles" {
  return m === "jingles";
}

export function isEditCurrentModule(
  m: CenterModule,
): m is { kind: "edit-current"; target: CenterModuleEditTarget } {
  return typeof m === "object" && m !== null && m.kind === "edit-current";
}
