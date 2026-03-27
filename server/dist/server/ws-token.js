/**
 * WS token verification. Shared logic with lib/auth.ts.
 * Server uses this to avoid Next.js module resolution issues.
 */
import { createHmac } from "crypto";
const WS_TOKEN_PURPOSE = "ws_register";
export function verifyWsToken(token) {
    const secret = process.env.SYNCBIZ_WS_SECRET ?? process.env.WS_SECRET;
    if (!secret || secret.length < 16)
        return null;
    if (!token || typeof token !== "string")
        return null;
    const parts = token.split(".");
    if (parts.length !== 2)
        return null;
    const [payloadB64, sigB64] = parts;
    const expectedSig = createHmac("sha256", secret).update(payloadB64).digest("base64url");
    if (expectedSig !== sigB64)
        return null;
    let payload;
    try {
        payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    }
    catch {
        return null;
    }
    if (payload.purpose !== WS_TOKEN_PURPOSE)
        return null;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp < now)
        return null;
    if (typeof payload.iat !== "number" || payload.iat > now + 60)
        return null;
    const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
    return userId.length > 0 ? userId : null;
}
