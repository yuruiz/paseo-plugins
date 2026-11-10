import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const SyncConfig = z.object({
  repository: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/)
    .refine((value) => ![".", ".."].includes(value.split("/")[1])),
  branch: z.string().trim().max(200).default(""),
});

export const syncPreferences = defineSettings({
  id: "github-sync",
  scope: "host",
  version: 1,
  schema: z.object({
    repository: z.string().default(""),
    branch: z.string().default(""),
  }),
});

export const SyncRow = z.object({
  name: z.string(),
  status: z.enum(["equal", "local-only", "remote-only", "different", "blocked"]),
  localPath: z.string(),
  localHash: z.string().nullable(),
  remoteHash: z.string().nullable(),
  changes: z.array(
    z.object({ path: z.string(), kind: z.enum(["local-only", "remote-only", "modified"]) }),
  ),
  error: z.string().nullable(),
});

export const compareSkills = defineRpc({
  name: "skills.sync.compare",
  input: SyncConfig.extend({ agentId: z.string() }),
  output: z.object({
    token: z.string(),
    repository: z.string(),
    branch: z.string(),
    commit: z.string(),
    destination: z.string(),
    rows: z.array(SyncRow),
  }),
});

export const SyncResult = z.object({
  completed: z.array(z.string()),
  backups: z.array(z.string()),
  error: z.string().nullable(),
});

export const syncSkills = defineRpc({
  name: "skills.sync.apply",
  input: z.object({
    agentId: z.string(),
    token: z.string(),
    names: z.array(z.string()).min(1).max(50),
    direction: z.enum(["upload", "download"]),
    overwrite: z.boolean().default(false),
  }),
  output: z.object({ jobId: z.string() }),
});

export const syncStatus = defineRpc({
  name: "skills.sync.status",
  input: z.object({ agentId: z.string() }),
  output: z
    .object({
      jobId: z.string(),
      direction: z.enum(["upload", "download"]),
      state: z.enum(["running", "finished"]),
      result: SyncResult.nullable(),
    })
    .nullable(),
});
