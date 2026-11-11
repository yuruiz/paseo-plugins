import { AgentAttachmentSchema } from "@getpaseo/protocol/messages";
import { expect, it } from "vitest";
import { commentTarget, reviewAttachment } from "../client/review-comments-model";
import type { FileDiff } from "../shared/contracts";
import { reviewCommentSchema } from "../shared/review-comments";

const scope = {
  session: "host/workspace",
  scope: "base..head",
  cwd: "/repo",
  mode: "base" as const,
  baseRef: "base..head",
};
const diff: FileDiff = {
  path: "src/file.ts",
  state: "text",
  patch: "",
  message: null,
  hunks: [
    {
      header: "@@ -1,2 +1,2 @@",
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: "context", oldLine: 1, newLine: 1, content: "same" },
        { kind: "removed", oldLine: 2, newLine: null, content: "before" },
        { kind: "added", oldLine: null, newLine: 2, content: "after" },
      ],
    },
  ],
};
it("captures old/new line identity and immutable context in Paseo's native review attachment", () => {
  const old = reviewCommentSchema.parse({
    ...commentTarget(diff, diff.hunks[0].lines[1], "old", scope),
    body: "Check deletion",
  });
  const added = reviewCommentSchema.parse({
    ...commentTarget(diff, diff.hunks[0].lines[2], "new", scope),
    body: "Check replacement",
  });
  expect(old.context.targetLine).toMatchObject({
    type: "remove",
    oldLineNumber: 2,
    newLineNumber: null,
  });
  expect(added.context.targetLine).toMatchObject({
    type: "add",
    oldLineNumber: null,
    newLineNumber: 2,
  });
  const attachment = AgentAttachmentSchema.parse(reviewAttachment(scope, [old, added]));
  expect(attachment).toMatchObject({
    type: "review",
    mimeType: "application/paseo-review",
    cwd: "/repo",
    baseRef: "base..head",
    comments: [
      { filePath: "src/file.ts", side: "old", lineNumber: 2 },
      { side: "new", lineNumber: 2 },
    ],
  });
  expect(JSON.stringify(attachment)).not.toContain("host/workspace");
  expect(() => commentTarget(diff, diff.hunks[0].lines[1], "new", scope)).toThrow();
});
