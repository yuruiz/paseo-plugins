import { z } from "zod";
import { connectIdSchema } from "../shared/onepassword.js";
import type { OnePasswordConnect } from "./connect.js";
import type { SecretsBroker } from "./broker.js";
import { grantNotification, type Grant, type Secret } from "../shared/contracts.js";

const itemSchema = z.object({
  id: connectIdSchema,
  vault: z.object({ id: connectIdSchema }),
  fields: z.array(
    z.object({
      id: z.string().optional(),
      label: z.string().optional(),
      value: z.string().optional(),
    }),
  ),
});

function itemSecrets(item: z.infer<typeof itemSchema>): Secret[] {
  const used = new Set<string>();
  return item.fields
    .filter((field) => field.value)
    .map((field, index) => {
      const label = field.label?.trim() || field.id || `FIELD_${index + 1}`;
      let base = label.toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
      if (!/^[A-Z_]/.test(base)) base = `FIELD_${base}`;
      base = base.slice(0, 120);
      let name = base;
      let suffix = 2;
      while (used.has(name)) name = `${base}_${suffix++}`;
      used.add(name);
      return { name, value: field.value! };
    });
}

export async function sendConnectItem(
  connect: OnePasswordConnect,
  broker: SecretsBroker,
  input: { agentId: string; cwd: string; vaultId: string; itemId: string },
  send: (message: string) => Promise<unknown>,
) {
  const vaultId = connectIdSchema.parse(input.vaultId);
  const itemId = connectIdSchema.parse(input.itemId);
  let grant: Grant | undefined;
  try {
    const result = await connect.request(
      "GET",
      `vaults/${vaultId}/items/${itemId}`,
      undefined,
      new AbortController().signal,
    );
    const item = itemSchema.safeParse(result);
    if (!item.success || item.data.id !== itemId || item.data.vault.id !== vaultId)
      throw new Error("Invalid Connect item.");
    grant = broker.submit({
      agentId: input.agentId,
      cwd: input.cwd,
      secrets: itemSecrets(item.data),
    });
    await send(grantNotification(grant));
  } catch {
    if (grant) broker.revoke(input.agentId, grant.id);
    // Neither upstream responses nor a send error may echo the secret into RPC errors/logs.
    throw new Error("Could not share the secret. Check Connect access and the agent connection.");
  }
  return { shared: true as const, grant };
}
