import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { changeSchema, fileDiffSchema } from "./contracts";

const oidSchema = z.string().regex(/^(?:[\da-f]{40}|[\da-f]{64})$/);
export const gitRefSchema = z.object({
  name: z.string(),
  fullName: z.string(),
  kind: z.enum(["branch", "remote", "tag"]),
  oid: oidSchema,
  current: z.boolean(),
});
export type GitRef = z.infer<typeof gitRefSchema>;

export const gitCommitSchema = z.object({
  oid: oidSchema,
  parents: z.array(oidSchema),
  author: z.string(),
  email: z.string(),
  date: z.string(),
  subject: z.string(),
});
export type GitCommit = z.infer<typeof gitCommitSchema>;

const repositoryInput = z.object({
  directory: z.string().min(1),
  repositoryId: z.string().default("."),
});
export const historyRpc = defineRpc({
  name: "git.history",
  input: repositoryInput.extend({
    firstParent: z.boolean().default(false),
    ref: z.string().min(1).max(1024).default("all"),
    offset: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(200).default(100),
    revision: z.string().optional(),
  }),
  output: z.object({
    commits: z.array(gitCommitSchema),
    refs: z.array(gitRefSchema),
    head: oidSchema.nullable(),
    branch: z.string().nullable(),
    revision: z.string(),
    hasMore: z.boolean(),
  }),
});
export type GitHistory = z.infer<typeof historyRpc.output>;
export type HistoryInput = z.infer<typeof historyRpc.input>;

export const commitRpc = defineRpc({
  name: "git.commit",
  input: repositoryInput.extend({ oid: oidSchema }),
  output: gitCommitSchema.extend({
    message: z.string(),
    committer: z.string(),
    committerEmail: z.string(),
    committedDate: z.string(),
    files: z.array(changeSchema),
    diffMessage: z.string().nullable(),
  }),
});
export type CommitDetails = z.infer<typeof commitRpc.output>;
export type CommitInput = z.infer<typeof commitRpc.input>;

export const commitFileDiffRpc = defineRpc({
  name: "git.commit-file-diff",
  input: commitRpc.input.extend({
    path: z.string().min(1),
    context: z.number().int().min(0).max(1000000).default(3),
    ignoreWhitespace: z.boolean().default(false),
  }),
  output: fileDiffSchema,
});
export type CommitDiffInput = z.infer<typeof commitFileDiffRpc.input>;
