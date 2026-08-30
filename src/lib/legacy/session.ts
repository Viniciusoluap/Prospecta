import type { Session } from "next-auth";
import { getUserByEmail, getUserById, upsertUser } from "./repository";

export async function resolveLegacyUser(session: Session) {
  if (session.user.legacyUserId) {
    return getUserById(session.user.legacyUserId);
  }

  const email = session.user.email?.trim().toLowerCase();
  if (!email) return null;

  const existing = await getUserByEmail(email);
  if (existing) return existing;

  await upsertUser({
    openId: `ops:${session.user.id}`,
    email,
    name: session.user.name ?? email,
    role: session.user.role === "admin" ? "admin" : "user",
    loginMethod: "next-auth",
  });
  return getUserByEmail(email);
}
