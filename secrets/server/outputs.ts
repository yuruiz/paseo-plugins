import { randomUUID } from "node:crypto";
import { SecretsError } from "./errors.js";

interface HeldOutput {
  id: string;
  agentId: string;
  text: string;
  releasedText: string | null;
  expiresAt: number;
}

export class SecretOutputs {
  private readonly entries = new Map<string, HeldOutput>();
  constructor(private readonly now: () => number = Date.now) {}

  assertCapacity(reserved = 0) {
    this.prune();
    if (this.entries.size + reserved >= 16) throw new SecretsError("capacity");
  }

  hold(agentId: string, text: string) {
    this.assertCapacity();
    const entry: HeldOutput = {
      id: randomUUID(),
      agentId,
      text,
      releasedText: null,
      expiresAt: this.now() + 600_000,
    };
    this.entries.set(entry.id, entry);
    return entry.id;
  }

  agentId(id: string) {
    return this.get(id).agentId;
  }

  preview(agentId: string, id: string) {
    const entry = this.get(id);
    if (entry.agentId !== agentId) throw new SecretsError("unavailable");
    return entry.text;
  }

  review(agentId: string, id: string) {
    const text = this.preview(agentId, id);
    return {
      text,
      status: this.get(id).releasedText === null ? ("pending" as const) : ("released" as const),
    };
  }

  release(agentId: string, id: string, text: string) {
    const entry = this.get(id);
    if (entry.agentId !== agentId) throw new SecretsError("unavailable");
    if (entry.releasedText !== null) throw new SecretsError("unavailable");
    entry.releasedText = text;
    entry.text = "";
  }

  read(id: string) {
    const entry = this.get(id);
    if (entry.releasedText === null) return { status: "awaiting_review" as const };
    return { status: "released" as const, text: entry.releasedText };
  }

  discard(agentId: string, id: string) {
    const entry = this.get(id);
    if (entry.agentId !== agentId) throw new SecretsError("unavailable");
    return this.entries.delete(id);
  }

  list(agentId: string) {
    this.prune();
    return [...this.entries.values()]
      .filter((entry) => entry.agentId === agentId)
      .map((entry) => ({
        id: entry.id,
        agentId,
        expiresAt: entry.expiresAt,
        status: entry.releasedText === null ? ("pending" as const) : ("released" as const),
      }));
  }

  removeAgent(agentId: string) {
    for (const entry of this.entries.values())
      if (entry.agentId === agentId) this.entries.delete(entry.id);
  }
  close() {
    this.entries.clear();
  }
  private get(id: string) {
    this.prune();
    const entry = this.entries.get(id);
    if (!entry) throw new SecretsError("unavailable");
    return entry;
  }
  prune() {
    for (const entry of this.entries.values())
      if (entry.expiresAt <= this.now()) this.entries.delete(entry.id);
  }
}
