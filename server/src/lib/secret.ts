import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET || "change-me";
  return createHash("sha256").update(secret).digest();
}

/** AES-256-GCM; blob is base64(iv || tag || ciphertext). AAD binds ciphertext to a row. */
export function encryptSecret(plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(blob: string, aad: string): string {
  const buf = Buffer.from(blob, "base64");
  if (buf.length < 29) {
    throw new Error("Invalid ciphertext");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
}

export function keyHint(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 4) return "••••";
  return `…${trimmed.slice(-4)}`;
}
