import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const settingsSchema = z.object({
  daemonHome: z.string().default(""),
  stateDirectory: z.string().default(""),
  cliPath: z.string().min(1).default("paseo"),
  enabled: z.boolean().default(false),
});
export type Settings = z.infer<typeof settingsSchema>;
export const schedulerSettings = defineSettings({
  id: "scheduler",
  scope: "host",
  version: 1,
  schema: settingsSchema,
});
