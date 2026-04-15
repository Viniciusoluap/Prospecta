import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import type { Request } from "express";

const JWT_SECRET = process.env.JWT_SECRET ?? "change-me-in-production";
const SECRET_BYTES = new TextEncoder().encode(JWT_SECRET);
const TOKEN_TTL = "30d";
const COOKIE_NAME = "session";

// ──────────────────────────────────────────
// Password hashing (HMAC-SHA256 + random salt)
// ──────────────────────────────────────────

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

// ──────────────────────────────────────────
// JWT session tokens
// ──────────────────────────────────────────

export async function createSessionToken(userId: number, name: string | null): Promise<string> {
  return new SignJWT({ sub: String(userId), name: name ?? "" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(SECRET_BYTES);
}

export async function verifySessionToken(token: string): Promise<{ userId: number; name: string } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET_BYTES);
    const userId = parseInt(String(payload.sub), 10);
    if (isNaN(userId)) return null;
    return { userId, name: String(payload.name ?? "") };
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────
// Extract token from request
// ──────────────────────────────────────────

export function getTokenFromRequest(req: Request): string | null {
  // 1. Cookie (preferred for browser)
  const rawCookie = req.headers.cookie;
  if (rawCookie) {
    for (const part of rawCookie.split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key.trim() === COOKIE_NAME) {
        return decodeURIComponent(rest.join("="));
      }
    }
  }
  // 2. Authorization: Bearer <token>
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
