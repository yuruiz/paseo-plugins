import type { DiffHunk, FileChange } from "../shared/contracts";

export interface NameChange {
  path: string;
  oldPath?: string;
  status: FileChange["status"];
}
const statuses: Record<string, FileChange["status"]> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "conflicted",
  T: "typechanged",
};

export function parseNameStatus(output: string): NameChange[] {
  const fields = output.split("\0");
  const files: NameChange[] = [];
  for (let index = 0; index < fields.length; ) {
    const code = fields[index++];
    if (!code) continue;
    const first = fields[index++];
    if (first === undefined) throw new Error("Incomplete Git name-status record");
    if (code[0] === "R" || code[0] === "C") {
      const next = fields[index++];
      if (next === undefined) throw new Error("Incomplete Git rename record");
      files.push({ path: next, oldPath: first, status: statuses[code[0]] });
    } else files.push({ path: first, status: statuses[code[0]] ?? "modified" });
  }
  return files;
}

export interface FileStat {
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}
export function parseNumstat(output: string): Map<string, FileStat> {
  const fields = output.split("\0");
  const files = new Map<string, FileStat>();
  for (let index = 0; index < fields.length; index++) {
    const record = fields[index];
    const first = record.indexOf("\t");
    const second = record.indexOf("\t", first + 1);
    if (first < 0 || second < 0) continue;
    const additions = record.slice(0, first);
    const deletions = record.slice(first + 1, second);
    let path = record.slice(second + 1);
    if (!path) {
      index += 2;
      path = fields[index];
    }
    files.set(path, {
      additions: additions === "-" ? null : Number(additions),
      deletions: deletions === "-" ? null : Number(deletions),
      binary: additions === "-" || deletions === "-",
    });
  }
  return files;
}

export interface IndexEntry {
  mode: string;
  oid: string;
  stage: string;
}
export function parseIndex(output: string): Map<string, IndexEntry> {
  const entries = new Map<string, IndexEntry>();
  for (const record of output.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, oid, stage] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (!entries.has(path) || stage === "0") entries.set(path, { mode, oid, stage });
  }
  return entries;
}

export function parseTree(output: string): Map<string, IndexEntry> {
  const entries = new Map<string, IndexEntry>();
  for (const record of output.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, , oid] = record.slice(0, tab).split(" ");
    entries.set(record.slice(tab + 1), { mode, oid, stage: "0" });
  }
  return entries;
}

export interface StatusEntry {
  staged: boolean;
  unstaged: boolean;
  conflict: boolean;
}
export function parseStatus(output: string): {
  entries: Map<string, StatusEntry>;
  untracked: string[];
} {
  const fields = output.split("\0");
  const entries = new Map<string, StatusEntry>();
  const untracked: string[] = [];
  for (let index = 0; index < fields.length; index++) {
    const record = fields[index];
    if (record.startsWith("? ")) {
      untracked.push(record.slice(2));
      continue;
    }
    if (!["1", "2", "u"].includes(record[0])) continue;
    const prefixFields = record[0] === "1" ? 8 : record[0] === "2" ? 9 : 10;
    let position = 0;
    for (let field = 0; field < prefixFields; field++) position = record.indexOf(" ", position) + 1;
    const path = record.slice(position);
    const xy = record.slice(2, 4);
    entries.set(path, {
      staged: xy[0] !== ".",
      unstaged: xy[1] !== ".",
      conflict: record[0] === "u",
    });
    if (record[0] === "2") index++;
  }
  return { entries, untracked };
}

export function parseHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (match) {
      hunk = {
        header: line,
        oldStart: Number(match[1]),
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      };
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("+"))
      hunk.lines.push({ kind: "added", content: line.slice(1), oldLine: null, newLine: newLine++ });
    else if (line.startsWith("-"))
      hunk.lines.push({
        kind: "removed",
        content: line.slice(1),
        oldLine: oldLine++,
        newLine: null,
      });
    else if (line.startsWith(" "))
      hunk.lines.push({
        kind: "context",
        content: line.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    else if (line.startsWith("\\"))
      hunk.lines.push({ kind: "meta", content: line, oldLine: null, newLine: null });
  }
  return hunks;
}
