/**
 * Strict verification for WS auth/identity boundary.
 * Run: node verify-auth.mjs
 * Requires: WS server on localhost:3001, SYNCBIZ_WS_SECRET set
 */

import WebSocket from "ws";
import { createHmac } from "crypto";

const WS_URL = "ws://localhost:3001";
const APP_URL = "http://localhost:3000";
const SECRET = process.env.SYNCBIZ_WS_SECRET ?? process.env.WS_SECRET;

function createTestToken(userId, expOffset = 60) {
  if (!SECRET || SECRET.length < 16) throw new Error("SYNCBIZ_WS_SECRET required");
  const now = Math.floor(Date.now() / 1000);
  const payload = { purpose: "ws_register", userId, iat: now, exp: now + expOffset };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

async function wsConnect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

async function waitClose(ws) {
  return new Promise((resolve) => {
    ws.on("close", (code, reason) => resolve({ code, reason: reason?.toString() }));
  });
}

async function waitMessage(ws, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(t);
      try {
        resolve(JSON.parse(data.toString()));
      } catch {
        resolve(data.toString());
      }
    });
  });
}

const results = [];

async function run() {
  console.log("=== SyncBiz WS Auth Verification ===\n");

  // 1. Unauthenticated socket - no REGISTER, wait for timeout
  try {
    const ws1 = await wsConnect();
    const close1 = await waitClose(ws1);
    results.push({
      check: "1. Unauthenticated socket timeout",
      pass: close1.code === 4001 && (close1.reason || "").includes("REGISTER timeout"),
      detail: `code=${close1.code}, reason=${close1.reason}`,
    });
  } catch (e) {
    results.push({ check: "1. Unauthenticated socket timeout", pass: false, detail: String(e) });
  }

  // 2. Malformed pre-auth message
  try {
    const ws2 = await wsConnect();
    ws2.send("not valid json");
    const close2 = await waitClose(ws2);
    results.push({
      check: "2. Malformed pre-auth message",
      pass: close2.code === 4002 && (close2.reason || "").includes("Malformed"),
      detail: `code=${close2.code}, reason=${close2.reason}`,
    });
  } catch (e) {
    results.push({ check: "2. Malformed pre-auth message", pass: false, detail: String(e) });
  }

  // 3. Non-REGISTER first message
  try {
    const ws3 = await wsConnect();
    ws3.send(JSON.stringify({ type: "COMMAND", command: "PLAY" }));
    const close3 = await waitClose(ws3);
    results.push({
      check: "3. Non-REGISTER first message",
      pass: close3.code === 4003 && (close3.reason || "").includes("First message must be REGISTER"),
      detail: `code=${close3.code}, reason=${close3.reason}`,
    });
  } catch (e) {
    results.push({ check: "3. Non-REGISTER first message", pass: false, detail: String(e) });
  }

  // 4. REGISTER without authToken
  try {
    const ws4 = await wsConnect();
    ws4.send(JSON.stringify({ type: "REGISTER", role: "controller", branchId: "default" }));
    const msg4 = await waitMessage(ws4);
    const close4 = await waitClose(ws4);
    results.push({
      check: "4. REGISTER without authToken",
      pass: msg4?.type === "ERROR" && (msg4?.message || "").includes("Authentication") && (close4.code === 4004 || close4.code === 1000),
      detail: `msg=${JSON.stringify(msg4)}, code=${close4.code}`,
    });
  } catch (e) {
    results.push({ check: "4. REGISTER without authToken", pass: false, detail: String(e) });
  }

  // 4b. REGISTER with invalid token
  try {
    const ws5 = await wsConnect();
    ws5.send(JSON.stringify({ type: "REGISTER", role: "controller", authToken: "invalid.token.here", branchId: "default" }));
    const msg5 = await waitMessage(ws5);
    const close5 = await waitClose(ws5);
    results.push({
      check: "4. REGISTER invalid authToken",
      pass: msg5?.type === "ERROR" && (msg5?.message || "").toLowerCase().includes("invalid") && (close5.code === 4005 || close5.code === 1000),
      detail: `msg=${JSON.stringify(msg5)}, code=${close5.code}`,
    });
  } catch (e) {
    results.push({ check: "4. REGISTER invalid authToken", pass: false, detail: String(e) });
  }

  // 4c. REGISTER with expired token
  try {
    const expiredToken = createTestToken("test@syncbiz.com", -60);
    const ws6 = await wsConnect();
    ws6.send(JSON.stringify({ type: "REGISTER", role: "controller", authToken: expiredToken, branchId: "default" }));
    const msg6 = await waitMessage(ws6);
    const close6 = await waitClose(ws6);
    results.push({
      check: "4b. REGISTER expired authToken",
      pass: msg6?.type === "ERROR" && (msg6?.message || "").toLowerCase().includes("invalid") && (close6.code === 4005 || close6.code === 1000),
      detail: `msg=${JSON.stringify(msg6)}, code=${close6.code}`,
    });
  } catch (e) {
    results.push({ check: "4b. REGISTER expired authToken", pass: false, detail: String(e) });
  }

  // 5. Authenticated valid REGISTER (controller)
  try {
    const validToken = createTestToken("test@syncbiz.com");
    const ws7 = await wsConnect();
    ws7.send(JSON.stringify({ type: "REGISTER", role: "controller", authToken: validToken, branchId: "default" }));
    const msg7 = await waitMessage(ws7);
    results.push({
      check: "5. Authenticated valid REGISTER (controller)",
      pass: msg7?.type === "REGISTERED" && msg7?.sessionCode,
      detail: `msg=${JSON.stringify(msg7)}`,
    });
    ws7.close();
  } catch (e) {
    results.push({ check: "5. Authenticated valid REGISTER", pass: false, detail: String(e) });
  }

  // 5b. Device REGISTER - server-derived userId, no client userId
  try {
    const validToken = createTestToken("test@syncbiz.com");
    const deviceId = "verify-device-" + Date.now();
    const ws7b = await wsConnect();
    ws7b.send(JSON.stringify({ type: "REGISTER", role: "device", authToken: validToken, deviceId, isMobile: false, branchId: "default" }));
    const msg7b = await waitMessage(ws7b);
    const msg7b2 = await waitMessage(ws7b);
    results.push({
      check: "5b. Device REGISTER server-derived userId",
      pass: msg7b?.type === "REGISTERED" && msg7b?.deviceId === deviceId && msg7b?.sessionCode && msg7b2?.type === "SET_DEVICE_MODE",
      detail: `reg=${JSON.stringify(msg7b)}, mode=${JSON.stringify(msg7b2)}`,
    });
    ws7b.close();
  } catch (e) {
    results.push({ check: "5b. Device REGISTER", pass: false, detail: String(e) });
  }

  // 6. Branch authorization - branchId other than default
  try {
    const validToken = createTestToken("test@syncbiz.com");
    const ws8 = await wsConnect();
    ws8.send(JSON.stringify({ type: "REGISTER", role: "controller", authToken: validToken, branchId: "other-branch" }));
    const msg8 = await waitMessage(ws8);
    const close8 = await waitClose(ws8);
    results.push({
      check: "6. Branch authorization (reject other branch)",
      pass: msg8?.type === "ERROR" && (msg8?.message || "").includes("Branch") && (close8.code === 4004 || close8.code === 1000),
      detail: `msg=${JSON.stringify(msg8)}, code=${close8.code}`,
    });
  } catch (e) {
    results.push({ check: "6. Branch authorization", pass: false, detail: String(e) });
  }

  // Print results
  console.log("Results:\n");
  results.forEach((r) => {
    console.log(`${r.pass ? "PASS" : "FAIL"}: ${r.check}`);
    console.log(`  ${r.detail}\n`);
  });
  const passed = results.filter((r) => r.pass).length;
  console.log(`=== ${passed}/${results.length} checks passed ===`);
}

run().catch(console.error);
