import type { DiffLine, FileDiff } from "../shared/contracts";
import type { ReviewComment } from "../shared/review-comments";
export type ReviewScope = Pick<ReviewComment, "session" | "scope" | "cwd" | "mode" | "baseRef">;
export type ReviewTarget = Omit<ReviewComment, "body">;
export function commentTarget(
  diff: FileDiff,
  line: DiffLine,
  side: "old" | "new",
  scope: ReviewScope,
): ReviewTarget {
  const lineNumber = side === "old" ? line.oldLine : line.newLine;
  if (!lineNumber || line.kind === "meta") throw new Error("该行不能添加评论。");
  const hunk = diff.hunks.find((item) => item.lines.includes(line));
  if (!hunk) throw new Error("评论行已不在当前差异中。");
  const lines = hunk.lines.filter((item) => item.kind !== "meta");
  const index = lines.indexOf(line);
  function context(item: DiffLine) {
    return {
      oldLineNumber: item.oldLine,
      newLineNumber: item.newLine,
      content: item.content,
      type:
        item.kind === "added"
          ? ("add" as const)
          : item.kind === "removed"
            ? ("remove" as const)
            : ("context" as const),
    };
  }
  return {
    ...scope,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    filePath: diff.path,
    side,
    lineNumber,
    context: {
      hunkHeader: hunk.header,
      targetLine: context(line),
      lines: lines.slice(Math.max(0, index - 3), index + 4).map(context),
    },
  };
}
export function reviewComposerItem(comment: ReviewComment) {
  const { filePath, side, lineNumber, body, context, cwd, baseRef } = comment;
  return {
    id: comment.id,
    identifier: `${filePath}:${lineNumber}`,
    title: `${filePath.split("/").at(-1)}:${lineNumber}`,
    subtitle: body,
    url: `file://${cwd.split("/").map(encodeURIComponent).join("/")}/${filePath.split("/").map(encodeURIComponent).join("/")}#L${lineNumber}`,
    resourceType: "code-review",
    text: JSON.stringify({ cwd, baseRef, filePath, side, lineNumber, body, context }, null, 2),
  };
}
