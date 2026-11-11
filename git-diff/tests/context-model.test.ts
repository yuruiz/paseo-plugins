import { afterEach, expect, it } from "vitest";
import { buildContextRows, expandContextGap, validateFullContext } from "../client/context-model";
import { readFileDiff } from "../server/diff";
import { scanWorkspace } from "../server/repositories";
import type { FileDiff } from "../shared/contracts";
import { commit, fixture, put } from "./fixtures";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

async function patches(
  context = 3,
  edit = (lines: string[]) => {
    lines[40] = "changed first";
    lines[100] = "changed second";
  },
) {
  const f = await fixture();
  cleanups.push(f.close);
  const directory = await f.repo("context");
  const lines = Array.from({ length: 150 }, (_, i) => `line ${i + 1}`);
  await put(directory, "file.txt", `${lines.join("\n")}\n`);
  await commit(directory);
  edit(lines);
  await put(directory, "file.txt", `${lines.join("\n")}\n`);
  const repo = (await scanWorkspace({ directory, comparison: "head" })).repositories[0];
  const original = await readFileDiff(repo, "file.txt", "head", context);
  const full = await readFileDiff(repo, "file.txt", "head", 1000000);
  return { original, full };
}

it("finds omitted prefix, middle and unknown trailing context without fetching the full patch", async () => {
  const { original } = await patches();
  const gaps = buildContextRows(original, null, false, {}).filter((row) => "gap" in row);
  expect(gaps).toMatchObject([
    { gap: 0, count: 37 },
    { gap: 1, count: 53 },
    { gap: 2, count: null },
  ]);
});

it.each([false, true])(
  "expands independent gaps and preserves every line and hunk anchor (split=%s)",
  async (split) => {
    const { original, full } = await patches();
    expect(() => validateFullContext(original, full)).not.toThrow();
    const partial = buildContextRows(original, full, split, { 0: 20, 1: 20 });
    expect(partial.filter((row) => "gap" in row)).toMatchObject([
      { gap: 0, count: 17 },
      { gap: 1, count: 33 },
      { gap: 2, count: 46 },
    ]);
    expect(partial.find((row) => "left" in row && row.left?.kind === "context")).toMatchObject({
      left: { oldLine: 18, newLine: 18 },
    });
    const rows = buildContextRows(original, full, split, { 0: Infinity, 1: Infinity, 2: Infinity });
    expect(rows.filter((row) => "gap" in row)).toEqual([]);
    expect(
      rows.filter((row) => "header" in row).map((row) => "header" in row && row.header),
    ).toEqual(original.hunks.map((hunk) => hunk.header));
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    const left = rows.flatMap((row) => ("left" in row && row.left ? [row.left] : []));
    if (split) {
      expect(left.map((line) => line.oldLine)).toEqual(
        Array.from({ length: 150 }, (_, i) => i + 1),
      );
      const right = rows.flatMap((row) => ("right" in row && row.right ? [row.right] : []));
      expect(right.map((line) => line.newLine)).toEqual(
        Array.from({ length: 150 }, (_, i) => i + 1),
      );
    } else expect(left).toEqual(full.hunks.flatMap((hunk) => hunk.lines));
  },
);

it.each(["insert", "delete"])(
  "handles zero-context %s ranges without duplicate or missing lines",
  async (kind) => {
    const { original, full } = await patches(0, (lines) => {
      if (kind === "insert") lines.splice(40, 0, "inserted");
      else lines.splice(40, 1);
    });
    validateFullContext(original, full);
    const rows = buildContextRows(original, full, false, { 0: Infinity, 1: Infinity });
    expect(rows.flatMap((row) => ("left" in row && row.left ? [row.left] : []))).toEqual(
      full.hunks.flatMap((hunk) => hunk.lines),
    );
  },
);

it("does not show trailing expansion after discovering EOF, and rejects stale or oversized patches", async () => {
  const { original, full } = await patches(3, (lines) => {
    lines[149] = "last changed";
  });
  expect(
    buildContextRows(original, full, false, {}).some((row) => "gap" in row && row.gap === 1),
  ).toBe(false);
  const stale = structuredClone(full);
  stale.hunks[0].lines[0].kind = "added";
  expect(() => validateFullContext(original, stale)).toThrow("文件已更改");
  const oversized: FileDiff = { ...full, state: "too_large", hunks: [], message: "补丁超过 2 MiB" };
  expect(() => validateFullContext(original, oversized)).toThrow("补丁超过 2 MiB");
});

it.each([false, true])(
  "expands the same middle gap from both directions without overlap (split=%s)",
  async (split) => {
    const { original, full } = await patches();
    let expansion = expandContextGap({}, 1, "down");
    expansion = expandContextGap(expansion, 1, "up");
    const rows = buildContextRows(original, full, split, expansion);
    expect(rows.filter((row) => "gap" in row)).toMatchObject([
      { gap: 0, up: true, down: false },
      { gap: 1, count: 13, up: true, down: true },
      { gap: 2, up: false, down: true },
    ]);
    const middle = rows.flatMap((row) =>
      "left" in row && row.left?.oldLine && row.left.oldLine > 44 && row.left.oldLine < 98
        ? [row.left.oldLine]
        : [],
    );
    expect(middle).toEqual([
      ...Array.from({ length: 20 }, (_, i) => i + 45),
      ...Array.from({ length: 20 }, (_, i) => i + 78),
    ]);
    expansion = expandContextGap(expansion, 1, "up");
    const joined = buildContextRows(original, full, split, expansion);
    expect(joined.some((row) => "gap" in row && row.gap === 1)).toBe(false);
    expect(new Set(joined.map((row) => row.key)).size).toBe(joined.length);
  },
);
