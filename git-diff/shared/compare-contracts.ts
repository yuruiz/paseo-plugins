import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { changeSchema, fileDiffSchema } from "./contracts";

export const revisionSchema = z.string().regex(/^(?:[\da-f]{40}|[\da-f]{64})$/);
const repositoryInput = z.object({
  directory: z.string().min(1),
  repositoryId: z.string().default("."),
});
export const compareRpc = defineRpc({
  name: "git.compare",
  input: repositoryInput.extend({
    selection: z.discriminatedUnion("mode", [
      z.object({
        mode: z.literal("branch"),
        baseRef: z.string().min(1).max(1024).default("auto"),
        strategy: z.enum(["merge-base", "tips"]).default("merge-base"),
      }),
      z.object({ mode: z.literal("range"), oldest: revisionSchema, newest: revisionSchema }),
    ]),
  }),
  output: z.object({
    baseOid: revisionSchema.nullable(),
    targetOid: revisionSchema,
    baseRef: z.string(),
    branch: z.string().nullable(),
    title: z.string(),
    commitCount: z.number().int().nonnegative(),
    files: z.array(changeSchema),
    revision: z.string(),
  }),
});
export type CompareInput = z.infer<typeof compareRpc.input>;
export type CompareResult = z.infer<typeof compareRpc.output>;
export const compareFileDiffRpc = defineRpc({
  name: "git.compare-file-diff",
  input: repositoryInput.extend({
    baseOid: revisionSchema.nullable(),
    targetOid: revisionSchema,
    path: z.string().min(1),
    context: z.number().int().min(0).max(1000000).default(3),
    ignoreWhitespace: z.boolean().default(false),
  }),
  output: fileDiffSchema,
});
export type CompareDiffInput = z.infer<typeof compareFileDiffRpc.input>;
