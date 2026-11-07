import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { settingsRpc } from "@getpaseo/plugin";
import {
  changesRpc,
  fileCapabilitiesRpc,
  fileContentRpc,
  fileDiffRpc,
  mermaidRuntimeRpc,
  resolveLinkRpc,
} from "../shared/contracts";
import { commitFileDiffRpc, commitRpc, historyRpc } from "../shared/history-contracts";
import { panelSettingsSchema } from "../shared/settings";

const directory = process.argv[2];
if (!directory) throw new Error("用法：npm run verify:installed -- /absolute/path/to/repository");
const daemonHome = process.env.PASEO_DIFF_DAEMON_HOME ?? join(homedir(), ".paseo");
const client = new DaemonClient({
  url: process.env.PASEO_DIFF_DAEMON_URL ?? "ws://127.0.0.1:6767/ws",
  clientId: `submodule-diff-check-${randomUUID()}`,
  clientType: "cli",
  appVersion: "0.12.0",
  localCredential: async () =>
    (await readFile(join(daemonHome, "local-credential"), "utf8")).trim(),
  connectTimeoutMs: 10000,
  reconnect: { enabled: false },
});
try {
  await client.connect();
  const stored = (await client.invokePluginRpc(
    "git-diff",
    settingsRpc("git-panel").read.name,
    {},
  )) as { status: string; values?: unknown };
  assert.equal(stored.status, "ready");
  const settings = panelSettingsSchema.parse(stored.values);
  const capabilities = fileCapabilitiesRpc.output.parse(
    await client.invokePluginRpc("git-diff", fileCapabilitiesRpc.name, {}),
  );
  const renderer = mermaidRuntimeRpc.output.parse(
    await client.invokePluginRpc("git-diff", mermaidRuntimeRpc.name, {}),
  );
  const rendererBytes = gunzipSync(Buffer.from(renderer.gzip, "base64"));
  assert(rendererBytes.length > 1000000);
  const snapshot = changesRpc.output.parse(
    await client.invokePluginRpc("git-diff", changesRpc.name, {
      directory,
      comparison: "head",
    }),
  );
  assert(snapshot.repositories.some((repository) => repository.state === "ready"));
  const repositories = [];
  for (const repository of snapshot.repositories) {
    const history =
      repository.state === "ready"
        ? historyRpc.output.parse(
            await client.invokePluginRpc("git-diff", historyRpc.name, {
              directory,
              repositoryId: repository.id,
            }),
          )
        : null;
    const latest = history?.commits[0];
    const details = latest
      ? commitRpc.output.parse(
          await client.invokePluginRpc("git-diff", commitRpc.name, {
            directory,
            repositoryId: repository.id,
            oid: latest.oid,
          }),
        )
      : null;
    const historicalFile = details?.files[0];
    const historicalDiff =
      details && historicalFile
        ? commitFileDiffRpc.output.parse(
            await client.invokePluginRpc("git-diff", commitFileDiffRpc.name, {
              directory,
              repositoryId: repository.id,
              oid: details.oid,
              path: historicalFile.path,
            }),
          )
        : null;
    if (latest) assert.equal(details?.oid, latest.oid);
    if (historicalFile) assert.equal(historicalDiff?.path, historicalFile.path);
    const file = repository.files[0];
    const diff = file
      ? fileDiffRpc.output.parse(
          await client.invokePluginRpc("git-diff", fileDiffRpc.name, {
            directory,
            repositoryId: repository.id,
            path: file.path,
            comparison: "head",
            context: 3,
            ignoreWhitespace: false,
          }),
        )
      : null;
    const content = file
      ? fileContentRpc.output.parse(
          await client.invokePluginRpc("git-diff", fileContentRpc.name, {
            directory,
            repositoryId: repository.id,
            path: file.path,
            comparison: "head",
          }),
        )
      : null;
    repositories.push({
      id: repository.id,
      state: repository.state,
      files: repository.files.length,
      sampledPath: file?.path ?? null,
      sampledDiffState: diff?.state ?? null,
      sampledContentState: content?.state ?? null,
      sampledContentSource: content?.source ?? null,
      history: history
        ? {
            loaded: history.commits.length,
            hasMore: history.hasMore,
            refs: history.refs.length,
            head: history.head,
            sampledCommit: details?.oid ?? null,
            sampledFiles: details?.files.length ?? 0,
            sampledDiffState: historicalDiff?.state ?? null,
          }
        : null,
    });
  }
  const previewPath = process.argv[3];
  const links = [];
  if (previewPath) {
    const source = { directory, repositoryId: ".", path: previewPath };
    const self = resolveLinkRpc.output.parse(
      await client.invokePluginRpc("git-diff", resolveLinkRpc.name, {
        ...source,
        href: `./${encodeURIComponent(previewPath.split("/").at(-1) ?? "")}`,
      }),
    );
    const content = fileContentRpc.output.parse(
      await client.invokePluginRpc("git-diff", fileContentRpc.name, {
        directory,
        repositoryId: self.repositoryId,
        path: self.path,
        comparison: "head",
        scope: "workspace",
      }),
    );
    assert.equal(content.state, "text");
    links.push({ path: self.path, repositoryId: self.repositoryId, state: content.state });
    const href = /\]\(([^)\n]+)\)/.exec(content.content)?.[1];
    if (href) {
      const target = resolveLinkRpc.output.parse(
        await client.invokePluginRpc("git-diff", resolveLinkRpc.name, {
          ...source,
          href,
        }),
      );
      links.push({ path: target.path, repositoryId: target.repositoryId, state: target.kind });
    }
  }
  const report = {
    checkedAt: new Date().toISOString(),
    transportClientVersion: "0.12.0",
    project: snapshot.directory,
    settings: { status: stored.status, values: settings },
    fileManager: capabilities,
    mermaid: {
      version: renderer.version,
      compressedBase64Bytes: renderer.gzip.length,
      decodedBytes: rendererBytes.length,
    },
    repositories,
    links,
  };
  await mkdir("artifacts", { recursive: true });
  const output = resolve("artifacts/runtime.json");
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`PASS: installed plugin RPC; ${output}`);
} finally {
  await client.close();
}
