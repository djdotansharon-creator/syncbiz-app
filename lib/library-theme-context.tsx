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

export type LibraryVisualTheme = "deep-blue" | "graphite-black" | "pearl-light";

const STORAGE_KEY = "syncbiz-library-theme";
/** the look every screen is first drawn in (owner 2026-11-01: the old deep-blue look flashed before the saved one; the display mode puts every player screen on graphite or pearl anyway) */
export const DEFAULT_LIBRARY_THEME: LibraryVisualTheme = "graphite-black";

/** Pearl Light is not offered in UI; map stored value to a supported mode. */
function normalizeLibraryTheme(raw: string | null): LibraryVisualTheme {
  if (raw === "graphite-black") return "graphite-black";
  if (raw === "pearl-light") return "pearl-light";
  if (raw === "deep-blue") return "deep-blue"; // only when someone chose it — nothing stored means the owner's look
  return DEFAULT_LIBRARY_THEME;
}

function readStoredTheme(): LibraryVisualTheme {
  if (typeof window === "undefined") return DEFAULT_LIBRARY_THEME;
  return normalizeLibraryTheme(localStorage.getItem(STORAGE_KEY));
}

type LibraryThemeContextValue = {
  libraryTheme: LibraryVisualTheme;
  setLibraryTheme: (next: LibraryVisualTheme) => void;
};

const LibraryThemeContext = createContext<LibraryThemeContextValue | null>(null);

export function LibraryThemeProvider({ children }: { children: ReactNode }) {
  const [libraryTheme, setLibraryThemeState] = useState<LibraryVisualTheme>(DEFAULT_LIBRARY_THEME);

  useEffect(() => {
    setLibraryThemeState(readStoredTheme());
  }, []);

  const setLibraryTheme = useCallback((next: LibraryVisualTheme) => {
    const resolved = next;
    setLibraryThemeState(resolved);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, resolved);
    }
  }, []);

  const value = useMemo(
    () => ({ libraryTheme, setLibraryTheme }),
    [libraryTheme, setLibraryTheme],
  );

  return (
    <LibraryThemeContext.Provider value={value}>{children}</LibraryThemeContext.Provider>
  );
}

export function useLibraryTheme() {
  const ctx = useContext(LibraryThemeContext);
  return (
    ctx ?? {
      libraryTheme: DEFAULT_LIBRARY_THEME,
      setLibraryTheme: () => {},
    }
  );
}
