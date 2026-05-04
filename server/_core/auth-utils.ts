import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";
import type { Request } from "express";

const JWT_SECRET = process.env.JWT_SECRET ?? "change-me-in-production";
const COOKIE_NAME = "session";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHmac("sha256", salt).update(password).digest("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, storedHash] = stored.split(":");
  if (!salt || !storedHash) return false;
  const hash = createHmac("sha256", salt).update(password).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(storedHash, "hex"));
  } catch {
    return false;
  }
}

export async function createSessionToken(userId: number, name: string | null): Promise<string> {
  return jwt.sign({ userId, name: name ?? "" }, JWT_SECRET, { expiresIn: "30d" });
}

export async function verifySessionToken(token: string): Promise<{ userId: number; name: string } | null> {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number; name: string };
    return { userId: payload.userId, name: payload.name };
  } catch {
    return null;
  }
}

export function getTokenFromRequest(req: Request): string | null {
  const rawCookie = req.headers.cookie;
  if (rawCookie) {
    for (const part of rawCookie.split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key.trim() === COOKIE_NAME) {
        return decodeURIComponent(rest.join("="));
      }
    }
  }
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
