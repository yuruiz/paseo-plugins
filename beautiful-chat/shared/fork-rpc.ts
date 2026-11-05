import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const forkRpc = defineRpc({
  name: "agent.fork",
  input: z.object({
    hostId: z.string().min(1),
    agentId: z.string().min(1),
    messageId: z.string().min(1),
    requestId: z.string().uuid(),
  }),
  output: z.object({ agentId: z.string(), workspaceId: z.string() }),
});
