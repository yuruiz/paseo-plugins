import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const agentId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const serverSchema = z.object({
  id: z.string(),
  revision: z.string(),
  name: z.string(),
  source: z.string(),
  scope: z.enum(["user", "project", "session"]),
  transport: z.enum(["stdio", "http", "sse", "unsupported"]),
  endpoint: z.string(),
  disabled: z.boolean(),
  issue: z.string().optional(),
  enabledTools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()),
});
export type ServerEntry = z.infer<typeof serverSchema>;

export const listServers = defineRpc({
  name: "mcp.list",
  input: z.object({ agentId }),
  output: z.object({
    provider: z.string(),
    servers: z.array(serverSchema),
    warnings: z.array(z.string()),
  }),
});

export const interfaceSchema = z.object({
  kind: z.enum(["tool", "resource", "template", "prompt"]),
  name: z.string(),
  description: z.string(),
  configuredDisabled: z.boolean(),
  details: z.record(z.string(), z.unknown()),
});
export type InterfaceEntry = z.infer<typeof interfaceSchema>;
export const inspectServer = defineRpc({
  name: "mcp.inspect",
  input: z.object({ agentId, serverId: z.string(), revision: z.string() }),
  output: z.object({
    status: z.enum(["connected", "error", "auth-required"]),
    message: z.string(),
    checkedAt: z.string(),
    serverName: z.string().optional(),
    serverVersion: z.string().optional(),
    instructions: z.string().optional(),
    capabilities: z.record(z.string(), z.unknown()),
    entries: z.array(interfaceSchema),
    warnings: z.array(z.string()),
  }),
});
export type Inspection = z.infer<typeof inspectServer.output>;
