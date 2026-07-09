import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createPrismaClient(): PrismaClient {
  let base = process.env.DATABASE_URL ?? "";

  // Apply safe connection pool limits in ALL environments.
  // Without this, Prisma uses its default pool size (typically 10+ per process),
  // which quickly exhausts free-tier PostgreSQL limits when Next.js runs multiple
  // server workers or when HMR creates extra instances in development.
  //
  // Skip the override only when pgbouncer is already handling pooling,
  // or when the URL already carries explicit connection_limit params.
  if (base.length > 0 && !base.includes("pgbouncer") && !base.includes("connection_limit")) {
    base = base
      .replace(/[&?]pool_timeout=\d+/gi, "");   // strip stale pool_timeout so ours wins
    const sep = base.includes("?") ? "&" : "?";
    // Production: 3 connections per instance. Development: 5 (HMR spins multiple clients).
    const limit = process.env.NODE_ENV === "production" ? 3 : 5;
    base = `${base}${sep}connection_limit=${limit}&pool_timeout=20&connect_timeout=10`;
  }

  return new PrismaClient(base ? { datasourceUrl: base } : undefined);
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// In development, persist the client on globalThis so HMR module reloads reuse it
// rather than creating a fresh client (and fresh connection pool) on every hot swap.
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
