import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { GitChangesService } from "../server/service";
import { commitFileDiffRpc, commitRpc, historyRpc } from "../shared/history-contracts";
import { addModule, command, commit, fixture, put } from "./fixtures";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});
async function setup() {
  const f = await fixture();
  const service = new GitChangesService();
  cleanups.push(f.close, () => service.close());
  const directory = await f.repo("root");
  const history = (input = {}) => service.history(historyRpc.input.parse({ directory, ...input }));
  const details = (oid: string, input = {}) =>
    service.commit(commitRpc.input.parse({ directory, oid, ...input }));
  const diff = (oid: string, path: string, input = {}) =>
    service.commitDiff(commitFileDiffRpc.input.parse({ directory, oid, path, ...input }));
  return { f, directory, service, history, details, diff };
}
const head = async (directory: string) => (await command(directory, "rev-parse", "HEAD")).trim();

it("reads topological branch history, merges, annotated tags and remote refs with stable pagination", async () => {
  const { directory, history } = await setup();
  await put(directory, "base.txt", "base\n");
  await commit(directory, "初始提交");
  const root = await head(directory);
  await command(directory, "checkout", "-qb", "feature/graph");
  await put(directory, "feature.txt", "feature\n");
  await commit(directory, "feat: graph");
  const feature = await head(directory);
  await command(directory, "tag", "-a", "v1.0", "-m", "release");
  await command(directory, "update-ref", "refs/remotes/origin/feature/graph", feature);
  await command(
    directory,
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/feature/graph",
  );
  await command(directory, "checkout", "main");
  await put(directory, "main.txt", "main\n");
  await commit(directory, "main change");
  const main = await head(directory);
  await command(directory, "merge", "--no-ff", "feature/graph", "-m", "Merge graph");
  const merge = await head(directory);
  const first = await history({ limit: 2 });
  expect(first.commits[0]).toMatchObject({
    oid: merge,
    parents: [main, feature],
    subject: "Merge graph",
  });
  expect(first).toMatchObject({ hasMore: true, head: merge, branch: "main" });
  expect(first.refs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "main", kind: "branch", current: true, oid: merge }),
      expect.objectContaining({ name: "v1.0", kind: "tag", oid: feature }),
      expect.objectContaining({ name: "origin/feature/graph", kind: "remote", oid: feature }),
    ]),
  );
  expect(first.refs.some((ref) => ref.name === "origin/HEAD")).toBe(false);
  const second = await history({ limit: 2, offset: 2, revision: first.revision });
  const commits = [...first.commits, ...second.commits];
  expect(new Set(commits.map((commit) => commit.oid)).size).toBe(4);
  expect(commits.at(-1)?.oid).toBe(root);
  expect(second.hasMore).toBe(false);
  for (const commit of commits)
    for (const parent of commit.parents)
      expect(commits.findIndex((item) => item.oid === parent)).toBeGreaterThan(
        commits.indexOf(commit),
      );
});

it("filters to a selected ref or HEAD and rejects pagination after refs move", async () => {
  const { directory, history } = await setup();
  await put(directory, "base.txt", "base\n");
  await commit(directory, "base");
  await command(directory, "checkout", "-qb", "other");
  await put(directory, "other.txt", "other\n");
  await commit(directory, "other branch");
  await command(directory, "checkout", "main");
  expect((await history({ ref: "head" })).commits.map((commit) => commit.subject)).toEqual([
    "base",
  ]);
  expect(
    (await history({ ref: "refs/heads/other" })).commits.map((commit) => commit.subject),
  ).toEqual(["other branch", "base"]);
  const first = await history({ limit: 1 });
  await put(directory, "new.txt", "new\n");
  await commit(directory, "new commit");
  await expect(history({ limit: 1, offset: 1, revision: first.revision })).rejects.toThrow(
    "历史已变化",
  );
  await expect(history({ ref: "--all" })).rejects.toThrow("分支或标签");
});

it("reads root commits, full messages and historical diffs independently of the working tree", async () => {
  const { directory, history, details, diff } = await setup();
  await put(directory, "file.txt", "initial\n");
  await commit(directory, "初始提交\n\nDescription with delimiters \u001e \u001f and Unicode 中文");
  const root = await head(directory);
  const first = await details(root);
  expect(first).toMatchObject({ parents: [], author: "Plugin tests", diffMessage: null });
  expect(first.message).toContain("Description with delimiters");
  expect(first.files[0]).toMatchObject({
    path: "file.txt",
    status: "added",
    additions: 1,
    deletions: 0,
  });
  expect((await diff(root, "file.txt")).patch).toContain("+initial");
  await put(directory, "file.txt", "committed\n");
  await commit(directory, "update");
  const current = (await history()).commits[0].oid;
  await put(directory, "file.txt", "unrelated working change\n");
  const patch = await diff(current, "file.txt");
  expect(patch.patch).toContain("-initial");
  expect(patch.patch).toContain("+committed");
  expect(patch.patch).not.toContain("unrelated working change");
  await expect(diff(current, "../outside")).rejects.toThrow("变更列表");
  await expect(diff(current, ":(glob)*")).rejects.toThrow("变更列表");
});

it("compares merge commits against their first parent", async () => {
  const { directory, details, diff } = await setup();
  await put(directory, "base.txt", "base\n");
  await commit(directory);
  await command(directory, "checkout", "-qb", "feature");
  await put(directory, "feature.txt", "feature\n");
  await commit(directory);
  await command(directory, "checkout", "main");
  await put(directory, "main.txt", "main\n");
  await commit(directory);
  await command(directory, "merge", "--no-ff", "feature", "-m", "merge");
  const oid = await head(directory);
  expect((await details(oid)).files.map((file) => file.path)).toEqual(["feature.txt"]);
  expect((await diff(oid, "feature.txt")).patch).toContain("+feature");
});

it("keeps exact rename and deletion paths, binary states and historical size limits", async () => {
  const { directory, details, diff } = await setup();
  await put(directory, "old.txt", "rename\n");
  await put(directory, "delete.txt", "delete\n");
  await put(directory, "binary.dat", Buffer.from([0, 1, 2]));
  await commit(directory);
  const path = "重命名\tline\nbreak.txt";
  await command(directory, "mv", "old.txt", path);
  await command(directory, "rm", "delete.txt");
  await put(directory, "binary.dat", Buffer.from([0, 3, 4]));
  await put(directory, "big.txt", "x".repeat(1024 * 1024 + 1));
  await put(directory, ":(glob)*.txt", "literal\n");
  await commit(directory);
  const oid = await head(directory);
  expect((await details(oid)).files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path, oldPath: "old.txt", status: "renamed" }),
      expect.objectContaining({ path: "delete.txt", status: "deleted" }),
    ]),
  );
  expect((await diff(oid, path)).message).toContain("元数据");
  expect((await diff(oid, "delete.txt")).patch).toContain("-delete");
  expect((await diff(oid, "binary.dat")).state).toBe("binary");
  expect((await diff(oid, "big.txt")).state).toBe("too_large");
  expect((await diff(oid, ":(glob)*.txt")).patch).toContain("+literal");
});

it("supports empty repositories, empty commits and detached HEAD", async () => {
  const { directory, history, details } = await setup();
  expect(await history()).toMatchObject({ commits: [], refs: [], head: null, hasMore: false });
  await command(directory, "commit", "--allow-empty", "-qm", "empty");
  const oid = await head(directory);
  expect((await details(oid)).files).toEqual([]);
  await command(directory, "checkout", "--detach", oid);
  expect(await history()).toMatchObject({ branch: null, head: oid });
});

it("uses each submodule's own history and rejects unknown or uninitialized repositories", async () => {
  const { f, directory, history, details } = await setup();
  const source = await f.repo("source");
  await put(source, "child.txt", "child\n");
  await commit(source, "submodule commit");
  const childOid = await head(source);
  await addModule(directory, source, "nested/child");
  await command(directory, "config", "-f", ".gitmodules", "submodule.nested/child.ignore", "all");
  await commit(directory, "parent commit");
  expect((await history({ repositoryId: "nested/child" })).commits[0].subject).toBe(
    "submodule commit",
  );
  expect((await details(childOid, { repositoryId: "nested/child" })).files[0].path).toBe(
    "child.txt",
  );
  await expect(history({ repositoryId: "../source" })).rejects.toThrow("所属仓库");
  await command(directory, "submodule", "deinit", "-f", "--", "nested/child");
  // Force the shared workspace snapshot to reflect the removed initialization.
  const service = new GitChangesService();
  cleanups.push(() => service.close());
  await expect(
    service.history(historyRpc.input.parse({ directory, repositoryId: "nested/child" })),
  ).rejects.toThrow("所属仓库");
});

it("supports linked worktrees without confusing branch refs", async () => {
  const { f, directory, service } = await setup();
  await put(directory, "file.txt", "base\n");
  await commit(directory);
  const worktree = join(f.base, "worktree");
  await command(directory, "worktree", "add", "-qb", "worktree-branch", worktree);
  const data = await service.history(historyRpc.input.parse({ directory: worktree }));
  expect(data.branch).toBe("worktree-branch");
  expect(data.refs.find((ref) => ref.current)?.name).toBe("worktree-branch");
});

it("explains unavailable shallow parents instead of treating their entire tree as newly added", async () => {
  const { f, directory, service } = await setup();
  await put(directory, "base.txt", "base\n");
  await commit(directory, "base");
  const parent = await head(directory);
  await put(directory, "new.txt", "new\n");
  await commit(directory, "new");
  const shallow = join(f.base, "shallow");
  await command(f.base, "clone", "-q", "--depth=1", pathToFileURL(directory).href, shallow);
  const history = await service.history(historyRpc.input.parse({ directory: shallow }));
  expect(history.commits).toHaveLength(1);
  const details = await service.commit(
    commitRpc.input.parse({ directory: shallow, oid: history.commits[0].oid }),
  );
  expect(details.parents).toEqual([parent]);
  expect(details.files).toEqual([]);
  expect(details.diffMessage).toContain("浅克隆");
});
