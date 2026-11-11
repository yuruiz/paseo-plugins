import type { DiffLine, FileDiff } from "../shared/contracts";
import { buildDiffRows, type DiffRow } from "./diff-model";

export type ContextDirection = "up" | "down";
export type GapExpansion = { up: number; down: number };
export type ContextExpansion = Record<number, number | GapExpansion>;
export type ContextRow =
  | DiffRow
  | { key: string; gap: number; count: number | null; up: boolean; down: boolean };

function gapExpansion(value: number | GapExpansion | undefined, gap: number): GapExpansion {
  return typeof value === "number"
    ? { up: gap === 0 ? value : 0, down: gap === 0 ? 0 : value }
    : (value ?? { up: 0, down: 0 });
}

export function expandContextGap(
  expanded: ContextExpansion,
  gap: number,
  direction: ContextDirection,
  all = false,
): ContextExpansion {
  const previous = gapExpansion(expanded[gap], gap);
  return {
    ...expanded,
    [gap]: { ...previous, [direction]: all ? Infinity : previous[direction] + 20 },
  };
}

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
  expanded: ContextExpansion,
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
    const expansion = gapExpansion(expanded[index], index);
    const fromStart = Math.min(expansion.down, lines?.length ?? 0);
    const fromEnd = Math.min(expansion.up, (lines?.length ?? 0) - fromStart);
    const shown = fromStart + fromEnd;
    const append = (visible: DiffLine[]) => {
      for (const line of visible)
        rows.push({
          key: `context:${line.oldLine}:${line.newLine}`,
          left: line,
          right: split ? line : null,
        });
    };
    if (lines) append(lines.slice(0, fromStart));
    if (count === null || count > shown)
      rows.push({
        key: `gap:${index}`,
        gap: index,
        count: count === null ? null : count - shown,
        up: Boolean(hunk),
        down: index > 0,
      });
    if (lines && fromEnd) append(lines.slice(lines.length - fromEnd));
    if (!hunk) break;
    rows.push(
      ...buildDiffRows([hunk], split).map((row) => ({ ...row, key: `hunk:${index}:${row.key}` })),
    );
    oldStart = Math.max(1, hunk.oldStart + hunk.oldLines + (hunk.oldLines === 0 ? 1 : 0));
    newStart = Math.max(1, hunk.newStart + hunk.newLines + (hunk.newLines === 0 ? 1 : 0));
  }
  return rows;
}
