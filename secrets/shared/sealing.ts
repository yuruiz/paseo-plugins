import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { base64 } from "@scure/base";
import { z } from "zod";

export const MAX_SEALED_PLAINTEXT = 6 * 1024 * 1024 - 4096;
export const envelopeSchema = z
  .object({
    publicKey: z.string().length(44),
    nonce: z.string().length(16),
    ciphertext: z.string().max(Math.ceil((MAX_SEALED_PLAINTEXT + 16) / 3) * 4),
  })
  .strict();
export const ticketSchema = z.object({
  id: z.string().uuid(),
  publicKey: z.string().length(44),
  scope: z.string(),
  expiresAt: z.number(),
});
export type Envelope = z.infer<typeof envelopeSchema>;
export type SealingTicket = z.infer<typeof ticketSchema>;
const utf8 = new TextEncoder();
const info = utf8.encode("paseo-secrets/sealed-input/v1");

function binding(ticket: SealingTicket) {
  return utf8.encode(JSON.stringify([ticket.id, ticket.publicKey, ticket.scope, ticket.expiresAt]));
}

function keyFor(secret: Uint8Array, peer: Uint8Array, ticket: SealingTicket) {
  const shared = x25519.getSharedSecret(secret, peer);
  try {
    return hkdf(sha256, shared, binding(ticket), info, 32);
  } finally {
    shared.fill(0);
  }
}

export function newSealingKey() {
  const secret = randomBytes(32);
  try {
    return { secret, publicKey: base64.encode(x25519.getPublicKey(secret)) };
  } catch {
    secret.fill(0);
    throw new Error("Secure input is unavailable on this device.");
  }
}

export function sealBytes(ticket: SealingTicket, plaintext: Uint8Array): Envelope {
  let secret: Uint8Array | undefined;
  let key: Uint8Array | undefined;
  try {
    if (plaintext.length > MAX_SEALED_PLAINTEXT) throw new Error();
    const pair = newSealingKey();
    secret = pair.secret;
    key = keyFor(secret, base64.decode(ticket.publicKey), ticket);
    const nonce = randomBytes(12);
    return {
      publicKey: pair.publicKey,
      nonce: base64.encode(nonce),
      ciphertext: base64.encode(chacha20poly1305(key, nonce, binding(ticket)).encrypt(plaintext)),
    };
  } catch {
    throw new Error("Could not encrypt private input. Nothing was submitted.");
  } finally {
    secret?.fill(0);
    key?.fill(0);
  }
}

export function sealValue(ticket: SealingTicket, value: unknown) {
  const bytes = utf8.encode(JSON.stringify(value));
  try {
    return sealBytes(ticket, bytes);
  } finally {
    bytes.fill(0);
  }
}

export function openEnvelope(ticket: SealingTicket, secret: Uint8Array, envelope: Envelope) {
  let key: Uint8Array | undefined;
  try {
    const parsed = envelopeSchema.parse(envelope);
    key = keyFor(secret, base64.decode(parsed.publicKey), ticket);
    return chacha20poly1305(key, base64.decode(parsed.nonce), binding(ticket)).decrypt(
      base64.decode(parsed.ciphertext),
    );
  } catch {
    throw new Error("Private submission could not be opened.");
  } finally {
    key?.fill(0);
  }
}
