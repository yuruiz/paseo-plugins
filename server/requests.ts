import { randomUUID } from "node:crypto";
import type {
  Grant,
  SecretBundle,
  SecretRequest,
  SecretRequestInput,
} from "../shared/contracts.js";
import { SecretsError } from "./errors.js";

export class SecretRequests {
  private readonly entries = new Map<string, SecretRequest>();
  constructor(private readonly now: () => number = Date.now) {}

  create(input: SecretRequestInput): SecretRequest {
    this.prune();
    if (this.entries.size >= 64) throw new SecretsError("capacity");
    const request: SecretRequest = {
      ...input,
      id: randomUUID(),
      expiresAt: this.now() + 600_000,
      status: "pending",
      grant: null,
      skipped: [],
    };
    this.entries.set(request.id, request);
    return request;
  }

  get(agentId: string, id: string) {
    const request = this.entries.get(id);
    if (!request || request.agentId !== agentId) throw new SecretsError("unavailable");
    if (request.status === "pending" && request.expiresAt <= this.now()) request.status = "expired";
    return request;
  }

  fulfill(agentId: string, id: string, bundle: SecretBundle, create: () => Grant) {
    const result = this.submit(agentId, id, bundle, [], create);
    if (!result.grant) throw new SecretsError("invalid");
    return result.grant;
  }

  submit(
    agentId: string,
    id: string,
    bundle: SecretBundle,
    skipped: string[],
    create: () => Grant,
  ) {
    const request = this.get(agentId, id);
    if (request.status !== "pending") throw new SecretsError("unavailable");
    const supplied = new Map([
      ...bundle.secrets.map((secret) => [secret.name, "text"] as const),
      ...bundle.images.map((image) => [image.name, "image"] as const),
    ]);
    const omitted = new Set(skipped);
    if (
      supplied.size !== bundle.secrets.length + bundle.images.length ||
      omitted.size !== skipped.length ||
      supplied.size + omitted.size !== request.fields.length ||
      request.fields.some((field) =>
        omitted.has(field.name)
          ? supplied.has(field.name)
          : supplied.get(field.name) !== field.kind,
      )
    )
      throw new SecretsError("invalid");
    const grant = supplied.size > 0 ? create() : null;
    const result = grant && skipped.length ? { ...grant, skippedNames: [...skipped] } : grant;
    request.status = result ? "fulfilled" : "skipped";
    request.grant = result;
    request.skipped = [...skipped];
    return { grant: result, skipped: [...skipped] };
  }

  decline(agentId: string, id: string) {
    const request = this.get(agentId, id);
    if (request.status !== "pending") return false;
    request.status = "declined";
    return true;
  }

  list(agentId: string) {
    this.prune();
    return [...this.entries.values()]
      .filter((entry) => entry.agentId === agentId)
      .map((entry) => this.get(agentId, entry.id));
  }

  removeAgent(agentId: string) {
    for (const entry of this.entries.values())
      if (entry.agentId === agentId) this.entries.delete(entry.id);
  }

  close() {
    this.entries.clear();
  }

  prune() {
    for (const entry of this.entries.values())
      if (entry.expiresAt + 600_000 <= this.now()) this.entries.delete(entry.id);
  }
}
