const STORAGE_KEY = "syncbiz-login-remember";

type SavedLogin = {
  email: string;
  password: string;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadRememberedLogin(): SavedLogin | null {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedLogin>;
    const email = typeof parsed.email === "string" ? parsed.email.trim() : "";
    const password = typeof parsed.password === "string" ? parsed.password : "";
    if (!email) return null;
    return { email, password };
  } catch {
    return null;
  }
}

export function saveRememberedLogin(email: string, password: string): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        email: email.trim().toLowerCase(),
        password,
      }),
    );
  } catch {
    /* private mode / quota — ignore */
  }
}

export function clearRememberedLogin(): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
