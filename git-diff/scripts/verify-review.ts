import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { compareFileDiffRpc, compareRpc } from "../shared/compare-contracts";
import { historyRpc } from "../shared/history-contracts";

const directory = process.argv[2];
if (!directory)
  throw new Error("Pass a Git repository with at least two commits and a main/master branch.");
const client = new DaemonClient({
  url: process.env.PASEO_DIFF_DAEMON_URL ?? "ws://127.0.0.1:6767/ws",
  clientId: `git-review-check-${randomUUID()}`,
  clientType: "cli",
  appVersion: "0.12.0",
  localCredential: async () =>
    (
      await readFile(
        join(process.env.PASEO_DIFF_DAEMON_HOME ?? join(homedir(), ".paseo"), "local-credential"),
        "utf8",
      )
    ).trim(),
  connectTimeoutMs: 10000,
  reconnect: { enabled: false },
});
try {
  await client.connect();
  const plugin = (await client.listPlugins()).find((item) => item.id === "git-diff");
  assert.equal(plugin?.status, "running");
  const catalog = (await client.getPluginCatalog()).find((item) => item.id === "git-diff");
  assert(catalog, "Plugin must be in the live host catalog");
  assert(
    catalog.clientBundle.includes("Git Changes"),
    "Client contribution must be in the live host catalog",
  );
  assert(
    !catalog.clientBundle.includes("git-compare-panel"),
    "Standalone comparison screen must be removed",
  );
  const invoke = (method: string, input: unknown) =>
    client.invokePluginRpc("git-diff", method, input);
  const history = historyRpc.output.parse(
    await invoke(historyRpc.name, { directory, ref: "head", firstParent: true }),
  );
  assert(history.commits.length >= 2);
  const branch = compareRpc.output.parse(
    await invoke(compareRpc.name, { directory, selection: { mode: "branch" } }),
  );
  assert.equal(branch.targetOid, history.head);
  assert(branch.files.length > 0);
  const file = branch.files[0];
  const diff = compareFileDiffRpc.output.parse(
    await invoke(compareFileDiffRpc.name, {
      directory,
      baseOid: branch.baseOid,
      targetOid: branch.targetOid,
      path: file.path,
    }),
  );
  assert.equal(diff.path, file.path);
  const newest = history.commits[0].oid;
  const oldest = history.commits[1].oid;
  const range = compareRpc.output.parse(
    await invoke(compareRpc.name, { directory, selection: { mode: "range", oldest, newest } }),
  );
  assert.equal(range.commitCount, 2);
  await assert.rejects(
    invoke(compareRpc.name, {
      directory,
      selection: { mode: "range", oldest: newest, newest: oldest },
    }),
    /第一父提交链/,
  );
  await assert.rejects(
    invoke(compareFileDiffRpc.name, {
      directory,
      baseOid: branch.baseOid,
      targetOid: branch.targetOid,
      path: "../outside",
    }),
    /变更列表/,
  );
  console.log(
    JSON.stringify(
      {
        status: plugin?.status,
        clientBundleBytes: catalog.clientBundle.length,
        branchFiles: branch.files.length,
        rangeCommits: range.commitCount,
        rangeFiles: range.files.length,
        sampledDiff: diff.state,
        errorStates: "invalid range and path rejected",
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
