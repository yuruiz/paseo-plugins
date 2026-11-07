import { afterEach, expect, it, vi } from "vitest";
import { buildDiffRows } from "../client/diff-model";
import { readFileDiff } from "../server/diff";
import { parseHunks } from "../server/parsers";
import { RepositoryScanCache, scanWorkspace } from "../server/repositories";
import { GitChangesService } from "../server/service";
import { command, commit, fixture, put } from "./fixtures";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((close) => close()));
});
async function setup() {
  const f = await fixture();
  cleanups.push(f.close);
  return f.repo("root");
}

it("keeps a staged deletion distinct from an untracked replacement at the same path", async () => {
  const directory = await setup();
  await put(directory, "file.txt", "original\n");
  await commit(directory);
  await command(directory, "rm", "file.txt");
  await put(directory, "file.txt", "replacement\n");
  const total = (await scanWorkspace({ directory, comparison: "head" })).repositories[0];
  expect(total.files[0].status).toBe("deleted");
  expect((await readFileDiff(total, "file.txt", "head")).patch).toContain("-original");
  const unstaged = (await scanWorkspace({ directory, comparison: "unstaged" })).repositories[0];
  expect(unstaged.files[0].status).toBe("untracked");
  expect((await readFileDiff(unstaged, "file.txt", "unstaged")).patch).toContain("+replacement");
});

it("shows unresolved conflicts against HEAD and explains the unavailable index comparison", async () => {
  const directory = await setup();
  await put(directory, "file.txt", "baseline\n");
  await commit(directory);
  await command(directory, "checkout", "-qb", "other");
  await put(directory, "file.txt", "other\n");
  await commit(directory);
  await command(directory, "checkout", "main");
  await put(directory, "file.txt", "main\n");
  await commit(directory);
  await expect(command(directory, "merge", "other")).rejects.toThrow();
  const total = (await scanWorkspace({ directory, comparison: "head" })).repositories[0];
  expect(total.state).toBe("ready");
  expect(total.files[0].status).toBe("conflicted");
  expect((await readFileDiff(total, "file.txt", "head")).patch).toContain("+<<<<<<< HEAD");
  const staged = (await scanWorkspace({ directory, comparison: "staged" })).repositories[0];
  expect((await readFileDiff(staged, "file.txt", "staged")).message).toContain("未解决");
});

it("can hide whitespace-only patches and expand unchanged context", async () => {
  const directory = await setup();
  const lines = Array.from({ length: 30 }, (_, index) => `line ${index}`);
  await put(directory, "file.txt", `${lines.join("\n")}\n`);
  await commit(directory);
  lines[15] = "line    15";
  await put(directory, "file.txt", `${lines.join("\n")}\n`);
  const repo = (await scanWorkspace({ directory, comparison: "head" })).repositories[0];
  const normal = await readFileDiff(repo, "file.txt", "head", 3);
  const full = await readFileDiff(repo, "file.txt", "head", 1000000);
  expect(full.hunks[0].lines.length).toBeGreaterThan(normal.hunks[0].lines.length);
  expect((await readFileDiff(repo, "file.txt", "head", 3, true)).hunks).toEqual([]);
});

it("coalesces a slow scan even when the normal cache lifetime has elapsed", async () => {
  const directory = await setup();
  await put(directory, "file.txt", "baseline\n");
  await commit(directory);
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  const service = new GitChangesService();
  const first = service.snapshot({ directory, comparison: "head" });
  now.mockReturnValue(4000);
  expect(service.snapshot({ directory, comparison: "head" })).toBe(first);
  await first;
  service.close();
});

it("pairs unequal change blocks in split view without losing context or line numbers", () => {
  const hunks = parseHunks("@@ -2,4 +2,3 @@\n unchanged\n-old one\n-old two\n+new one\n tail\n");
  const rows = buildDiffRows(hunks, true);
  expect(rows).toHaveLength(5);
  expect(rows[2]).toMatchObject({
    left: { content: "old one", oldLine: 3 },
    right: { content: "new one", newLine: 3 },
  });
  expect(rows[3]).toMatchObject({ left: { content: "old two", oldLine: 4 }, right: null });
  expect(rows[4]).toMatchObject({
    left: { content: "tail", oldLine: 5 },
    right: { content: "tail", newLine: 4 },
  });
});

it("invalidates reused untracked statistics and reports branches without extra Git commands", async () => {
  const directory = await setup();
  const cache = new RepositoryScanCache();
  await put(directory, "new.txt", "one\n");
  const first = await scanWorkspace({ directory, comparison: "head" }, cache);
  expect(first.repositories[0].branch).toBe("main");
  expect(first.repositories[0].head).toBeNull();
  expect(first.repositories[0].files[0].additions).toBe(1);
  await put(directory, "new.txt", "one\ntwo\n");
  const next = await scanWorkspace({ directory, comparison: "head" }, cache);
  expect(next.repositories[0].files[0].additions).toBe(2);
  expect(next.version).not.toBe(first.version);
  await commit(directory);
  await command(directory, "checkout", "--detach");
  expect(
    (await scanWorkspace({ directory, comparison: "head" }, cache)).repositories[0].branch,
  ).toBeNull();
});

it("forces a fresh manual scan while preserving normal snapshot coalescing", async () => {
  const directory = await setup();
  await put(directory, "file.txt", "first\n");
  const service = new GitChangesService();
  try {
    const first = await service.snapshot({ directory, comparison: "head" });
    await put(directory, "file.txt", "first\nsecond\n");
    expect(await service.snapshot({ directory, comparison: "head" })).toBe(first);
    const refreshed = await service.snapshot({ directory, comparison: "head", force: true });
    expect(refreshed.repositories[0].files[0].additions).toBe(2);
    expect(refreshed.version).not.toBe(first.version);
  } finally {
    service.close();
  }
});
