import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const nameSchema = z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/);
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const imageSchema = z.object({
  name: nameSchema,
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  data: z
    .string()
    .min(4)
    .max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export type SecretImage = z.infer<typeof imageSchema>;
export const secretSchema = z.object({
  name: nameSchema,
  value: z
    .string()
    .min(1)
    .max(16_384)
    .refine((value) => !value.includes("\0")),
});
export const secretsSchema = z
  .array(secretSchema)
  .min(1)
  .max(32)
  .refine((secrets) => {
    const names = secrets.map((secret) => secret.name);
    return new Set(names).size === names.length;
  });
export const grantSchema = z.object({
  id: z.string(),
  names: z.array(z.string()),
  imageNames: z.array(z.string()).optional(),
  skippedNames: z.array(z.string()).optional(),
  expiresAt: z.number(),
});
export type Secret = z.infer<typeof secretSchema>;
const bundleFields = {
  secrets: z.array(secretSchema).max(32),
  images: z.array(imageSchema).max(4).default([]),
};
function validBundle(bundle: { secrets: Secret[]; images: SecretImage[] }) {
  const names = [...bundle.secrets, ...bundle.images].map((entry) => entry.name);
  const imageBytes = bundle.images.reduce(
    (sum, entry) => sum + (entry.data.length * 3) / 4 - (entry.data.match(/=+$/)?.[0].length ?? 0),
    0,
  );
  return (
    names.length > 0 &&
    names.length <= 32 &&
    new Set(names).size === names.length &&
    imageBytes <= MAX_IMAGE_BYTES
  );
}
export const bundleSchema = z.object(bundleFields).refine(validBundle);
export type SecretBundle = z.infer<typeof bundleSchema>;
export type Grant = z.infer<typeof grantSchema>;
export const requestedFieldSchema = z.object({ name: nameSchema, kind: z.enum(["text", "image"]) });
export type RequestedField = z.infer<typeof requestedFieldSchema>;
export const requestInputSchema = z
  .object({
    agentId: z.string().uuid(),
    purpose: z.string().trim().min(1).max(500),
    fields: z.array(requestedFieldSchema).min(1).max(32),
  })
  .refine(
    ({ fields }) =>
      new Set(fields.map((field) => field.name)).size === fields.length &&
      fields.filter((field) => field.kind === "image").length <= 4,
  );
export type SecretRequestInput = z.infer<typeof requestInputSchema>;
export const requestStateSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string(),
  purpose: z.string(),
  fields: z.array(requestedFieldSchema),
  expiresAt: z.number(),
  status: z.enum(["pending", "fulfilled", "declined", "expired", "skipped"]),
  skipped: z.array(nameSchema).default([]),
  grant: grantSchema.nullable(),
});
export type SecretRequest = z.infer<typeof requestStateSchema>;
export const outputSummarySchema = z.object({
  id: z.string().uuid(),
  agentId: z.string(),
  expiresAt: z.number(),
  status: z.enum(["pending", "released"]),
});
export const getSecretRequest = defineRpc({
  name: "secrets.request.get",
  input: z.object({ agentId: z.string(), id: z.string().uuid() }),
  output: requestStateSchema,
});
export const declineSecretRequest = defineRpc({
  name: "secrets.request.decline",
  input: z.object({ agentId: z.string(), id: z.string().uuid() }),
  output: z.object({ declined: z.boolean() }),
});
export const readSecretOutput = defineRpc({
  name: "secrets.output.read",
  input: z.object({ agentId: z.string(), id: z.string().uuid() }),
  output: z.object({ text: z.string(), status: z.enum(["pending", "released"]) }),
});
export const releaseSecretOutput = defineRpc({
  name: "secrets.output.release",
  input: z.object({
    agentId: z.string(),
    id: z.string().uuid(),
    text: z.string().max(1024 * 1024),
  }),
  output: z.object({ released: z.boolean() }),
});
export const discardSecretOutput = defineRpc({
  name: "secrets.output.discard",
  input: z.object({ agentId: z.string(), id: z.string().uuid() }),
  output: z.object({ discarded: z.boolean() }),
});
export const mcpConnection = defineRpc({
  name: "secrets.mcp.connection",
  input: z.object({}),
  output: z.object({ url: z.string().url() }),
});

export function grantNotification(grant: Grant) {
  const images = grant.imageNames?.length
    ? ` Image fields (${grant.imageNames.join(", ")}) contain temporary file paths; their output requires user review.`
    : "";
  const skipped = grant.skippedNames?.length
    ? ` The user skipped ${grant.skippedNames.join(", ")}; those fields are unavailable.`
    : "";
  return `${grant.names.join(", ")} is ready for one use. Use Secrets MCP's run_with_secrets with grantId "${grant.id}".${images}${skipped}`;
}
export const openSecrets = defineRpc({
  name: "secrets.open",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ opened: z.boolean() }),
});
export const submitSecrets = defineRpc({
  name: "secrets.submit",
  input: z
    .object({
      agentId: z.string().min(1),
      requestId: z.string().uuid().optional(),
      ...bundleFields,
    })
    .refine(validBundle),
  output: grantSchema,
});
export const submitSecretRequest = defineRpc({
  name: "secrets.request.submit",
  input: z
    .object({
      agentId: z.string(),
      requestId: z.string().uuid(),
      ...bundleFields,
      skipped: z.array(nameSchema).max(32).default([]),
    })
    .refine(
      (bundle) =>
        validBundle(bundle) ||
        (bundle.secrets.length === 0 && bundle.images.length === 0 && bundle.skipped.length > 0),
    ),
  output: z.object({ grant: grantSchema.nullable(), skipped: z.array(nameSchema) }),
});
export const listSecrets = defineRpc({
  name: "secrets.list",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({
    grants: z.array(grantSchema),
    outputs: z.array(outputSummarySchema),
    requests: z.array(requestStateSchema),
  }),
});
export const revokeSecrets = defineRpc({
  name: "secrets.revoke",
  input: z.object({ agentId: z.string().min(1), id: z.string() }),
  output: z.object({ revoked: z.boolean() }),
});
