import { createHash, randomUUID } from "node:crypto";
import {
  newSealingKey,
  openEnvelope,
  type Envelope,
  type SealingTicket,
} from "../shared/sealing.js";
import { SecretsError } from "./errors.js";

interface Submission<T> {
  ticket: SealingTicket;
  secret: Uint8Array;
  attempts: number;
  receipt?: { digest: string; result: T };
}

export class SealedSubmissions<T> {
  private readonly entries = new Map<string, Submission<T>>();
  private closed = false;
  constructor(private readonly now: () => number = Date.now) {}

  begin(scope: string) {
    if (this.closed) throw new SecretsError("closed");
    this.prune();
    if (this.entries.size >= 64) throw new SecretsError("capacity");
    const { secret, publicKey } = newSealingKey();
    const ticket = { id: randomUUID(), publicKey, scope, expiresAt: this.now() + 600_000 };
    this.entries.set(ticket.id, { ticket, secret, attempts: 0 });
    return ticket;
  }

  complete(
    id: string,
    scope: string,
    envelope: Envelope,
    consume: (plaintext: Uint8Array) => T,
  ): T {
    if (this.closed) throw new SecretsError("closed");
    this.prune();
    const entry = this.entries.get(id);
    if (!entry || entry.ticket.scope !== scope) throw new SecretsError("unavailable");
    const digest = createHash("sha256").update(JSON.stringify(envelope)).digest("hex");
    if (entry.receipt) {
      if (entry.receipt.digest !== digest) throw new SecretsError("unavailable");
      return entry.receipt.result;
    }
    let plaintext: Uint8Array | undefined;
    try {
      plaintext = openEnvelope(entry.ticket, entry.secret, envelope);
      const result = consume(plaintext);
      entry.receipt = { digest, result };
      entry.secret.fill(0);
      return result;
    } catch {
      if (++entry.attempts >= 3) this.remove(id);
      throw new SecretsError("invalid");
    } finally {
      plaintext?.fill(0);
    }
  }

  remove(id: string) {
    this.entries.get(id)?.secret.fill(0);
    this.entries.delete(id);
  }

  prune() {
    for (const [id, entry] of this.entries)
      if (entry.ticket.expiresAt <= this.now()) this.remove(id);
  }

  close() {
    this.closed = true;
    for (const id of this.entries.keys()) this.remove(id);
  }
}
