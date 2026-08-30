import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyLegacyPassword(password: string, stored: string): boolean {
  const [salt, storedHash] = stored.split(":");
  if (!salt || !storedHash) return false;

  const candidate = createHmac("sha256", salt).update(password).digest();
  const expected = Buffer.from(storedHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
