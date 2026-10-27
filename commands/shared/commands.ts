import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const CommandSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  argumentHint: z.string(),
  scope: z.enum(["project", "global", "session"]),
  path: z.string().nullable(),
  mode: z.enum(["native", "template"]),
  shadowedBy: z.string().nullable(),
});
export type Command = z.infer<typeof CommandSchema>;

export const listCommands = defineRpc({
  name: "commands.list",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({
    cwd: z.string(),
    provider: z.string(),
    commands: z.array(CommandSchema),
    directories: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
});

export const readCommand = defineRpc({
  name: "commands.read",
  input: z.object({ agentId: z.string().min(1), commandId: z.string().min(1) }),
  output: z.object({ body: z.string() }),
});

export const invokeCommand = defineRpc({
  name: "commands.invoke",
  input: z.object({
    agentId: z.string().min(1),
    commandId: z.string().min(1),
    args: z.string().max(32_768),
    mode: CommandSchema.shape.mode,
  }),
  output: z.object({ message: z.string() }),
});
