/**
 * RETIRED — Control Room Gate 3B-4a (2026-10-06): legacy play-now (dead: always 404 on Postgres, no caller).
 * This unauthenticated route is not part of the pilot playback path. Every method returns 410 Gone and does
 * nothing else: no process execution, no agent-queue / player-state mutation, no log write, and no echo of
 * request data. It intentionally imports nothing that can execute, log or mutate.
 */
import { NextResponse } from "next/server";

function gone(): NextResponse {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}

export async function POST(): Promise<NextResponse> {
  return gone();
}
