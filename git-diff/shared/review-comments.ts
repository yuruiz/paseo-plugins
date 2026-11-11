import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

const contextLine = z.object({
  oldLineNumber: z.number().nullable(),
  newLineNumber: z.number().nullable(),
  type: z.enum(["context", "add", "remove"]),
  content: z.string().max(20000),
});
export const reviewCommentSchema = z.object({
  id: z.string(),
  session: z.string(),
  scope: z.string(),
  cwd: z.string(),
  mode: z.enum(["uncommitted", "base"]),
  baseRef: z.string().nullable(),
  filePath: z.string(),
  side: z.enum(["old", "new"]),
  lineNumber: z.number().int().positive(),
  body: z.string().min(1).max(10000),
  context: z.object({
    hunkHeader: z.string(),
    targetLine: contextLine,
    lines: z.array(contextLine).max(7),
  }),
});
export type ReviewComment = z.infer<typeof reviewCommentSchema>;
export const reviewDraftSettings = defineSettings({
  id: "review-comments",
  scope: "host",
  version: 1,
  schema: z.object({ comments: z.array(reviewCommentSchema).max(500).default([]) }),
});
