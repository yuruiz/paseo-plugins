import type { DiffLine, FileDiff } from "../shared/contracts";
import { buildDiffRows, type DiffRow } from "./diff-model";

export type ContextRow = DiffRow | { key: string; gap: number; count: number | null };

function lineId(line: DiffLine) {
  return JSON.stringify([line.kind, line.oldLine, line.newLine, line.content]);
}

// A working file may change while the full patch is being requested. Never mix snapshots.
export function validateFullContext(original: FileDiff, full: FileDiff) {
  if (full.state !== "text") throw new Error(full.message ?? "无法读取完整上下文。");
  const lines = new Set(full.hunks.flatMap((hunk) => hunk.lines.map(lineId)));
  if (original.hunks.some((hunk) => hunk.lines.some((line) => !lines.has(lineId(line)))))
    throw new Error("文件已更改，请刷新差异后重试展开上下文。");
  const changes = (diff: FileDiff) =>
    diff.hunks.flatMap((hunk) =>
      hunk.lines.filter((line) => line.kind === "added" || line.kind === "removed").map(lineId),
    );
  if (JSON.stringify(changes(original)) !== JSON.stringify(changes(full)))
    throw new Error("文件已更改，请刷新差异后重试展开上下文。");
}

export function buildContextRows(
  diff: FileDiff,
  full: FileDiff | null,
  split: boolean,
  expanded: Record<number, number>,
): ContextRow[] {
  const rows: ContextRow[] = [];
  const first = diff.hunks[0];
  const wholeFile =
    diff.hunks.length === 1 &&
    first &&
    ((first.oldStart === 0 && first.oldLines === 0) ||
      (first.newStart === 0 && first.newLines === 0));
  const context = (full ?? (wholeFile ? diff : null))?.hunks.flatMap((hunk) =>
    hunk.lines.filter((line) => line.kind === "context"),
  );
  let oldStart = 1;
  let newStart = 1;
  let cursor = 0;
  for (let index = 0; index <= diff.hunks.length; index++) {
    const hunk = diff.hunks[index];
    // Zero-length ranges denote the position before an insertion/deletion.
    const oldEnd = hunk ? hunk.oldStart + (hunk.oldLines === 0 ? 1 : 0) : Infinity;
    const newEnd = hunk ? hunk.newStart + (hunk.newLines === 0 ? 1 : 0) : Infinity;
    const lines: DiffLine[] | undefined = context ? [] : undefined;
    while (context && cursor < context.length) {
      const line = context[cursor];
      if ((line.oldLine ?? 0) >= oldEnd || (line.newLine ?? 0) >= newEnd) break;
      if ((line.oldLine ?? 0) >= oldStart && (line.newLine ?? 0) >= newStart) lines?.push(line);
      cursor++;
    }
    const count =
      lines?.length ?? (hunk ? Math.max(0, Math.min(oldEnd - oldStart, newEnd - newStart)) : null);
    const shown = Math.min(expanded[index] ?? 0, lines?.length ?? 0);
    const visible = lines
      ? index === 0
        ? lines.slice(lines.length - shown)
        : lines.slice(0, shown)
      : [];
    const gap: ContextRow = {
      key: `gap:${index}`,
      gap: index,
      count: count === null ? null : count - shown,
    };
    if (index === 0 && (count === null || count > shown)) rows.push(gap);
    for (const line of visible)
      rows.push({
        key: `context:${line.oldLine}:${line.newLine}`,
        left: line,
        right: split ? line : null,
      });
    if (index !== 0 && (count === null || count > shown)) rows.push(gap);
    if (!hunk) break;
    rows.push(
      ...buildDiffRows([hunk], split).map((row) => ({ ...row, key: `hunk:${index}:${row.key}` })),
    );
    oldStart = Math.max(1, hunk.oldStart + hunk.oldLines + (hunk.oldLines === 0 ? 1 : 0));
    newStart = Math.max(1, hunk.newStart + hunk.newLines + (hunk.newLines === 0 ? 1 : 0));
  }
  return rows;
}
