export class SecretsError extends Error {
  constructor(public readonly code: "unavailable" | "capacity" | "invalid" | "closed") {
    const messages = {
      unavailable: "Grant unavailable. It may have expired, been revoked, or already been used.",
      capacity:
        "Private storage or execution capacity is full. Revoke unused grants, discard held output, or wait for running commands.",
      invalid: "Invalid secret fields.",
      closed: "Secrets plugin is stopped.",
    };
    super(messages[code]);
  }
}
