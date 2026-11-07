import type { DiffHunk, DiffLine } from "../shared/contracts";

export type DiffRow =
  | { key: string; header: string }
  | { key: string; left: DiffLine | null; right: DiffLine | null };
export function buildDiffRows(hunks: DiffHunk[], split: boolean): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const [hunkIndex, hunk] of hunks.entries()) {
    rows.push({ key: `h${hunkIndex}`, header: hunk.header });
    for (let index = 0; index < hunk.lines.length; ) {
      const line = hunk.lines[index];
      const key = `${hunkIndex}:${index}`;
      if (!split || line.kind === "context" || line.kind === "meta") {
        rows.push({ key, left: line, right: split ? line : null });
        index++;
        continue;
      }
      const removed: DiffLine[] = [];
      const added: DiffLine[] = [];
      while (index < hunk.lines.length && ["removed", "added"].includes(hunk.lines[index].kind)) {
        const changed = hunk.lines[index++];
        (changed.kind === "removed" ? removed : added).push(changed);
      }
      for (let pair = 0; pair < Math.max(removed.length, added.length); pair++)
        rows.push({
          key: `${key}:${pair}`,
          left: removed[pair] ?? null,
          right: added[pair] ?? null,
        });
    }
  }
  return rows;
}
