import { NextResponse } from "next/server";
import { db } from "@/lib/store";

export async function GET() {
  return NextResponse.json(db.getBranches());
}

