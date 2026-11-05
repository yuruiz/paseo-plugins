import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const rewindMode = z.enum(["conversation", "files", "both"]);
export type RewindMode = z.infer<typeof rewindMode>;

export const rewindRpc = defineRpc({
  name: "agent.rewind",
  input: z.object({
    hostId: z.string().min(1),
    agentId: z.string().min(1),
    messageId: z.string().min(1),
    mode: rewindMode,
  }),
  output: z.object({}),
});

export function rewindOptions(capabilities: {
  supportsRewindConversation?: boolean;
  supportsRewindFiles?: boolean;
  supportsRewindBoth?: boolean;
} | null | undefined): { mode: RewindMode; label: string }[] {
  return [
    { mode: "conversation" as const, label: "Rewind conversation", supported: capabilities?.supportsRewindConversation },
    { mode: "files" as const, label: "Rewind files", supported: capabilities?.supportsRewindFiles },
    { mode: "both" as const, label: "Rewind conversation and files", supported: capabilities?.supportsRewindBoth },
  ].filter((option) => option.supported);
}
