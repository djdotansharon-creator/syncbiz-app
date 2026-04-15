import { NextResponse } from "next/server";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { getDataDir } from "@/lib/data-path";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};

  const dataDir = getDataDir();

  // 1. Verify data directory is writable
  const probe = join(dataDir, ".health-probe");
  try {
    writeFileSync(probe, "ok");
    unlinkSync(probe);
    checks.storage = "ok";
  } catch {
    checks.storage = "fail";
  }

  // 2. Verify critical data files are present (written on first run)
  checks.users_json = existsSync(join(dataDir, "users.json")) ? "ok" : "fail";
  checks.sources_json = existsSync(join(dataDir, "sources.json")) ? "ok" : "fail";
  checks.branches_json = existsSync(join(dataDir, "branches.json")) ? "ok" : "fail";
  checks.devices_json = existsSync(join(dataDir, "devices.json")) ? "ok" : "fail";

  const allOk = Object.values(checks).every((v) => v === "ok");

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      checks,
      dataDir,
      ts: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 },
  );
}
