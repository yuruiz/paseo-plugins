import { z } from "zod";
import { nameSchema } from "../shared/contracts.js";
import { connectIdSchema } from "../shared/onepassword.js";
import type { SecretsBroker } from "./broker.js";
import type { OnePasswordConnect } from "./connect.js";
import { SecretsError } from "./errors.js";

export const executionSchema = {
  grantId: z
    .string()
    .uuid()
    .optional()
    .describe("Existing private-input grant. Omit when using Connect references."),
  connect: z
    .array(
      z
        .object({
          vaultId: connectIdSchema,
          itemId: connectIdSchema,
          fieldId: z.string().min(1).max(256),
          name: nameSchema,
        })
        .strict(),
    )
    .min(1)
    .max(32)
    .optional()
    .describe(
      "Connect fields injected as named environment variables. Uses existing Connect access; no Share or plaintext permission required.",
    ),
  executable: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !value.includes("\0")),
  args: z
    .array(
      z
        .string()
        .max(16_384)
        .refine((value) => !value.includes("\0")),
    )
    .max(256)
    .default([]),
};

export const executionDescription =
  "Execute with Connect field references directly (connect: [{vaultId, itemId, fieldId, name}]), or an existing private-input grantId. For Connect, use onepassword_list_vaults, onepassword_list_items and onepassword_list_fields to discover IDs; no Share, grantId or plaintext access is required. Values are injected into the child environment and masked in output. Never print, encode or persist credentials. Supply executable and argv; use sh -c for shell syntax. Maximum 120 seconds and 1 MiB output. Grant image/file output requires user review. Never retry execution automatically.";

export async function executeWithSecrets(
  broker: SecretsBroker,
  connect: OnePasswordConnect,
  input: z.output<z.ZodObject<typeof executionSchema>>,
  context: { agentId?: string; cwd: string; signal: AbortSignal },
) {
  if (Boolean(input.grantId) === Boolean(input.connect)) throw new SecretsError("invalid");
  const execute = (id: string, agentId?: string) =>
    broker.execute({
      id,
      agentId,
      executable: input.executable,
      args: input.args,
      signal: context.signal,
    });
  if (input.grantId) return execute(input.grantId, context.agentId);
  const refs = input.connect!;
  if (new Set(refs.map((ref) => ref.name)).size !== refs.length) throw new SecretsError("invalid");
  const items = new Map<string, Awaited<ReturnType<OnePasswordConnect["readItem"]>>>();
  const secrets = [];
  for (const ref of refs) {
    const key = `${ref.vaultId}/${ref.itemId}`;
    let item = items.get(key);
    if (!item) {
      item = await connect.readItem(ref.vaultId, ref.itemId, context.signal);
      items.set(key, item);
    }
    const matches = item.fields.filter((field) => field.id === ref.fieldId);
    if (matches.length !== 1 || !matches[0].value) throw new SecretsError("invalid");
    secrets.push({ name: ref.name, value: matches[0].value });
  }
  if (context.signal.aborted) throw new SecretsError("unavailable");
  const agentId = context.agentId ?? "loopback";
  const grant = broker.submit({ agentId, cwd: context.cwd, secrets });
  try {
    return await execute(grant.id, agentId);
  } finally {
    broker.revoke(agentId, grant.id);
  }
}
