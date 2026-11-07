import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { git } from "../server/git";
import { parseIndex, parseTree } from "../server/parsers";
import { GitChangesService } from "../server/service";
import { changesRpc, fileDiffRpc } from "../shared/contracts";

const directory = process.argv[2];
if (!directory) throw new Error("用法：npm run acceptance -- /absolute/path/to/repository");
const started = Date.now();
const service = new GitChangesService();
try {
  const snapshot = changesRpc.output.parse(
    await service.snapshot({ directory, comparison: "head" }),
  );
  assert(snapshot.repositories.length > 0, "必须发现至少一个仓库");
  const reports = [];
  for (const repository of snapshot.repositories) {
    if (repository.state !== "ready") {
      reports.push({ id: repository.id, state: repository.state, error: repository.error });
      continue;
    }
    const head =
      (
        await git(repository.directory, ["rev-parse", "--verify", "--quiet", "HEAD"], {
          acceptDifference: true,
        })
      ).trim() || null;
    assert.equal(repository.head, head, "快照基线必须为所属仓库的 HEAD");
    const modules = new Set<string>();
    for (const [path, entry] of [
      ...parseIndex(await git(repository.directory, ["ls-files", "--stage", "-z"])),
      ...parseTree(head ? await git(repository.directory, ["ls-tree", "-r", "-z", "HEAD"]) : ""),
    ])
      if (entry.mode === "160000") modules.add(path);
    const tracked = (
      await git(repository.directory, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--ignore-submodules=none",
        "--name-only",
        "-z",
        ...(head ? ["HEAD"] : ["--cached"]),
        "--",
      ])
    )
      .split("\0")
      .filter((path) => path && !modules.has(path));
    const untracked = (
      await git(repository.directory, ["ls-files", "--others", "--exclude-standard", "-z"])
    )
      .split("\0")
      .filter((path) => path && !modules.has(path));
    const expected = [...new Set([...tracked, ...untracked])].sort();
    assert.deepEqual(
      repository.files.map((file) => file.path).sort(),
      expected,
      `文件列表必须与原生 Git 一致：${repository.id}；若其他工具同时修改文件，请重试验收。`,
    );
    const diffs = [];
    for (const file of repository.files) {
      const diff = fileDiffRpc.output.parse(
        await service.diff({
          directory,
          repositoryId: repository.id,
          path: file.path,
          comparison: "head",
          context: 3,
          ignoreWhitespace: false,
        }),
      );
      diffs.push({
        path: file.path,
        state: diff.state,
        hunks: diff.hunks.length,
        patchBytes: Buffer.byteLength(diff.patch),
      });
    }
    reports.push({
      id: repository.id,
      state: repository.state,
      head,
      recordedHead: repository.recordedHead,
      files: repository.files.length,
      diffs,
    });
  }
  const report = {
    project: snapshot.directory,
    checkedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    comparison: "Each repository HEAD against its working tree",
    repositories: reports,
  };
  await mkdir("artifacts", { recursive: true });
  const output = resolve("artifacts/acceptance.json");
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`PASS: ${output}`);
} finally {
  service.close();
}
