import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { buildChangeRows } from "../client/changes-model";
import { diffSyntaxStates, tokenizeLine } from "../client/syntax";
import { mapLimit } from "../server/concurrency";
import { RepositoryScanCache, scanWorkspace } from "../server/repositories";
import { GitChangesService } from "../server/service";
import type { DiffHunk } from "../shared/contracts";
import { commit, fixture, put } from "../tests/fixtures";

const f = await fixture();
const service = new GitChangesService();
const measurements: Record<string, number> = {};
async function measure<T>(name: string, work: () => Promise<T>) {
  const started = performance.now();
  const result = await work();
  measurements[name] = Number((performance.now() - started).toFixed(2));
  return result;
}
try {
  const directory = await f.repo("performance");
  const baseline = Array.from({ length: 30 }, (_, i) => `export const value${i} = ${i};`).join(
    "\n",
  );
  await mapLimit(
    Array.from({ length: 500 }, (_, i) => i),
    24,
    async (i) => put(directory, `src/group-${i % 20}/file-${i}.ts`, `${baseline}\n`),
  );
  await commit(directory);
  await mapLimit(
    Array.from({ length: 500 }, (_, i) => i),
    24,
    async (i) => {
      await put(
        directory,
        `src/group-${i % 20}/file-${i}.ts`,
        `${baseline.replace("value15 = 15", "value15 = 150")}\n`,
      );
      await put(directory, `new/group-${i % 20}/file-${i}.ts`, `${baseline}\n`);
    },
  );
  const cache = new RepositoryScanCache();
  const cold = await measure("coldScan1000FilesMs", () =>
    scanWorkspace({ directory, comparison: "head" }, cache),
  );
  const warm = await measure("warmScan1000FilesMs", () =>
    scanWorkspace({ directory, comparison: "head" }, cache),
  );
  assert.equal(cold.repositories[0].files.length, 1000);
  assert.equal(warm.version, cold.version);
  await service.snapshot({ directory, comparison: "head" });
  await measure("cachedSnapshotMs", () => service.snapshot({ directory, comparison: "head" }));
  const input = {
    directory,
    repositoryId: ".",
    path: "src/group-0/file-0.ts",
    comparison: "head" as const,
    context: 3,
    ignoreWhitespace: false,
  };
  const patch = await measure("firstPatchMs", () => service.diff(input));
  assert.equal(patch.state, "text");
  const cachedPatch = await measure("cachedPatchMs", () => service.diff(input));
  assert.equal(cachedPatch, patch);
  const large = {
    ...cold.repositories[0],
    files: Array.from({ length: 10000 }, (_, i) => ({
      ...cold.repositories[0].files[i % 1000],
      path: `packages/group-${i % 100}/file-${i}.ts`,
    })),
  };
  const rows = await measure("tree10000FilesMs", async () =>
    buildChangeRows([large], "", true, new Set()),
  );
  assert.equal(rows.filter((row) => row.kind === "file").length, 10000);
  const filtered = await measure("filter10000FilesMs", async () =>
    buildChangeRows([large], "file-9999", true, new Set()),
  );
  assert.equal(filtered.filter((row) => row.kind === "file").length, 1);
  const syntaxHunk: DiffHunk = {
    header: "@@ -1,5000 +1,5000 @@",
    oldStart: 1,
    oldLines: 5000,
    newStart: 1,
    newLines: 5000,
    lines: Array.from({ length: 5000 }, (_, i) => ({
      kind: "context",
      content: `export const value${i} = { count: ${i}, label: "review" }; // keep`,
      oldLine: i + 1,
      newLine: i + 1,
    })),
  };
  const states = await measure("syntaxStates5000LinesMs", async () =>
    diffSyntaxStates([syntaxHunk], "typescript"),
  );
  await measure("highlight40VisibleLinesMs", async () =>
    syntaxHunk.lines
      .slice(0, 40)
      .map((line) => tokenizeLine(line.content, "typescript", states.get(line))),
  );
  const report = {
    checkedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    fixture:
      "1000 changed files (500 tracked, 500 untracked), 10000 rows for tree/filter, 5000 syntax lines and 40 visible highlighted lines",
    measurements,
    note: "Single local run; timings depend on hardware and Git. Temporary repositories are removed after measurement.",
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(resolve("artifacts/performance.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  service.close();
  await f.close();
}
