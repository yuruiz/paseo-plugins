import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const preferencesSchema = z.object({
  enabled: z.boolean().default(false),
  timezone: z.string().default("Asia/Shanghai"),
  bufferSeconds: z.number().int().min(15).max(600).default(60),
  maxAttempts: z.number().int().min(1).max(10).default(3),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const jobSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  workspaceId: z.string().nullable(),
  provider: z.string(),
  status: z.enum(["detected", "waiting", "sending", "resumed", "canceled", "attention"]),
  detectedAt: z.string(),
  resetAt: z.string().nullable(),
  runAt: z.string().nullable(),
  reason: z.string(),
  note: z.string(),
  attempts: z.number().int().nonnegative(),
  authorized: z.boolean(),
  lastUserMessageAt: z.string().nullable(),
  transcriptHash: z.string().nullable(),
  failureKey: z.string(),
});
export type Job = z.infer<typeof jobSchema>;
export const stateSchema = z.object({
  version: z.literal(1),
  preferences: z.record(z.string(), preferencesSchema),
  jobs: z.record(z.string(), jobSchema),
});
export type State = z.infer<typeof stateSchema>;
export const viewSchema = z.object({
  preferences: preferencesSchema,
  job: jobSchema.nullable(),
});
export type ResumeView = z.infer<typeof viewSchema>;
const agentInput = z.object({ agentId: z.string().min(1) });
export const statusRpc = defineRpc({
  name: "resume.status",
  input: agentInput,
  output: viewSchema,
});
export const configureRpc = defineRpc({
  name: "resume.configure",
  input: agentInput.extend({ preferences: preferencesSchema }),
  output: viewSchema,
});
export const scheduleRpc = defineRpc({
  name: "resume.schedule",
  input: agentInput.extend({ jobId: z.string(), resetAt: z.string().optional() }),
  output: viewSchema,
});
export const cancelRpc = defineRpc({
  name: "resume.cancel",
  input: agentInput.extend({ jobId: z.string() }),
  output: viewSchema,
});
export const cardSchema = z.object({ jobId: z.string() });
export const CONTINUE_PROMPT =
  "The quota wait has ended. Continue the unfinished task in this conversation, checking existing progress first to avoid repeating completed actions. If the task is already complete, report the result and stop. Use the language already used in this conversation.";
export function defaults(): Preferences {
  return preferencesSchema.parse({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  });
}
