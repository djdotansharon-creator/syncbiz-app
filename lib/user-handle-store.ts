import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { candidateHandles } from "@/lib/user-handle";

/**
 * A PERSON'S VONO ID (owner 2026-11-22): the user's own "name#1234", assigned the first time it is needed and never changed after (idempotent).
 * It belongs to the ACCOUNT of the person — not to a business. Uniqueness is the database's (`User.handle @unique`): a clash on the number just tries the next candidate.
 * Server only. Returns null when no free ID was found after the retries (the caller shows nothing rather than failing).
 */
export async function getOrAssignUserHandle(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { handle: true, name: true, firstName: true, lastName: true, email: true } });
  if (!user) return null;
  if (user.handle) return user.handle;
  const display = (user.name ?? "").trim() || [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || (user.email ?? "").split("@")[0] || "";
  for (let round = 0; round < 3; round++) {
    for (const candidate of candidateHandles(display, 12)) {
      try {
        // only while the person still has none — two tabs asking at once end with ONE ID
        const r = await prisma.user.updateMany({ where: { id: userId, handle: null }, data: { handle: candidate } });
        if (r.count === 1) return candidate;
        const again = await prisma.user.findUnique({ where: { id: userId }, select: { handle: true } });
        if (again?.handle) return again.handle;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // that exact ID is taken — next candidate
        throw e;
      }
    }
  }
  return null;
}
