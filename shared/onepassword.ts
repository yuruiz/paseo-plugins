import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const connectConfigurationSchema = z.object({
  url: z
    .string()
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }),
  token: z
    .string()
    .min(1)
    .max(16_384)
    .refine((value) => !/[\r\n]/.test(value)),
});
export const configureConnect = defineRpc({
  name: "secrets.connect.configure",
  input: connectConfigurationSchema,
  output: z.object({ configured: z.literal(true) }),
});
export const setConnectEnabled = defineRpc({
  name: "secrets.connect.enabled",
  input: z.object({ enabled: z.boolean() }),
  output: z.object({ enabled: z.boolean() }),
});
export const deleteConnect = defineRpc({
  name: "secrets.connect.delete",
  input: z.object({}),
  output: z.object({ configured: z.literal(false) }),
});
export const testConnect = defineRpc({
  name: "secrets.connect.test",
  input: z.object({}),
  output: z.object({ vaultCount: z.number().int().nonnegative() }),
});
export const connectStatus = defineRpc({
  name: "secrets.connect.status",
  input: z.object({}),
  output: z.object({
    configured: z.boolean(),
    enabled: z.boolean(),
    url: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const connectIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const connectVaultSchema = z.object({ id: connectIdSchema, name: z.string() });
export const connectItemSummarySchema = z.object({
  id: connectIdSchema,
  title: z.string(),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  updatedAt: z.string().datetime({ offset: true }).nullable().default(null),
});
export type ConnectVault = z.infer<typeof connectVaultSchema>;
export type ConnectItemSummary = z.infer<typeof connectItemSummarySchema>;
export const listConnectVaults = defineRpc({
  name: "secrets.connect.vaults.list",
  input: z.object({}),
  output: z.object({ vaults: z.array(connectVaultSchema) }),
});
export const listConnectItems = defineRpc({
  name: "secrets.connect.items.list",
  input: z.object({ vaultId: connectIdSchema }),
  output: z.object({ items: z.array(connectItemSummarySchema) }),
});
