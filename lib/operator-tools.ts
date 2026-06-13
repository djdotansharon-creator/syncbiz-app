/**
 * Operator / advanced tools gate for Desktop-only maintenance UI.
 * Normal users should not see metadata import, path overrides, or raw paths.
 */

export const OPERATOR_TOOLS_STORAGE_KEY = "syncbiz_operator_tools";

export function isOperatorToolsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_SYNCBIZ_OPERATOR_TOOLS === "1") return true;
  try {
    return localStorage.getItem(OPERATOR_TOOLS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setOperatorToolsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      localStorage.setItem(OPERATOR_TOOLS_STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(OPERATOR_TOOLS_STORAGE_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
}
