import { z } from "zod";

export const agentConfigSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("custom"),
      provider: z.string().trim().min(1),
      mode: z.string().trim().default(""),
      thinking: z.string().trim().default(""),
    })
    .strict(),
  z.object({ source: z.literal("profile"), profileId: z.string().trim().min(1) }).strict(),
]);
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export const agentConfigSourceSchema = z.enum(["custom", "default", "profile"]);

export function agentConfigLabel(job: {
  agentConfigSource: z.infer<typeof agentConfigSourceSchema>;
  profileId: string;
  provider: string;
}): string {
  if (job.agentConfigSource === "default") return "Shared agent configuration";
  if (job.agentConfigSource === "profile") return `Paseo profile: ${job.profileId}`;
  return job.provider;
}
