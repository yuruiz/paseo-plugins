import { chmod, lstat, mkdir, rename, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFileDiff } from "../server/diff";
import { scanWorkspace } from "../server/repositories";
import { addModule, command, commit, fixture, put } from "./fixtures";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});
async function setup() {
  const value = await fixture();
  cleanups.push(value.close);
  return value;
}
async function scan(directory: string, comparison: "head" | "staged" | "unstaged" = "head") {
  return scanWorkspace({ directory, comparison });
}

it("recurses into every initialized module despite ignore=all and a clean parent status", async () => {
  const f = await setup();
  const leaf = await f.repo("leaf");
  await put(leaf, "deep.txt", "before\n");
  await commit(leaf);
  const source = await f.repo("source");
  await put(source, "own.txt", "unchanged\n");
  await addModule(source, leaf, "nested/leaf");
  await command(source, "config", "-f", ".gitmodules", "submodule.nested/leaf.ignore", "all");
  await commit(source);
  const root = await f.repo("root");
  const module = await addModule(root, source, "modules/child");
  await command(root, "config", "-f", ".gitmodules", "submodule.modules/child.ignore", "all");
  await commit(root);
  await command(
    root,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "update",
    "--init",
    "--recursive",
  );
  await command(root, "config", "diff.ignoreSubmodules", "all");
  await command(module, "config", "submodule.nested/leaf.ignore", "all");
  await put(module, "nested/leaf/deep.txt", "after\n");
  expect(await command(root, "status", "--porcelain")).toBe("");
  expect((await lstat(join(module, ".git"))).isFile()).toBe(true);
  const result = await scan(root);
  expect(result.repositories.map((repo) => repo.id)).toEqual([
    ".",
    "modules/child",
    "modules/child/nested/leaf",
  ]);
  expect(result.repositories.every((repo) => repo.state === "ready")).toBe(true);
  expect(result.repositories[0].files).toEqual([]);
  expect(result.repositories[1].files).toEqual([]);
  const deepest = result.repositories[2];
  expect(deepest.files.map((file) => file.path)).toEqual(["deep.txt"]);
  expect((await readFileDiff(deepest, "deep.txt", "head")).patch).toContain("+after");
});

it("uses each module's HEAD, separating committed gitlink drift from local changes", async () => {
  const f = await setup();
  const source = await f.repo("source");
  await put(source, "history.txt", "old\n");
  await commit(source);
  const root = await f.repo("root");
  const module = await addModule(root, source, "child");
  await commit(root);
  await command(module, "config", "user.name", "Plugin tests");
  await command(module, "config", "user.email", "test@example.invalid");
  await put(module, "history.txt", "already committed\n");
  await commit(module);
  await put(module, "local.txt", "local\n");
  const result = await scan(root);
  const child = result.repositories[1];
  expect(child.head).not.toBe(child.recordedHead);
  expect(child.recordedHead).toBe((await command(root, "rev-parse", "HEAD:child")).trim());
  expect(child.files.map((file) => file.path)).toEqual(["local.txt"]);
  expect(result.repositories[0].files).toEqual([]);
});

it("keeps standard ignore rules while still showing changes to tracked ignored paths", async () => {
  const f = await setup();
  const root = await f.repo("root");
  await put(root, "cache/tracked.txt", "before\n");
  await commit(root);
  await put(root, ".gitignore", "cache/\nignored-repo/\n");
  await commit(root);
  await put(root, "cache/tracked.txt", "after\n");
  await put(root, "cache/ignored.txt", "ignored\n");
  await put(root, "visible.txt", "visible\n");
  await mkdir(join(root, "ignored-repo"));
  await command(join(root, "ignored-repo"), "init", "-q");
  const result = await scan(root);
  expect(result.repositories).toHaveLength(1);
  expect(result.repositories[0].files.map((file) => file.path)).toEqual([
    "cache/tracked.txt",
    "visible.txt",
  ]);
});

it("reports an uninitialized module without confusing its parent for the module", async () => {
  const f = await setup();
  const source = await f.repo("source");
  await put(source, "a.txt", "a\n");
  await commit(source);
  const root = await f.repo("root");
  await addModule(root, source, "child");
  await commit(root);
  await command(root, "submodule", "deinit", "-f", "--", "child");
  const result = await scan(root);
  expect(result.repositories[1]).toMatchObject({
    id: "child",
    state: "uninitialized",
    head: null,
    files: [],
  });
});

it("distinguishes staged, unstaged and total HEAD changes, including edits that cancel out", async () => {
  const f = await setup();
  const root = await f.repo("root");
  await put(root, "file.txt", "baseline\n");
  await commit(root);
  await put(root, "file.txt", "staged\n");
  await command(root, "add", "file.txt");
  await put(root, "file.txt", "baseline\n");
  await put(root, "new.txt", "new\n");
  const total = (await scan(root)).repositories[0];
  expect(total.files.map((file) => file.path)).toEqual(["new.txt"]);
  const staged = (await scan(root, "staged")).repositories[0];
  expect(staged.files.map((file) => file.path)).toEqual(["file.txt"]);
  expect((await readFileDiff(staged, "file.txt", "staged")).patch).toContain("+staged");
  const unstaged = (await scan(root, "unstaged")).repositories[0];
  expect(unstaged.files.map((file) => file.path)).toEqual(["file.txt", "new.txt"]);
  expect((await readFileDiff(unstaged, "file.txt", "unstaged")).patch).toContain("-staged");
});

it("handles an unborn HEAD, staged additions and subsequent working-tree edits", async () => {
  const f = await setup();
  const root = await f.repo("root");
  await put(root, "new.txt", "staged\n");
  await command(root, "add", "new.txt");
  await put(root, "new.txt", "working\n");
  const repo = (await scan(root)).repositories[0];
  expect(repo.head).toBeNull();
  expect(repo.state).toBe("ready");
  const patch = await readFileDiff(repo, "new.txt", "head");
  expect(patch.patch).toContain("+working");
  expect(patch.hunks[0].lines[0].newLine).toBe(1);
});

it("reads renames, deletions and exact filenames containing tabs, Unicode, newlines and pathspec syntax", async () => {
  const f = await setup();
  const root = await f.repo("root");
  await put(root, "old.txt", "rename me\n");
  await put(root, "deleted.txt", "delete me\n");
  await put(root, ":(glob)*.txt", "before\n");
  await commit(root);
  await command(root, "mv", "old.txt", "重命名\t file.txt");
  await command(root, "rm", "deleted.txt");
  await put(root, ":(glob)*.txt", "after\n");
  await put(root, "line\nbreak.txt", "new without final newline");
  const repo = (await scan(root)).repositories[0];
  expect(repo.state).toBe("ready");
  const renamed = repo.files.find((file) => file.oldPath === "old.txt");
  expect(renamed).toMatchObject({
    path: "重命名\t file.txt",
    status: "renamed",
    additions: 0,
    deletions: 0,
  });
  expect((await readFileDiff(repo, "deleted.txt", "head")).hunks[0].lines[0].kind).toBe("removed");
  expect((await readFileDiff(repo, ":(glob)*.txt", "head")).patch).toContain("+after");
  const added = await readFileDiff(repo, "line\nbreak.txt", "head");
  expect(added.hunks[0].lines).toContainEqual({
    kind: "meta",
    content: "\\ No newline at end of file",
    oldLine: null,
    newLine: null,
  });
});

it("shows binary and oversized changes explicitly instead of reporting no differences", async () => {
  const f = await setup();
  const root = await f.repo("root");
  await put(root, "binary.dat", Buffer.from([0, 1, 2]));
  await commit(root);
  await put(root, "binary.dat", Buffer.from([0, 2, 3]));
  await put(root, "big.txt", "x".repeat(1024 * 1024 + 1));
  const repo = (await scan(root)).repositories[0];
  expect(repo.files.find((file) => file.path === "binary.dat")?.binary).toBe(true);
  expect((await readFileDiff(repo, "binary.dat", "head")).state).toBe("binary");
  expect((await readFileDiff(repo, "big.txt", "head")).state).toBe("too_large");
});

it("invalidates the revision when the same file is edited again with unchanged status and line counts", async () => {
  const f = await setup();
  const root = await f.repo("root");
  await put(root, "file.txt", "before\n");
  await commit(root);
  await put(root, "file.txt", "first!\n");
  const first = await scan(root);
  await put(root, "file.txt", "second\n");
  const second = await scan(root);
  expect(first.repositories[0].files[0].status).toBe(second.repositories[0].files[0].status);
  expect(first.repositories[0].files[0].additions).toBe(second.repositories[0].files[0].additions);
  expect(first.version).not.toBe(second.version);
  expect((await readFileDiff(second.repositories[0], "file.txt", "head")).patch).toContain(
    "+second",
  );
});

it("supports submodules in a linked worktree", async () => {
  const f = await setup();
  const source = await f.repo("source");
  await put(source, "file.txt", "before\n");
  await commit(source);
  const root = await f.repo("root");
  await addModule(root, source, "child");
  await commit(root);
  const worktree = join(f.base, "worktree");
  await command(root, "worktree", "add", "-qb", "test-worktree", worktree);
  await command(worktree, "-c", "protocol.file.allow=always", "submodule", "update", "--init");
  await put(worktree, "child/file.txt", "after\n");
  const result = await scan(worktree);
  expect(result.repositories[1].files.map((file) => file.path)).toEqual(["file.txt"]);
});

it("renders mode-only changes and symlink targets without reading their target files", async () => {
  if (process.platform === "win32") return;
  const f = await setup();
  const root = await f.repo("root");
  await put(root, "run.sh", "hello\n");
  await symlink("old-target", join(root, "link"));
  await commit(root);
  await chmod(join(root, "run.sh"), 0o755);
  await rename(join(root, "link"), join(root, "old-link"));
  await symlink("new-target", join(root, "link"));
  const repo = (await scan(root)).repositories[0];
  expect((await readFileDiff(repo, "run.sh", "head")).patch).toContain("new mode 100755");
  expect((await readFileDiff(repo, "link", "head")).patch).toContain("+new-target");
});

describe("input boundaries", () => {
  it("rejects paths not in the repository snapshot", async () => {
    const f = await setup();
    const root = await f.repo("root");
    await put(root, "file.txt", "before\n");
    await commit(root);
    const repo = (await scan(root)).repositories[0];
    await expect(readFileDiff(repo, "../outside", "head")).rejects.toThrow("变更列表");
  });
});
