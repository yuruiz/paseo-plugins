import { PluginAttachmentItemSchema } from "@getpaseo/plugin";
import { expect, it } from "vitest";
import { commentTarget, reviewComposerItem } from "../client/review-comments-model";
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
it("captures old/new line identity and immutable context in a composer attachment", () => {
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
  const item = PluginAttachmentItemSchema.parse(reviewComposerItem(old));
  expect(item.id).toBe(old.id);
  expect(item.identifier).toBe("src/file.ts:2");
  expect(item.title).toBe("file.ts:2");
  expect(JSON.parse(item.text)).toMatchObject({
    cwd: "/repo",
    baseRef: "base..head",
    filePath: "src/file.ts",
    side: "old",
    lineNumber: 2,
    body: "Check deletion",
    context: old.context,
  });
  expect(JSON.parse(reviewComposerItem(added).text)).toMatchObject({
    side: "new",
    body: "Check replacement",
    context: added.context,
  });
  expect(item.text).not.toContain("host/workspace");
  expect(() => commentTarget(diff, diff.hunks[0].lines[1], "new", scope)).toThrow();
});
