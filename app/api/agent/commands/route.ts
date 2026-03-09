import { NextResponse } from "next/server";
import { consumeNextCommand } from "@/lib/agent-commands";

/**
 * Local agent polls this endpoint (e.g. every 10s).
 * Returns the next pending command and removes it from the queue.
 * No auth for MVP.
 */
export async function GET() {
  const command = consumeNextCommand();
  return NextResponse.json({ command });
}
