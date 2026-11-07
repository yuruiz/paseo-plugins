import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const comparisonSchema = z.enum(["head", "staged", "unstaged"]);
export type Comparison = z.infer<typeof comparisonSchema>;

export const changeSchema = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  status: z.enum([
    "added",
    "modified",
    "deleted",
    "renamed",
    "copied",
    "conflicted",
    "typechanged",
    "untracked",
  ]),
  additions: z.number().nullable(),
  deletions: z.number().nullable(),
  binary: z.boolean(),
  staged: z.boolean(),
  unstaged: z.boolean(),
  version: z.string(),
});
export type FileChange = z.infer<typeof changeSchema>;

export const repositorySchema = z.object({
  id: z.string(),
  directory: z.string(),
  relativePath: z.string(),
  parentId: z.string().nullable(),
  head: z.string().nullable(),
  branch: z.string().nullable().default(null),
  recordedHead: z.string().nullable(),
  indexedHead: z.string().nullable(),
  state: z.enum(["ready", "uninitialized", "error"]),
  error: z.string().nullable(),
  files: z.array(changeSchema),
});
export type RepositorySnapshot = z.infer<typeof repositorySchema>;

export const snapshotSchema = z.object({
  directory: z.string(),
  comparison: comparisonSchema,
  repositories: z.array(repositorySchema),
  version: z.string(),
  scannedAt: z.string(),
});
export type ChangesSnapshot = z.infer<typeof snapshotSchema>;

export const changesRpc = defineRpc({
  name: "git.changes",
  input: z.object({
    directory: z.string().min(1),
    comparison: comparisonSchema.default("head"),
    force: z.boolean().default(false),
  }),
  output: snapshotSchema,
});

export const diffLineSchema = z.object({
  kind: z.enum(["context", "added", "removed", "meta"]),
  content: z.string(),
  oldLine: z.number().nullable(),
  newLine: z.number().nullable(),
});
export type DiffLine = z.infer<typeof diffLineSchema>;
export const hunkSchema = z.object({
  header: z.string(),
  oldStart: z.number(),
  oldLines: z.number(),
  newStart: z.number(),
  newLines: z.number(),
  lines: z.array(diffLineSchema),
});
export type DiffHunk = z.infer<typeof hunkSchema>;
export const fileDiffSchema = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  state: z.enum(["text", "binary", "too_large", "empty"]),
  patch: z.string(),
  hunks: z.array(hunkSchema),
  message: z.string().nullable(),
});
export type FileDiff = z.infer<typeof fileDiffSchema>;
export const fileDiffRpc = defineRpc({
  name: "git.file-diff",
  input: z.object({
    directory: z.string().min(1),
    repositoryId: z.string(),
    path: z.string().min(1),
    comparison: comparisonSchema.default("head"),
    context: z.number().int().min(0).max(1000000).default(3),
    ignoreWhitespace: z.boolean().default(false),
  }),
  output: fileDiffSchema,
});

export const fileContentRpc = defineRpc({
  name: "git.file-content",
  input: z.object({
    directory: z.string().min(1),
    repositoryId: z.string(),
    path: z.string().min(1),
    comparison: comparisonSchema.default("head"),
    scope: z.enum(["changes", "workspace"]).default("changes"),
  }),
  output: z.object({
    path: z.string(),
    state: z.enum(["text", "image", "binary", "too_large", "missing", "unsupported"]),
    content: z.string(),
    source: z.enum(["index", "working"]),
    message: z.string().nullable(),
  }),
});
export type FileContent = z.infer<typeof fileContentRpc.output>;
export const resolveLinkRpc = defineRpc({
  name: "git.resolve-preview-link",
  input: z.object({
    directory: z.string().min(1),
    repositoryId: z.string(),
    path: z.string().min(1),
    href: z.string().min(1).max(8192),
  }),
  output: z.object({
    repositoryId: z.string(),
    path: z.string(),
    kind: z.enum(["file", "directory"]),
    version: z.string(),
    fragment: z.string(),
  }),
});
export const fileCapabilitiesRpc = defineRpc({
  name: "git.file-capabilities",
  input: z.object({}),
  output: z.object({ reveal: z.boolean(), label: z.string(), platform: z.string() }),
});
export const revealFileRpc = defineRpc({
  name: "git.reveal-file",
  input: fileContentRpc.input,
  output: z.object({ revealed: z.boolean(), directory: z.boolean() }),
});

// Compressed offline renderer, requested only when a Markdown preview contains diagrams.
export const mermaidRuntimeRpc = defineRpc({
  name: "git.mermaid-runtime",
  input: z.object({}),
  output: z.object({ version: z.string(), gzip: z.string() }),
});
