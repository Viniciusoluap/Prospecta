import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { ENV } from "./env";

function encryptionKey(): Buffer {
  if (!ENV.cookieSecret)
    throw new Error(
      "JWT_SECRET é necessário para proteger configurações de pagamento"
    );
  return createHash("sha256").update(ENV.cookieSecret).digest();
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map(part => part.toString("base64url"))
    .join(".");
}

export function decryptSecret(value: string): string {
  const [iv, tag, encrypted] = value
    .split(".")
    .map(part => Buffer.from(part, "base64url"));
  if (!iv || !tag || !encrypted)
    throw new Error("Segredo criptografado inválido");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8"
  );
}
