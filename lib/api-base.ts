/** Base URL for server-side fetch to same-origin API. */
export function getApiBase(): string {
  if (typeof process.env.NEXT_PUBLIC_APP_URL === "string" && process.env.NEXT_PUBLIC_APP_URL)
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (typeof process.env.VERCEL_URL === "string" && process.env.VERCEL_URL)
    return `https://${process.env.VERCEL_URL}`;
  if (typeof process.env.RAILWAY_STATIC_URL === "string" && process.env.RAILWAY_STATIC_URL)
    return process.env.RAILWAY_STATIC_URL.replace(/\/$/, "");
  if (typeof process.env.RAILWAY_PUBLIC_DOMAIN === "string" && process.env.RAILWAY_PUBLIC_DOMAIN)
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  const port = process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}
