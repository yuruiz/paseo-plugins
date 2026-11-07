import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { MAX_CACHED_TABS } from "./tab-cache";

export const panelSettingsSchema = z.object({
  comparison: z.enum(["head", "staged", "unstaged"]).default("head"),
  tree: z.boolean().default(false),
  sidebarWidth: z.number().min(180).max(600).default(240),
  sidebarVisible: z.boolean().default(true),
  mode: z.preprocess(
    (value) => (value === "patch" ? "unified" : value),
    z.enum(["unified", "split"]).default("split"),
  ),
  splitRatio: z.number().min(0.2).max(0.8).default(0.5),
  historyDetailsRatio: z.number().min(0).max(1).default(0.43),
  wrap: z.boolean().default(false),
  context: z.union([z.literal(3), z.literal(20), z.literal(1000000)]).default(3),
  ignoreWhitespace: z.boolean().default(false),
  automatic: z.boolean().default(true),
  refreshInterval: z
    .union([z.literal(2000), z.literal(5000), z.literal(10000), z.literal(30000)])
    .default(2000),
  syntaxHighlight: z.boolean().default(true),
  fontSize: z.number().int().min(10).max(20).default(13),
  fontFamily: z.enum(["paseo", "vscode", "jetbrains", "custom"]).default("paseo"),
  customFontFamily: z
    .string()
    .max(160)
    .regex(/^[\w\s,'".\-\u0080-\uFFFF]*$/u)
    .default(""),
  fontWeight: z.enum(["400", "500", "600"]).default("500"),
  tabSize: z.union([z.literal(2), z.literal(4), z.literal(8)]).default(4),
  lineNumbers: z.boolean().default(true),
  previewDefault: z.boolean().default(false),
  tabCacheSize: z.number().int().min(1).max(MAX_CACHED_TABS).default(5),
  scrollbar: z.enum(["thin", "auto"]).default("thin"),
});
export type PanelSettings = z.infer<typeof panelSettingsSchema>;
export const defaultSettings = panelSettingsSchema.parse({});
export const panelSettings = defineSettings({
  id: "git-panel",
  scope: "host",
  version: 1,
  schema: panelSettingsSchema,
});
