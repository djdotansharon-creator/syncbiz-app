/** Base URL for server-side fetch to same-origin API. */
export function getApiBase(): string {
  if (typeof process.env.NEXT_PUBLIC_APP_URL === "string" && process.env.NEXT_PUBLIC_APP_URL)
    return process.env.NEXT_PUBLIC_APP_URL;
  if (typeof process.env.VERCEL_URL === "string" && process.env.VERCEL_URL)
    return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
