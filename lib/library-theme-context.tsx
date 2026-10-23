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

/** Pearl Light is not offered in UI; map stored value to a supported mode. */
function normalizeLibraryTheme(raw: string | null): LibraryVisualTheme {
  if (raw === "graphite-black") return "graphite-black";
  if (raw === "pearl-light") return "deep-blue";
  return "deep-blue";
}

function readStoredTheme(): LibraryVisualTheme {
  if (typeof window === "undefined") return "deep-blue";
  return normalizeLibraryTheme(localStorage.getItem(STORAGE_KEY));
}

type LibraryThemeContextValue = {
  libraryTheme: LibraryVisualTheme;
  setLibraryTheme: (next: LibraryVisualTheme) => void;
};

const LibraryThemeContext = createContext<LibraryThemeContextValue | null>(null);

export function LibraryThemeProvider({ children }: { children: ReactNode }) {
  const [libraryTheme, setLibraryThemeState] = useState<LibraryVisualTheme>("deep-blue");

  useEffect(() => {
    setLibraryThemeState(readStoredTheme());
    if (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "pearl-light") {
      localStorage.setItem(STORAGE_KEY, "deep-blue");
    }
  }, []);

  const setLibraryTheme = useCallback((next: LibraryVisualTheme) => {
    const resolved = next === "pearl-light" ? "deep-blue" : next;
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
      libraryTheme: "deep-blue" as LibraryVisualTheme,
      setLibraryTheme: () => {},
    }
  );
}
