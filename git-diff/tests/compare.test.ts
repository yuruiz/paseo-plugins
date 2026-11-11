import { afterEach, expect, it } from "vitest";
import { GitChangesService } from "../server/service";
import { compareFileDiffRpc, compareRpc } from "../shared/compare-contracts";
import { historyRpc } from "../shared/history-contracts";
import { addModule, command, commit, fixture, put } from "./fixtures";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const head = async (directory: string) => (await command(directory, "rev-parse", "HEAD")).trim();
async function setup() {
  const f = await fixture();
  cleanup.push(f.close);
  const directory = await f.repo("review");
  const service = new GitChangesService();
  cleanup.push(async () => service.close());
  const compare = (selection: unknown, repositoryId = ".") =>
    service.compare(compareRpc.input.parse({ directory, repositoryId, selection }));
  const diff = (
    baseOid: string | null,
    targetOid: string,
    path: string,
    repositoryId = ".",
    extra = {},
  ) =>
    service.compareDiff(
      compareFileDiffRpc.input.parse({
        directory,
        repositoryId,
        baseOid,
        targetOid,
        path,
        ...extra,
      }),
    );
  return { f, directory, service, compare, diff };
}

it("reviews only branch-introduced changes by default and offers direct tip comparison", async () => {
  const { directory, compare, diff } = await setup();
  await put(directory, "base.txt", "base\n");
  await commit(directory);
  const base = await head(directory);
  await command(directory, "checkout", "-qb", "feature");
  await put(directory, "feature.txt", "committed\n");
  await commit(directory);
  const target = await head(directory);
  await command(directory, "checkout", "main");
  await put(directory, "main-only.txt", "upstream\n");
  await commit(directory);
  await command(directory, "checkout", "feature");
  await put(directory, "feature.txt", "dirty\n");
  await put(directory, "untracked.txt", "new\n");
  const branch = await compare({ mode: "branch" });
  expect(branch).toMatchObject({
    baseOid: base,
    targetOid: target,
    baseRef: "refs/heads/main",
    commitCount: 1,
  });
  expect(branch.files.map((f) => f.path)).toEqual(["feature.txt"]);
  const patch = await diff(branch.baseOid, branch.targetOid, "feature.txt");
  expect(patch.patch).toContain("+committed");
  expect(patch.patch).not.toContain("dirty");
  const tips = await compare({ mode: "branch", strategy: "tips" });
  expect(tips.files).toEqual(
    expect.arrayContaining([expect.objectContaining({ path: "main-only.txt", status: "deleted" })]),
  );
  // An opened comparison remains pinned when HEAD moves.
  await put(directory, "feature.txt", "new commit\n");
  await commit(directory);
  expect((await diff(branch.baseOid, branch.targetOid, "feature.txt")).patch).toContain(
    "+committed",
  );
  expect((await compare({ mode: "branch" })).revision).not.toBe(branch.revision);
});

it("detects the remote default branch and falls back to master", async () => {
  const { directory, compare } = await setup();
  await put(directory, "base", "base");
  await commit(directory);
  const base = await head(directory);
  await command(directory, "branch", "-m", "master");
  expect((await compare({ mode: "branch" })).baseRef).toBe("refs/heads/master");
  await command(directory, "update-ref", "refs/remotes/origin/trunk", base);
  await command(directory, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
  expect((await compare({ mode: "branch" })).baseRef).toBe("refs/remotes/origin/trunk");
  await command(directory, "branch", "-m", "custom");
  await command(directory, "update-ref", "-d", "refs/remotes/origin/trunk");
  await expect(compare({ mode: "branch" })).rejects.toThrow("默认分支");
  expect((await compare({ mode: "branch", baseRef: "refs/heads/custom" })).files).toEqual([]);
});

it("includes both endpoints, aggregates changes and supports a range beginning at root", async () => {
  const { directory, compare, diff } = await setup();
  await put(directory, "file.txt", "root\n");
  await commit(directory);
  const root = await head(directory);
  await put(directory, "file.txt", "middle\n");
  await commit(directory);
  const middle = await head(directory);
  await put(directory, "file.txt", "latest\n");
  await put(directory, "new.txt", "new\n");
  await commit(directory);
  const latest = await head(directory);
  const range = await compare({ mode: "range", oldest: middle, newest: latest });
  expect(range).toMatchObject({ baseOid: root, targetOid: latest, commitCount: 2 });
  expect((await diff(range.baseOid, latest, "file.txt")).patch).toContain("-root\n+latest");
  const entire = await compare({ mode: "range", oldest: root, newest: latest });
  expect(entire.baseOid).toBeNull();
  expect(entire.commitCount).toBe(3);
  expect(entire.files.every((f) => f.status === "added")).toBe(true);
  expect((await diff(null, latest, "file.txt")).patch).toContain("+latest");
  const single = await compare({ mode: "range", oldest: root, newest: root });
  expect(single.commitCount).toBe(1);
  expect((await diff(null, root, "file.txt")).patch).toContain("+root");
  await expect(compare({ mode: "range", oldest: latest, newest: root })).rejects.toThrow(
    "第一父提交链",
  );
});

it("rejects adjacent graph commits on different branches and includes merge net changes", async () => {
  const { directory, compare, service } = await setup();
  await put(directory, "base", "base");
  await commit(directory);
  const root = await head(directory);
  await command(directory, "checkout", "-qb", "side");
  await put(directory, "side", "side");
  await commit(directory);
  const side = await head(directory);
  await command(directory, "checkout", "main");
  await put(directory, "main", "main");
  await commit(directory);
  const main = await head(directory);
  await command(directory, "merge", "--no-ff", "side", "-m", "merge");
  const merge = await head(directory);
  await expect(compare({ mode: "range", oldest: side, newest: merge })).rejects.toThrow(
    "第一父提交链",
  );
  const range = await compare({ mode: "range", oldest: main, newest: merge });
  expect(range.commitCount).toBe(2);
  expect(range.files.map((f) => f.path)).toEqual(["main", "side"]);
  const history = await service.history(
    historyRpc.input.parse({ directory, ref: "head", firstParent: true }),
  );
  expect(history.commits.map((c) => c.oid)).toEqual([merge, main, root]);
});

it("preserves renames, deletes, literal paths, binary files, size limits and whitespace options", async () => {
  const { directory, compare, diff } = await setup();
  await put(directory, "old.txt", "rename\n");
  await put(directory, "deleted.txt", "delete\n");
  await put(directory, "spaces.txt", "hello world\n");
  await commit(directory);
  const base = await head(directory);
  await command(directory, "checkout", "-qb", "feature");
  await command(directory, "mv", "old.txt", "renamed\tline\n.txt");
  await command(directory, "rm", "deleted.txt");
  await put(directory, ":(glob)*.txt", "literal\n");
  await put(directory, "binary.dat", Buffer.from([0, 1]));
  await put(directory, "big.txt", "x".repeat(1024 * 1024 + 1));
  await put(directory, "spaces.txt", "hello   world\n");
  await commit(directory);
  const target = await head(directory);
  const result = await compare({ mode: "branch" });
  expect(result.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        status: "renamed",
        oldPath: "old.txt",
        path: "renamed\tline\n.txt",
      }),
    ]),
  );
  expect((await diff(base, target, "deleted.txt")).patch).toContain("-delete");
  expect((await diff(base, target, ":(glob)*.txt")).patch).toContain("+literal");
  expect((await diff(base, target, "binary.dat")).state).toBe("binary");
  expect((await diff(base, target, "big.txt")).state).toBe("too_large");
  expect((await diff(base, target, "spaces.txt", ".", { ignoreWhitespace: true })).hunks).toEqual(
    [],
  );
  await expect(diff(base, target, "../outside")).rejects.toThrow("变更列表");
  await expect(compare({ mode: "branch", baseRef: "--all" })).rejects.toThrow("无效");
});

it("reports unborn, missing and unrelated histories and allows explicit tips on unrelated branches", async () => {
  const { directory, compare } = await setup();
  await expect(compare({ mode: "branch", baseRef: "main" })).rejects.toThrow("本地没有");
  await put(directory, "base", "base");
  await commit(directory);
  await command(directory, "checkout", "--orphan", "unrelated");
  await command(directory, "rm", "-rf", ".");
  await put(directory, "other", "other");
  await commit(directory);
  await expect(compare({ mode: "branch" })).rejects.toThrow("共同祖先");
  expect((await compare({ mode: "branch", strategy: "tips" })).files).toHaveLength(2);
  await command(directory, "checkout", "--detach", "main");
  expect((await compare({ mode: "branch" })).branch).toBeNull();
});

it("uses submodule-local refs and history, including ignore=all", async () => {
  const { f, directory, compare, diff } = await setup();
  const source = await f.repo("source");
  await put(source, "file.txt", "base\n");
  await commit(source);
  const module = await addModule(directory, source, "modules/lib");
  await command(directory, "config", "submodule.modules/lib.ignore", "all");
  await commit(directory);
  await command(module, "checkout", "-qb", "feature");
  await put(module, "file.txt", "changed\n");
  await commit(module);
  const result = await compare({ mode: "branch" }, "modules/lib");
  expect(result.files.map((f) => f.path)).toEqual(["file.txt"]);
  expect((await diff(result.baseOid, result.targetOid, "file.txt", "modules/lib")).patch).toContain(
    "+changed",
  );
  await expect(compare({ mode: "branch" }, "../../outside")).rejects.toThrow("仓库不可用");
});

it("does not mistake shallow boundaries for root commits", async () => {
  const { f, directory, service } = await setup();
  await put(directory, "base", "base");
  await commit(directory);
  await put(directory, "next", "next");
  await commit(directory);
  const shallow = `${f.base}/shallow`;
  await command(f.base, "clone", "--depth=1", `file://${directory}`, shallow);
  const oid = await head(shallow);
  await expect(
    service.compare(
      compareRpc.input.parse({
        directory: shallow,
        selection: { mode: "range", oldest: oid, newest: oid },
      }),
    ),
  ).rejects.toThrow("本地没有");
});

it("reviews committed and working changes together and never caches a working patch", async () => {
  const { directory, compare, diff } = await setup();
  await put(directory, "a.txt", "base\n");
  await commit(directory);
  await put(directory, "a.txt", "committed\n");
  await commit(directory);
  const newest = await head(directory);
  await put(directory, "a.txt", "working\n");
  await put(directory, "new.txt", "untracked\n");
  const result = await compare({ mode: "range", oldest: newest, newest, workingTree: true });
  expect(result.files.map((file) => file.path).sort()).toEqual(["a.txt", "new.txt"]);
  expect((await diff(result.baseOid, newest, "a.txt", ".", { workingTree: true })).patch).toContain(
    "+working",
  );
  expect(
    (await diff(result.baseOid, newest, "new.txt", ".", { workingTree: true })).patch,
  ).toContain("+untracked");
  await put(directory, "a.txt", "changed again\n");
  const refreshed = await compare({ mode: "range", oldest: newest, newest, workingTree: true });
  expect(refreshed.revision).not.toBe(result.revision);
  expect((await diff(result.baseOid, newest, "a.txt", ".", { workingTree: true })).patch).toContain(
    "+changed again",
  );
});
