import { createHmac, timingSafeEqual } from "node:crypto";

export function secretsMatch(received: string | null, expected: string): boolean {
  if (!received) return false;
  const receivedBuffer = Buffer.from(received, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function verifyHmacSha256(payload: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  return secretsMatch(signature, expected);
}
